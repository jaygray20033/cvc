import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateQuoteInput,
  SupplierRequestQueryInput,
  UpdateQuoteInput,
} from './sourcing-requests.dto';
import { SourcingRequestsService } from './sourcing-requests.service';

// P4.9 — supplier quoting. Visibility is invite-based or category-matched;
// a supplier only ever sees its own quote for an RFQ (never competitors').
// Expired RFQs accept no new quotes and cannot be updated.
@Injectable()
export class SupplierQuotesService {
  private readonly logger = new Logger(SupplierQuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly requests: SourcingRequestsService,
  ) {}

  async listRequests(userId: string, query: SupplierRequestQueryInput) {
    const supplierId = await this.resolveSupplierId(userId);
    await this.requests.expireDue();
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const where: Prisma.SourcingRequestWhereInput = {
      deletedAt: null,
      status: query.status ?? { in: ['OPEN', 'QUOTED'] },
      ...(await this.visibilityWhere(supplierId)),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sourcingRequest.count({ where }),
      this.prisma.sourcingRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: { select: { id: true, name: true } },
          attachments: { include: { fileObject: { select: { s3Key: true } } } },
          invitations: { where: { supplierId }, select: { id: true } },
          quotes: {
            where: { supplierId, status: { in: ['SUBMITTED', 'WITHDRAWN'] } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        ...this.mapRequest(row),
        invited: row.invitations.length > 0,
        myQuote: row.quotes[0] ? this.mapQuote(row.quotes[0]) : null,
      })),
      page,
      limit,
      total,
    };
  }

  async createQuote(userId: string, requestId: string, input: CreateQuoteInput) {
    const supplierId = await this.resolveSupplierId(userId);
    const request = await this.findVisibleRequest(supplierId, requestId);
    // 409 for expired/closed requests (DoD), 404 for invisible ones.
    await this.requests.assertAcceptingQuotes(requestId);
    this.assertMoq(input.moq, request.quantity);
    this.assertValidUntil(input.validUntil);

    const existing = await this.prisma.quote.findFirst({
      where: { requestId, supplierId },
      select: { id: true },
    });
    const data = {
      unitPrice: input.unitPrice,
      currency: input.currency ?? request.currency,
      moq: input.moq,
      leadTimeDays: input.leadTimeDays,
      validUntil: input.validUntil,
      deliveryTerms: input.deliveryTerms,
      note: input.note,
      status: 'SUBMITTED' as const,
      selectedAt: null,
    };
    // Re-quoting after a withdrawal reuses the same row (one quote/supplier).
    const quote = existing
      ? await this.prisma.quote.update({ where: { id: existing.id }, data })
      : await this.prisma.quote.create({ data: { ...data, requestId, supplierId } });

    if (request.status === 'OPEN') {
      await this.prisma.sourcingRequest.update({
        where: { id: requestId },
        data: { status: 'QUOTED' },
      });
    }
    if (!existing) {
      await this.notifications.emit('sourcing.quote_received', request.buyerId, {
        requestNo: request.requestNo,
        title: request.title,
        unitPrice: input.unitPrice,
        currency: data.currency,
      });
    }
    this.logger.log({ requestId, supplierId, quoteId: quote.id }, 'quote submitted');
    return this.mapQuote(quote);
  }

  async updateQuote(userId: string, quoteId: string, input: UpdateQuoteInput) {
    const supplierId = await this.resolveSupplierId(userId);
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, supplierId },
      include: { request: { select: { id: true, quantity: true } } },
    });
    if (!quote) throw new NotFoundException('Báo giá không tồn tại.');
    if (quote.status !== 'SUBMITTED') {
      throw new ConflictException('Chỉ sửa được báo giá đang chờ chọn.');
    }
    await this.requests.assertAcceptingQuotes(quote.requestId);
    if (input.moq !== undefined) this.assertMoq(input.moq, quote.request.quantity);
    this.assertValidUntil(input.validUntil);

    const updated = await this.prisma.quote.update({
      where: { id: quote.id },
      data: {
        unitPrice: input.unitPrice,
        currency: input.currency,
        moq: input.moq,
        leadTimeDays: input.leadTimeDays,
        validUntil: input.validUntil,
        deliveryTerms: input.deliveryTerms,
        note: input.note,
      },
    });
    return this.mapQuote(updated);
  }

  async withdrawQuote(userId: string, quoteId: string) {
    const supplierId = await this.resolveSupplierId(userId);
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, supplierId },
      select: { id: true, requestId: true, status: true },
    });
    if (!quote) throw new NotFoundException('Báo giá không tồn tại.');
    if (quote.status === 'WITHDRAWN') return { id: quote.id, status: 'WITHDRAWN' };
    if (quote.status !== 'SUBMITTED') {
      throw new ConflictException('Không thể rút báo giá đã được chọn hoặc đã đóng.');
    }
    await this.prisma.quote.update({
      where: { id: quote.id },
      data: { status: 'WITHDRAWN' },
    });
    // Last open quote gone: the RFQ is open for quoting again.
    const remaining = await this.prisma.quote.count({
      where: { requestId: quote.requestId, status: 'SUBMITTED' },
    });
    if (remaining === 0) {
      await this.prisma.sourcingRequest.updateMany({
        where: { id: quote.requestId, status: 'QUOTED' },
        data: { status: 'OPEN' },
      });
    }
    return { id: quote.id, status: 'WITHDRAWN' };
  }

  // ---------------------------------------------------------------- helpers

  private async findVisibleRequest(supplierId: string, requestId: string) {
    const request = await this.prisma.sourcingRequest.findFirst({
      where: {
        id: requestId,
        deletedAt: null,
        ...(await this.visibilityWhere(supplierId)),
      },
      select: {
        id: true,
        requestNo: true,
        title: true,
        quantity: true,
        currency: true,
        status: true,
        buyerId: true,
      },
    });
    // Invisible and non-existent look identical on purpose (DoD).
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');
    return request;
  }

  // Invited by sales OR has an approved listing in the RFQ category.
  private async visibilityWhere(supplierId: string): Promise<Prisma.SourcingRequestWhereInput> {
    const categoryIds = await this.matchingCategoryIds(supplierId);
    return {
      OR: [
        { invitations: { some: { supplierId } } },
        ...(categoryIds.length > 0 ? [{ categoryId: { in: categoryIds } }] : []),
      ],
    };
  }

  private async matchingCategoryIds(supplierId: string): Promise<string[]> {
    const rows = await this.prisma.supplierProduct.findMany({
      where: { supplierId, approvedAt: { not: null } },
      select: { product: { select: { categoryId: true } } },
    });
    return [...new Set(rows.map((row) => row.product.categoryId))];
  }

  private assertMoq(moq: number, quantity: number | null): void {
    if (quantity !== null && moq > quantity) {
      throw new BadRequestException('MOQ không được lớn hơn số lượng khách yêu cầu.');
    }
  }

  private assertValidUntil(validUntil?: Date): void {
    if (validUntil && validUntil.getTime() <= Date.now()) {
      throw new BadRequestException('Hiệu lực báo giá phải ở tương lai.');
    }
  }

  private async resolveSupplierId(userId: string): Promise<string> {
    const account = await this.prisma.supplierAccount.findUnique({
      where: { userId },
      select: { supplierId: true, status: true },
    });
    if (!account) throw new NotFoundException('Tài khoản chưa liên kết nhà cung cấp.');
    if (account.status === 'SUSPENDED') {
      throw new ConflictException({
        code: 'SUPPLIER_ACCOUNT_SUSPENDED',
        message: 'Tài khoản nhà cung cấp đã bị khóa.',
      });
    }
    return account.supplierId;
  }

  // Supplier view of an RFQ: no buyer identity, no competitors' quotes.
  private mapRequest(request: {
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
    createdAt: Date;
    category: { id: string; name: string } | null;
    attachments: Array<{
      id: string;
      fileObjectId: string | null;
      sortIndex: number;
      fileObject: { s3Key: string } | null;
    }>;
  }) {
    return {
      id: request.id,
      requestNo: request.requestNo,
      title: request.title,
      content: request.content,
      quantity: request.quantity,
      market: request.market,
      category: request.category,
      targetPrice: request.targetPrice,
      currency: request.currency,
      expiresAt: request.expiresAt,
      status: request.status,
      attachments: request.attachments.map((attachment) => ({
        id: attachment.id,
        fileObjectId: attachment.fileObjectId,
        s3Key: attachment.fileObject?.s3Key ?? null,
        sortIndex: attachment.sortIndex,
      })),
      createdAt: request.createdAt,
    };
  }

  private mapQuote(quote: {
    id: string;
    requestId: string;
    unitPrice: unknown;
    currency: string;
    moq: number;
    leadTimeDays: number;
    validUntil: Date | null;
    deliveryTerms: string | null;
    note: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: quote.id,
      requestId: quote.requestId,
      unitPrice: quote.unitPrice,
      currency: quote.currency,
      moq: quote.moq,
      leadTimeDays: quote.leadTimeDays,
      validUntil: quote.validUntil,
      deliveryTerms: quote.deliveryTerms,
      note: quote.note,
      status: quote.status,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
    };
  }
}
