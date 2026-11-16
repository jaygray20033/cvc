import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service';
import { type AccessPayload } from '../common/decorators/current-user.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { assertOwned } from '../common/policies/ownership';
import { S3Service } from '../common/storage/s3.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { isImageMime, type PresignFileInput } from './files.dto';
import { detectMime } from './magic-bytes';
import { VirusScanService } from './virus-scan.service';

// Shared file service (P2.17). Upload is two-phase with presigned PUT, then
// confirm checks the real MIME via magic bytes, kicks off an async virus
// scan and generates an image thumbnail. Download is owner-or-admin only,
// requires READY + CLEAN, and returns a short-lived presigned URL.
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly scanner: VirusScanService,
    private readonly audit: AuditService,
    private readonly settings: SystemSettingsService,
    private readonly queues: QueueService,
  ) {}

  // POST /files/presign
  async presign(user: AccessPayload, input: PresignFileInput) {
    // Runtime limit (P2.22) instead of the static SIZE_LIMITS map.
    const mbSetting = isImageMime(input.mime) ? 'files.maxImageMb' : 'files.maxPdfMb';
    const limitMb = await this.settings.get<number>(mbSetting);
    const limit = limitMb * 1024 * 1024;
    if (input.sizeBytes > limit) {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: `Loại tệp này tối đa ${limitMb}MB.`,
      });
    }

    const s3Key = `files/${user.sub}/${randomKey()}`;
    const file = await this.prisma.fileObject.create({
      data: {
        ownerType: 'user',
        ownerId: user.sub,
        bucket: this.s3.privateBucket,
        s3Key,
        purpose: input.purpose,
        declaredMime: input.mime,
        sizeBytes: input.sizeBytes,
        status: 'UPLOADING',
      },
    });
    const uploadUrl = await this.s3.presignPut(this.s3.privateBucket, s3Key, input.mime);
    return { fileId: file.id, uploadUrl, expiresIn: 300 };
  }

  // POST /files/:id/confirm — client finished the PUT.
  async confirm(user: AccessPayload, fileId: string) {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new NotFoundException({ code: ErrorCode.NotFound, message: 'Không tìm thấy tệp.' });
    }
    assertOwned(user.sub, file.ownerId, 'tệp');
    if (file.status === 'READY') {
      return { message: 'Tệp đã được xác nhận trước đó.', fileId: file.id };
    }

    const exists = await this.s3.exists(file.bucket, file.s3Key);
    if (!exists) {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'Chưa tìm thấy tệp trên lưu trữ. Vui lòng upload lại.',
      });
    }

    // Real MIME check (magic bytes of the first 512 bytes).
    const head = await this.s3.getObjectBytes(file.bucket, file.s3Key, 512);
    const detected = detectMime(head);
    if (detected !== file.declaredMime) {
      await this.s3.deleteObject(file.bucket, file.s3Key);
      await this.prisma.fileObject.update({
        where: { id: file.id },
        data: { status: 'REJECTED', detectedMime: detected },
      });
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'Nội dung tệp không khớp định dạng đã khai báo.',
      });
    }

    // sha256 over the first 1MB is enough as a light duplicate/ID signal;
    // full-hash dedupe lands with the payment-proof flow (P4).
    const hashBytes = await this.s3.getObjectBytes(file.bucket, file.s3Key, 1024 * 1024);
    const sha256 = createHash('sha256').update(hashBytes).digest('hex');

    await this.prisma.fileObject.update({
      where: { id: file.id },
      data: { status: 'READY', detectedMime: detected, scanStatus: 'PENDING', sha256 },
    });

    // Post-processing runs through the files queue (P2.19 BullMQ): scan then
    // thumbnail, idempotent per fileId (job ids cannot contain ':').
    await this.queues.enqueueIdempotent(
      'files',
      'file.post-process',
      { fileId: file.id },
      `file-post-${file.id}`,
    );

    return { message: 'Đã xác nhận tệp. Đang quét virus...', fileId: file.id };
  }

  // GET /files/:id — metadata for owner or admin.
  async getMeta(user: AccessPayload, fileId: string) {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new NotFoundException({ code: ErrorCode.NotFound, message: 'Không tìm thấy tệp.' });
    }
    this.assertCanView(user, file.ownerId);
    return {
      id: file.id,
      ownerType: file.ownerType,
      ownerId: file.ownerId,
      purpose: file.purpose,
      mime: file.detectedMime ?? file.declaredMime,
      sizeBytes: file.sizeBytes,
      status: file.status,
      scanStatus: file.scanStatus,
      hasThumbnail: Boolean(file.thumbnailKey),
      createdAt: file.createdAt,
    };
  }

  // GET /files/:id/download — presigned URL, blocked until scan is CLEAN.
  async download(user: AccessPayload, fileId: string) {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new NotFoundException({ code: ErrorCode.NotFound, message: 'Không tìm thấy tệp.' });
    }
    this.assertCanView(user, file.ownerId);
    if (file.status !== 'READY') {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'Tệp chưa sẵn sàng để tải.',
      });
    }
    // Not scanned yet -> no download (P2.17 DoD).
    if (file.scanStatus === 'PENDING' || file.scanStatus === 'NOT_SCANNED') {
      throw new ForbiddenException({
        code: ErrorCode.Forbidden,
        message: 'Tệp đang được quét virus, vui lòng đợi.',
      });
    }
    if (file.scanStatus !== 'CLEAN') {
      throw new ForbiddenException({
        code: ErrorCode.Forbidden,
        message: 'Tệp không vượt qua kiểm tra an toàn.',
      });
    }
    const url = await this.s3.presignGet(file.bucket, file.s3Key);
    await this.audit.log({
      actorId: user.sub,
      actorRole: user.role,
      action: 'file.downloaded',
      entityType: 'file',
      entityId: file.id,
    });
    return { url, expiresIn: 300 };
  }

  // ---- post-processing ----

  // Queue entry point (P2.19): virus scan then thumbnail, safe to re-run.
  async postProcessById(fileId: string): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) return;
    // Already scanned: skip unless re-run is explicitly needed (rescan cron).
    if (file.scanStatus === 'CLEAN' || file.scanStatus === 'INFECTED') return;
    try {
      const bytes = await this.s3.getObjectBytes(file.bucket, file.s3Key, 32 * 1024 * 1024);
      const scan = await this.scanner.scan(bytes);
      if (scan.status === 'INFECTED') {
        await this.s3.deleteObject(file.bucket, file.s3Key);
        await this.prisma.fileObject.update({
          where: { id: file.id },
          data: { scanStatus: 'INFECTED', scanAt: new Date() },
        });
        return;
      }
      if (scan.status === 'ERROR') {
        await this.prisma.fileObject.update({
          where: { id: file.id },
          data: { scanStatus: 'ERROR', scanAt: new Date() },
        });
        return;
      }
      await this.prisma.fileObject.update({
        where: { id: file.id },
        data: { scanStatus: 'CLEAN', scanAt: new Date() },
      });
      // Thumbnail for images (best effort, never blocks the scan verdict).
      if ((file.detectedMime ?? '').startsWith('image/') && !file.thumbnailKey) {
        await this.makeThumbnail(file.id).catch(() => undefined);
      }
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error), fileId },
        'file post-process failed',
      );
      await this.prisma.fileObject
        .update({ where: { id: fileId }, data: { scanStatus: 'ERROR' } })
        .catch(() => undefined);
    }
  }

  // WebP 320px thumbnail stored next to the object.
  private async makeThumbnail(fileId: string): Promise<void> {
    const sharp = (await import('sharp')).default;
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file) return;
    const bytes = await this.s3.getObjectBytes(file.bucket, file.s3Key, 32 * 1024 * 1024);
    const thumb = await sharp(bytes).resize(320, 320, { fit: 'inside' }).webp().toBuffer();
    const thumbKey = `${file.s3Key}.thumb.webp`;
    await this.s3.uploadObject(file.bucket, thumbKey, thumb, 'image/webp');
    await this.prisma.fileObject.update({
      where: { id: file.id },
      data: { thumbnailKey: thumbKey },
    });
  }

  private assertCanView(user: AccessPayload, ownerId: string): void {
    if (user.role !== 'admin') {
      assertOwned(user.sub, ownerId, 'tệp');
    }
  }
}

function randomKey(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
