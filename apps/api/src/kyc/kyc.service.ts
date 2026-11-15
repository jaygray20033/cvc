import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { KycStatus } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { ErrorCode } from '../common/errors/error-codes';
import { MailService } from '../common/mail/mail.service';
import { kycStatusHtml, kycStatusText } from '../common/mail/mail.templates';
import { assertOwned } from '../common/policies/ownership';
import { S3Service } from '../common/storage/s3.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PresignUploadInput } from './kyc.dto';

type SubmissionStatus = 'PENDING' | 'NEED_MORE' | 'APPROVED' | 'REJECTED';

// KYC manual review (P2.12/P2.13). Documents live in the private S3 bucket;
// every download link is short-lived and each issuance is logged as a
// DOCUMENT_ACCESSED event (audit trail until the AuditLog table in P2.16).
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly mail: MailService,
  ) {}

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

    await this.prisma.kycDocument.update({
      where: { id: document.id },
      data: { uploadStatus: 'READY' },
    });
    await this.addEvent(
      document.submissionId,
      'DOCUMENT_UPLOADED',
      user.sub,
      user.role,
      document.type,
    );

    return { message: 'Đã xác nhận tài liệu.' };
  }

  // GET /me/kyc: my submissions with documents.
  async listMySubmissions(user: AccessPayload) {
    return this.prisma.kycSubmission.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: 'desc' },
      include: {
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

  // ---- admin side (P2.13) ----

  async listSubmissionsForAdmin(status?: KycStatus) {
    return this.prisma.kycSubmission.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'asc' }, // oldest first = natural queue
      include: {
        documents: {
          select: { id: true, type: true, mime: true, sizeBytes: true, uploadStatus: true },
        },
        user: { select: { id: true, email: true } },
      },
    });
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

  async approve(admin: AccessPayload, submissionId: string) {
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
      },
    });
    await this.addEvent(submission.id, 'APPROVED', admin.sub, admin.role);
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
    });
    await this.addEvent(submission.id, status, admin.sub, admin.role, reason);
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

  private async notifyUser(userId: string, status: SubmissionStatus, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    try {
      await this.mail.send({
        to: user.email,
        subject: `CVC — Cập nhật hồ sơ KYC (${status})`,
        html: kycStatusHtml(status, reason),
        text: kycStatusText(status, reason),
      });
    } catch {
      // Notification failure must not fail the review transaction.
      this.logger.error({ event: 'kyc_notify_failed', userId, status }, 'kyc email failed');
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
      | 'DOCUMENT_ACCESSED',
    actorId: string,
    actorRole?: string,
    note?: string,
  ) {
    await this.prisma.kycEvent.create({
      data: { submissionId, type, actorId, actorRole, note },
    });
  }
}
