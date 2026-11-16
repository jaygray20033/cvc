import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KycStatus } from '@prisma/client';

import { AuditService } from '../common/audit/audit.service';
import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { assertOwned } from '../common/policies/ownership';
import { S3Service } from '../common/storage/s3.service';
import {
  decryptCccdNumber,
  encryptCccdNumber,
  hashCccdNumber,
  hashImageBytes,
} from '../common/utils/validators';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import type { KycChecklist, PresignUploadInput } from './kyc.dto';

type SubmissionStatus = 'PENDING' | 'NEED_MORE' | 'APPROVED' | 'REJECTED';

// KYC manual review (P2.12/P2.13/P2.14). Documents live in the private S3
// bucket; every download link is short-lived and each issuance is logged as a
// DOCUMENT_ACCESSED event. P2.14 adds the portrait doc, photo + salted-CCCD
// duplicate detection, the admin eye-match checklist and a configurable SLA.
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);
  private readonly encryptionKey: string;
  private readonly cccdHashSalt: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly settings: SystemSettingsService,
    config: ConfigService,
  ) {
    this.encryptionKey = config.get<string>('encryption.key', '');
    this.cccdHashSalt = config.get<string>('kyc.cccdHashSalt', '');
  }

  // ---- user side (P2.12) ----

  // POST /me/kyc/documents/presign: returns { documentId, uploadUrl }.
  // Documents attach to the latest reusable submission (PENDING, or
  // NEED_MORE -> re-opens as PENDING on resubmit).
  async presignUpload(user: AccessPayload, input: PresignUploadInput) {
    const submission = await this.getOrCreateOpenSubmission(user.sub);

    // Key has no PII: kyc/{userId}/{random}. Key and row id are independent.
    const s3Key = this.s3.objectKey(user.sub, randomUUID());
    const document = await this.prisma.kycDocument.create({
      data: {
        submissionId: submission.id,
        type: input.type,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        s3Key,
        bucket: this.s3.privateBucket,
        uploadStatus: 'UPLOADING',
      },
    });

    const uploadUrl = await this.s3.presignPut(this.s3.privateBucket, s3Key, input.mime);

    return {
      documentId: document.id,
      submissionId: submission.id,
      uploadUrl,
      expiresIn: 300,
    };
  }

  // POST /me/kyc/documents/:id/confirm: called after the client PUT to S3.
  async confirmUpload(user: AccessPayload, documentId: string) {
    const document = await this.prisma.kycDocument.findUnique({
      where: { id: documentId },
      include: { submission: { select: { id: true, userId: true, status: true } } },
    });
    if (!document) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Không tìm thấy tài liệu.',
      });
    }
    assertOwned(user.sub, document.submission.userId, 'tài liệu');
    if (document.uploadStatus === 'READY') {
      return { message: 'Tài liệu đã được xác nhận trước đó.' };
    }

    // Object must actually exist in S3 (client finished the PUT).
    const exists = await this.s3.exists(document.bucket, document.s3Key);
    if (!exists) {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'Chưa tìm thấy tệp trên lưu trữ. Vui lòng upload lại.',
      });
    }

    // Hash the stored bytes (P2.14) and flag a duplicate image reused by a
    // different account.
    const bytes = await this.s3.getObjectBuffer(document.bucket, document.s3Key);
    const imageHash = hashImageBytes(bytes);
    await this.prisma.kycDocument.update({
      where: { id: document.id },
      data: { uploadStatus: 'READY', imageHash },
    });
    await this.addEvent(
      document.submissionId,
      'DOCUMENT_UPLOADED',
      user.sub,
      user.role,
      document.type,
    );
    await this.flagDuplicateImage(document.submissionId, user.sub, imageHash);

    return { message: 'Đã xác nhận tài liệu.' };
  }

  // GET /me/kyc: my submissions with documents.
  async listMySubmissions(user: AccessPayload) {
    return this.prisma.kycSubmission.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        reviewNote: true,
        duplicateFlag: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        // cccdNumberEnc / cccdHash stay server-side, even for the owner.
        documents: {
          select: {
            id: true,
            type: true,
            mime: true,
            sizeBytes: true,
            uploadStatus: true,
            createdAt: true,
          },
        },
      },
    });
  }

  // GET /me/kyc/documents/:id/download: owner-only presigned link + access log.
  async getDocumentDownloadLink(user: AccessPayload, documentId: string) {
    const document = await this.prisma.kycDocument.findUnique({
      where: { id: documentId },
      include: { submission: { select: { userId: true } } },
    });
    if (!document) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Không tìm thấy tài liệu.',
      });
    }
    assertOwned(user.sub, document.submission.userId, 'tài liệu');
    return this.buildDownloadLink(document.id, user.sub, user.role);
  }

  // GET /me/kyc/sla: configured review SLA (hours) shown to the user (P2.14).
  getSla() {
    return this.settings.get<number>('kyc.slaHours').then((slaHours) => ({ slaHours }));
  }

  // PUT /me/kyc/cccd: store the CCCD number on the open submission (encrypted
  // + salted hash) and flag it when the same number is used by another account.
  async submitCccd(user: AccessPayload, cccdNumber: string) {
    const submission = await this.getOrCreateOpenSubmission(user.sub);

    const cccdHash = hashCccdNumber(cccdNumber, this.cccdHashSalt);
    const cccdNumberEnc = encryptCccdNumber(cccdNumber, this.encryptionKey);
    await this.prisma.kycSubmission.update({
      where: { id: submission.id },
      data: { cccdNumberEnc, cccdHash },
    });

    const duplicate = await this.flagDuplicateCccd(submission.id, user.sub, cccdHash);
    return { message: 'Đã lưu số CCCD.', duplicate };
  }

  // ---- admin side (P2.13) ----

  async listSubmissionsForAdmin(status?: KycStatus) {
    return this.prisma.kycSubmission.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'asc' }, // oldest first = natural queue
      // cccdNumberEnc / cccdHash are deliberately excluded from the queue;
      // only the detail endpoint decrypts the number (and logs the access).
      select: {
        id: true,
        status: true,
        duplicateFlag: true,
        reviewNote: true,
        reviewedById: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, email: true } },
        documents: {
          select: {
            id: true,
            type: true,
            mime: true,
            sizeBytes: true,
            uploadStatus: true,
          },
        },
      },
    });
  }

  // GET /admin/kyc/:id — full record for eye-matching. Reveals the CCCD number
  // (admin_ops/super only) and logs a CCCD_ACCESSED event each time.
  async getSubmissionDetailForAdmin(admin: AccessPayload, submissionId: string) {
    const submission = await this.prisma.kycSubmission.findUnique({
      where: { id: submissionId },
      include: {
        user: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
        documents: {
          select: {
            id: true,
            type: true,
            mime: true,
            sizeBytes: true,
            uploadStatus: true,
            createdAt: true,
          },
        },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!submission) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Không tìm thấy hồ sơ KYC.',
      });
    }

    const cccdNumber = submission.cccdNumberEnc
      ? decryptCccdNumber(submission.cccdNumberEnc, this.encryptionKey)
      : null;
    await this.addEvent(submission.id, 'CCCD_ACCESSED', admin.sub, admin.role);

    return {
      id: submission.id,
      status: submission.status,
      duplicateFlag: submission.duplicateFlag,
      reviewNote: submission.reviewNote,
      reviewChecklist: submission.reviewChecklist,
      reviewedById: submission.reviewedById,
      reviewedAt: submission.reviewedAt,
      createdAt: submission.createdAt,
      cccdNumber,
      user: submission.user,
      documents: submission.documents,
      events: submission.events,
    };
  }

  async getDocumentDownloadLinkForAdmin(admin: AccessPayload, documentId: string) {
    const document = await this.prisma.kycDocument.findUnique({
      where: { id: documentId },
      include: { submission: { select: { userId: true } } },
    });
    if (!document) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Không tìm thấy tài liệu.',
      });
    }
    return this.buildDownloadLink(document.id, admin.sub, admin.role);
  }

  async approve(admin: AccessPayload, submissionId: string, checklist: KycChecklist) {
    const submission = await this.getSubmissionForReview(submissionId);
    if (submission.status === 'APPROVED') {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'Hồ sơ đã được duyệt trước đó.',
      });
    }

    const updated = await this.prisma.kycSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'APPROVED',
        reviewedById: admin.sub,
        reviewedAt: new Date(),
        reviewNote: null,
        reviewChecklist: checklist,
      },
      select: {
        id: true,
        status: true,
        duplicateFlag: true,
        reviewedById: true,
        reviewedAt: true,
        reviewChecklist: true,
      },
    });
    await this.addEvent(submission.id, 'APPROVED', admin.sub, admin.role);
    await this.audit.log({
      actorId: admin.sub,
      actorRole: admin.role,
      action: 'kyc.approved',
      entityType: 'kyc_submission',
      entityId: submission.id,
      after: { status: 'APPROVED', ownerId: submission.userId },
    });
    await this.notifyUser(submission.userId, 'APPROVED');
    return updated;
  }

  async reject(admin: AccessPayload, submissionId: string, reason: string) {
    return this.reviewWithReason(admin, submissionId, 'REJECTED', reason);
  }

  async requestMore(admin: AccessPayload, submissionId: string, reason: string) {
    return this.reviewWithReason(admin, submissionId, 'NEED_MORE', reason);
  }

  private async reviewWithReason(
    admin: AccessPayload,
    submissionId: string,
    status: 'REJECTED' | 'NEED_MORE',
    reason: string,
  ) {
    const submission = await this.getSubmissionForReview(submissionId);
    if (submission.status === status) {
      throw new BadRequestException({
        code: ErrorCode.BadRequest,
        message: 'Hồ sơ đang ở trạng thái này rồi.',
      });
    }

    const updated = await this.prisma.kycSubmission.update({
      where: { id: submission.id },
      data: { status, reviewedById: admin.sub, reviewedAt: new Date(), reviewNote: reason },
      select: {
        id: true,
        status: true,
        duplicateFlag: true,
        reviewNote: true,
        reviewedById: true,
        reviewedAt: true,
      },
    });
    await this.addEvent(submission.id, status, admin.sub, admin.role, reason);
    await this.audit.log({
      actorId: admin.sub,
      actorRole: admin.role,
      action: status === 'REJECTED' ? 'kyc.rejected' : 'kyc.need_more',
      entityType: 'kyc_submission',
      entityId: submission.id,
      after: { status, ownerId: submission.userId, reason },
    });
    await this.notifyUser(submission.userId, status, reason);
    return updated;
  }

  // ---- helpers ----

  // Latest submission is reusable when PENDING; NEED_MORE is re-opened as
  // PENDING on resubmit. APPROVED/REJECTED start a fresh submission.
  private async getOrCreateOpenSubmission(userId: string) {
    const latest = await this.prisma.kycSubmission.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });

    if (latest?.status === 'PENDING') return latest;

    if (latest?.status === 'NEED_MORE') {
      await this.prisma.kycSubmission.update({
        where: { id: latest.id },
        data: { status: 'PENDING' },
      });
      return latest;
    }

    const created = await this.prisma.kycSubmission.create({
      data: { userId, status: 'PENDING' },
      select: { id: true, status: true },
    });
    await this.addEvent(created.id, 'SUBMITTED', userId);
    return created;
  }

  private async getSubmissionForReview(submissionId: string) {
    const submission = await this.prisma.kycSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!submission) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Không tìm thấy hồ sơ KYC.',
      });
    }
    return submission;
  }

  // P2.14: same photo bytes already used by a different account's document.
  // Flags both submissions so reviewers see the warning; never exposes which
  // account matched.
  private async flagDuplicateImage(submissionId: string, userId: string, imageHash: string) {
    const matches = await this.prisma.kycDocument.findMany({
      where: {
        imageHash,
        uploadStatus: 'READY',
        submission: { userId: { not: userId } },
      },
      select: { submissionId: true, submission: { select: { userId: true } } },
    });
    if (matches.length === 0) return;

    await this.markDuplicate(
      submissionId,
      userId,
      `Ảnh trùng với ${matches.length} tài liệu khác.`,
    );
    for (const match of matches) {
      if (match.submission.userId !== userId) {
        await this.markDuplicate(
          match.submissionId,
          match.submission.userId,
          'Ảnh trùng với một hồ sơ khác.',
        );
      }
    }
  }

  // P2.14: same CCCD number (matched by salted hash) already on another
  // account. Returns true when a duplicate was found.
  private async flagDuplicateCccd(
    submissionId: string,
    userId: string,
    cccdHash: string,
  ): Promise<boolean> {
    const matches = await this.prisma.kycSubmission.findMany({
      where: { cccdHash, userId: { not: userId } },
      select: { id: true, userId: true },
    });
    if (matches.length === 0) return false;

    await this.markDuplicate(
      submissionId,
      userId,
      `Số CCCD trùng với ${matches.length} tài khoản khác.`,
    );
    for (const match of matches) {
      await this.markDuplicate(match.id, match.userId, 'Số CCCD trùng với một hồ sơ khác.');
    }
    return true;
  }

  // Sets the flag once (skips a re-write if already flagged) and logs the
  // warning event.
  private async markDuplicate(submissionId: string, userId: string, note: string) {
    await this.prisma.kycSubmission.updateMany({
      where: { id: submissionId, duplicateFlag: false },
      data: { duplicateFlag: true },
    });
    await this.addEvent(submissionId, 'DUPLICATE_FLAGGED', userId, undefined, note);
    this.logger.warn({ event: 'kyc_duplicate_flagged', submissionId }, note);
  }

  private async buildDownloadLink(documentId: string, actorId: string, actorRole?: string) {
    const document = await this.prisma.kycDocument.findUnique({ where: { id: documentId } });
    if (!document || document.uploadStatus !== 'READY') {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Tài liệu chưa sẵn sàng để tải.',
      });
    }
    const url = await this.s3.presignGet(document.bucket, document.s3Key);
    // Access log (P2.12 DoD): who fetched a link, never any file content.
    await this.addEvent(document.submissionId, 'DOCUMENT_ACCESSED', actorId, actorRole);
    this.logger.warn(
      { event: 'kyc_document_accessed', documentId, actorId, actorRole },
      'kyc document download link issued',
    );
    return { url, expiresIn: 300 };
  }

  // Notify via the notification engine (P2.18): in-app row + email per user
  // preferences; failure must not fail the review transaction.
  private async notifyUser(userId: string, status: SubmissionStatus, reason?: string) {
    try {
      await this.notifications.emit('kyc.status_changed', userId, { status, reason });
    } catch {
      this.logger.error({ event: 'kyc_notify_failed', userId, status }, 'kyc notify failed');
    }
  }

  // Review history / audit trail (P2.13); AuditLog table lands in P2.16.
  private async addEvent(
    submissionId: string,
    type:
      | 'SUBMITTED'
      | 'DOCUMENT_UPLOADED'
      | 'APPROVED'
      | 'NEED_MORE'
      | 'REJECTED'
      | 'DOCUMENT_ACCESSED'
      | 'DUPLICATE_FLAGGED'
      | 'CCCD_ACCESSED',
    actorId: string,
    actorRole?: string,
    note?: string,
  ) {
    await this.prisma.kycEvent.create({
      data: { submissionId, type, actorId, actorRole, note },
    });
  }
}
