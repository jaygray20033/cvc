import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AddSourcingNoteInput,
  AdminSourcingRequestQueryInput,
  AssignSourcingRequestInput,
  CreateSourcingRequestInput,
  InviteSuppliersInput,
  SourcingRequestQueryInput,
} from './sourcing-requests.dto';

// Buyer RFQs (P4.7) + sales intake/assignment/internal notes (P4.8).
// State machine: OPEN → QUOTED → SELECTED → CONVERTED, with OPEN|QUOTED →
// EXPIRED when expiresAt passes, and * → CANCELLED by the buyer (before a
// quote is selected). Buyer responses never include internal notes/assignee.
@Injectable()
export class SourcingRequestsService {
  private readonly logger = new Logger(SourcingRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------- buyer (P4.7)

  async create(buyer: AccessPayload, input: CreateSourcingRequestInput) {
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Hạn nhận báo giá phải ở tương lai.');
    }
    if (input.categoryId) await this.assertCategory(input.categoryId);
    const fileIds = input.fileObjectIds ?? [];
    await this.validateFiles(fileIds);

    const requestNo = `CVC-RFQ-${randomBytes(5).toString('hex').toUpperCase()}`;
    const request = await this.prisma.sourcingRequest.create({
      data: {
        requestNo,
        buyerId: buyer.sub,
        title: input.title,
        content: input.content,
        quantity: input.quantity,
        market: input.market,
        categoryId: input.categoryId,
        targetPrice: input.targetPrice,
        currency: input.currency ?? 'VND',
        expiresAt: input.expiresAt,
        status: 'OPEN',
        attachments: fileIds.length
          ? {
              create: fileIds.map((fileObjectId, index) => ({
                fileObjectId,
                sortIndex: index,
              })),
            }
          : undefined,
      },
      include: {
        attachments: { include: { fileObject: { select: { s3Key: true } } } },
        category: { select: { id: true, name: true } },
      },
    });

    // Notify every active sales user so someone picks the request up.
    const salesUsers = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', userRoles: { some: { role: 'sales' } } },
      select: { id: true },
    });
    for (const sales of salesUsers) {
      await this.notifications.emit('sourcing.request_created', sales.id, {
        requestNo: request.requestNo,
        title: request.title,
        quantity: request.quantity,
      });
    }
    this.logger.log({ requestId: request.id, buyerId: buyer.sub }, 'sourcing request created');
    return this.mapBuyer(request);
  }

  async listMine(
    buyer: AccessPayload,
    query: SourcingRequestQueryInput,
  ): Promise<{ items: unknown[]; page: number; limit: number; total: number }> {
    await this.expireDue();
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const where = { buyerId: buyer.sub, deletedAt: null, status: query.status };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sourcingRequest.count({ where }),
      this.prisma.sourcingRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          attachments: { include: { fileObject: { select: { s3Key: true } } } },
          category: { select: { id: true, name: true } },
          _count: { select: { quotes: true } },
        },
      }),
    ]);
    return {
      items: rows.map((row) => this.mapBuyer(row, row._count.quotes)),
      page,
      limit,
      total,
    };
  }

  // Ownership guard: a buyer only ever sees its own requests (404 otherwise).
  async getMine(buyer: AccessPayload, id: string) {
    await this.expireDue();
    const request = await this.prisma.sourcingRequest.findFirst({
      where: { id, buyerId: buyer.sub, deletedAt: null },
      include: {
        attachments: { include: { fileObject: { select: { s3Key: true } } } },
        category: { select: { id: true, name: true } },
        _count: { select: { quotes: true } },
        selection: { select: { id: true } },
      },
    });
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');
    return {
      ...this.mapBuyer(request, request._count.quotes),
      hasSelection: request.selection !== null,
    };
  }

  async cancel(buyer: AccessPayload, id: string) {
    await this.expireDue();
    const request = await this.prisma.sourcingRequest.findFirst({
      where: { id, buyerId: buyer.sub, deletedAt: null },
      include: { selection: { select: { id: true } } },
    });
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');
    if (request.status === 'CANCELLED') {
      throw new ConflictException('Yêu cầu đã được hủy trước đó.');
    }
    if (request.selection || request.status === 'SELECTED' || request.status === 'CONVERTED') {
      throw new ConflictException('Không thể hủy sau khi đã chọn báo giá.');
    }
    if (request.status === 'EXPIRED') {
      throw new ConflictException('Yêu cầu đã hết hạn.');
    }
    await this.prisma.sourcingRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    return { id, status: 'CANCELLED' };
  }

  // ----------------------------------------------------- sales/admin (P4.8)

  async listAdmin(query: AdminSourcingRequestQueryInput) {
    await this.expireDue();
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const where = {
      deletedAt: null,
      status: query.status,
      assignedToId: query.assignee,
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sourcingRequest.count({ where }),
      this.prisma.sourcingRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: this.adminInclude(),
      }),
    ]);
    return { items: rows.map((row) => this.mapAdmin(row)), page, limit, total };
  }

  async getAdmin(id: string) {
    await this.expireDue();
    const request = await this.prisma.sourcingRequest.findFirst({
      where: { id, deletedAt: null },
      include: this.adminInclude(),
    });
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');
    return this.mapAdmin(request);
  }

  async assign(actor: AccessPayload, id: string, input: AssignSourcingRequestInput) {
    const request = await this.prisma.sourcingRequest.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, requestNo: true, title: true },
    });
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');

    const assignee = await this.prisma.user.findFirst({
      where: {
        id: input.assigneeId,
        status: 'ACTIVE',
        userRoles: { some: { role: { in: ['sales', 'admin'] } } },
      },
      select: { id: true },
    });
    if (!assignee) {
      throw new BadRequestException('Người nhận phải là sales hoặc admin đang hoạt động.');
    }

    await this.prisma.sourcingRequest.update({
      where: { id },
      data: {
        assignedToId: input.assigneeId,
        slaDueAt: input.slaDueAt,
        // Re-arm the overdue reminder for the new SLA.
        slaRemindedAt: null,
      },
    });
    await this.notifications.emit('sourcing.request_assigned', input.assigneeId, {
      requestNo: request.requestNo,
      title: request.title,
      slaDueAt: input.slaDueAt?.toISOString(),
    });
    this.logger.log(
      { requestId: id, assigneeId: input.assigneeId, actor: actor.sub },
      'rfq assigned',
    );
    return this.getAdmin(id);
  }

  async addNote(actor: AccessPayload, id: string, input: AddSourcingNoteInput) {
    const request = await this.prisma.sourcingRequest.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');
    const note = await this.prisma.sourcingRequestNote.create({
      data: { requestId: id, authorId: actor.sub, body: input.body },
    });
    return { id: note.id, body: note.body, authorId: note.authorId, createdAt: note.createdAt };
  }

  // P4.9: sales invites specific suppliers to quote (idempotent per supplier).
  async inviteSuppliers(actor: AccessPayload, id: string, input: InviteSuppliersInput) {
    const request = await this.prisma.sourcingRequest.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, requestNo: true, title: true, status: true },
    });
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');
    if (!['OPEN', 'QUOTED'].includes(request.status)) {
      throw new ConflictException('Yêu cầu không còn nhận báo giá.');
    }

    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: input.supplierIds }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, accounts: { select: { userId: true } } },
    });
    if (suppliers.length !== input.supplierIds.length) {
      throw new BadRequestException('Một số nhà cung cấp không tồn tại hoặc đã ngừng hoạt động.');
    }

    await this.prisma.sourcingRequestInvitation.createMany({
      data: suppliers.map((supplier) => ({
        requestId: id,
        supplierId: supplier.id,
        invitedById: actor.sub,
      })),
      skipDuplicates: true,
    });
    for (const supplier of suppliers) {
      for (const account of supplier.accounts) {
        await this.notifications.emit('sourcing.request_invited', account.userId, {
          requestNo: request.requestNo,
          title: request.title,
        });
      }
    }
    this.logger.log(
      { requestId: id, count: suppliers.length, actor: actor.sub },
      'rfq invites sent',
    );
    return { requestId: id, invitedSupplierIds: suppliers.map((supplier) => supplier.id) };
  }

  // ----------------------------------------------------------- SLA sweep

  // Cron sweep (queue 'cron'): remind assignees of overdue requests once per
  // SLA assignment (slaRemindedAt guards against duplicate pings).
  async remindOverdueSla(now = new Date()): Promise<{ reminded: number }> {
    const due = await this.prisma.sourcingRequest.findMany({
      where: {
        deletedAt: null,
        status: { in: ['OPEN', 'QUOTED'] },
        slaDueAt: { lt: now },
        slaRemindedAt: null,
        assignedToId: { not: null },
      },
      take: 100,
      select: { id: true, requestNo: true, title: true, assignedToId: true },
    });
    for (const request of due) {
      await this.notifications.emit('sourcing.sla_overdue', request.assignedToId as string, {
        requestNo: request.requestNo,
        title: request.title,
      });
      await this.prisma.sourcingRequest.update({
        where: { id: request.id },
        data: { slaRemindedAt: now },
      });
    }
    return { reminded: due.length };
  }

  // ---------------------------------------------------------------- helpers

  // Lazy expiry: open/quoted requests past expiresAt become EXPIRED, so they
  // accept no new quotes and cannot be selected (quote module calls this too).
  async expireDue(now = new Date()): Promise<number> {
    const result = await this.prisma.sourcingRequest.updateMany({
      where: {
        status: { in: ['OPEN', 'QUOTED'] },
        expiresAt: { lt: now },
        deletedAt: null,
      },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }

  // Used by the quote endpoints (P4.10+): rejects closed/expired requests.
  async assertAcceptingQuotes(id: string): Promise<void> {
    await this.expireDue();
    const request = await this.prisma.sourcingRequest.findFirst({
      where: { id, deletedAt: null },
      select: { status: true },
    });
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');
    if (request.status !== 'OPEN' && request.status !== 'QUOTED') {
      throw new ConflictException('Yêu cầu không còn nhận báo giá.');
    }
  }

  private async assertCategory(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('Danh mục không tồn tại.');
  }

  private async validateFiles(fileObjectIds: string[]): Promise<void> {
    if (fileObjectIds.length === 0) return;
    const files = await this.prisma.fileObject.findMany({
      where: { id: { in: fileObjectIds } },
      select: { id: true, status: true, scanStatus: true },
    });
    if (files.length !== fileObjectIds.length) {
      throw new BadRequestException('Một số ảnh không tồn tại.');
    }
    for (const file of files) {
      if (file.status !== 'READY') {
        throw new BadRequestException('Ảnh chưa hoàn tất upload (chưa READY).');
      }
      if (file.scanStatus === 'INFECTED' || file.scanStatus === 'ERROR') {
        throw new BadRequestException('Ảnh không qua được quét virus.');
      }
    }
  }

  private adminInclude() {
    return {
      buyer: { select: { id: true, email: true } },
      assignedTo: { select: { id: true, email: true } },
      category: { select: { id: true, name: true } },
      attachments: { include: { fileObject: { select: { s3Key: true } } } },
      internalNotes: { orderBy: { createdAt: 'desc' as const } },
      _count: { select: { quotes: true } },
    };
  }

  // Buyer whitelist: no internal notes, assignee, SLA or reminder fields.
  private mapBuyer(
    request: {
      id: string;
      requestNo: string;
      title: string;
      content: string | null;
      quantity: number | null;
      market: string | null;
      category?: { id: string; name: string } | null;
      targetPrice: unknown;
      currency: string;
      expiresAt: Date | null;
      status: string;
      createdAt: Date;
      updatedAt: Date;
      attachments: Array<{
        id: string;
        fileObjectId: string | null;
        sortIndex: number;
        fileObject: { s3Key: string } | null;
      }>;
    },
    quoteCount = 0,
  ) {
    return {
      id: request.id,
      requestNo: request.requestNo,
      title: request.title,
      content: request.content,
      quantity: request.quantity,
      market: request.market,
      category: request.category ?? null,
      targetPrice: request.targetPrice,
      currency: request.currency,
      expiresAt: request.expiresAt,
      status: request.status,
      quoteCount,
      attachments: request.attachments.map((attachment) => ({
        id: attachment.id,
        fileObjectId: attachment.fileObjectId,
        s3Key: attachment.fileObject?.s3Key ?? null,
        sortIndex: attachment.sortIndex,
      })),
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  private mapAdmin(request: {
    id: string;
    requestNo: string;
    title: string;
    content: string | null;
    quantity: number | null;
    market: string | null;
    targetPrice: unknown;
    currency: string;
    expiresAt: Date | null;
    status: string;
    slaDueAt: Date | null;
    slaRemindedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    buyer: { id: string; email: string };
    assignedTo: { id: string; email: string } | null;
    attachments: Array<{
      id: string;
      fileObjectId: string | null;
      sortIndex: number;
      fileObject: { s3Key: string } | null;
    }>;
    internalNotes: Array<{ id: string; body: string; authorId: string; createdAt: Date }>;
    _count?: { quotes: number };
  }) {
    return {
      ...this.mapBuyer(request, request._count?.quotes ?? 0),
      buyer: request.buyer,
      assignedTo: request.assignedTo,
      slaDueAt: request.slaDueAt,
      slaRemindedAt: request.slaRemindedAt,
      internalNotes: request.internalNotes,
    };
  }
}
