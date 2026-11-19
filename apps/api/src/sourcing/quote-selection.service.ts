import { randomBytes } from 'node:crypto';

import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { SelectQuoteInput } from './sourcing-requests.dto';
import { SourcingRequestsService } from './sourcing-requests.service';

// P4.10 — buyer compares quotes and selects one. Selection is idempotent:
// repeating it with the same quote returns the existing order, while a
// different quote after selection is rejected. Converting a quote opens the
// order and its Deal Room in a single transaction.
@Injectable()
export class QuoteSelectionService {
  private readonly logger = new Logger(QuoteSelectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly requests: SourcingRequestsService,
    private readonly realtime: RealtimeService,
  ) {}

  // Compare columns: unit price, MOQ, lead time, validity (DoD).
  async listQuotes(buyer: AccessPayload, requestId: string) {
    await this.requests.expireDue();
    const request = await this.prisma.sourcingRequest.findFirst({
      where: { id: requestId, buyerId: buyer.sub, deletedAt: null },
      select: {
        id: true,
        requestNo: true,
        title: true,
        quantity: true,
        currency: true,
        expiresAt: true,
        status: true,
        selection: { select: { quoteId: true } },
      },
    });
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');

    // Quotes past their own validity are shown as EXPIRED and cannot be chosen.
    await this.prisma.quote.updateMany({
      where: { requestId, status: 'SUBMITTED', validUntil: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    const quotes = await this.prisma.quote.findMany({
      where: { requestId, status: { in: ['SUBMITTED', 'SELECTED', 'REJECTED', 'EXPIRED'] } },
      orderBy: [{ unitPrice: 'asc' }, { createdAt: 'asc' }],
      include: { supplier: { select: { id: true, name: true } } },
    });
    return {
      request: {
        id: request.id,
        requestNo: request.requestNo,
        title: request.title,
        quantity: request.quantity,
        currency: request.currency,
        expiresAt: request.expiresAt,
        status: request.status,
        selectedQuoteId: request.selection?.quoteId ?? null,
      },
      quotes: quotes.map((quote) => ({
        id: quote.id,
        supplier: quote.supplier,
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
      })),
    };
  }

  async selectQuote(buyer: AccessPayload, requestId: string, input: SelectQuoteInput) {
    await this.requests.expireDue();
    const request = await this.prisma.sourcingRequest.findFirst({
      where: { id: requestId, buyerId: buyer.sub, deletedAt: null },
      select: {
        id: true,
        requestNo: true,
        title: true,
        quantity: true,
        status: true,
        assignedToId: true,
        selection: { select: { id: true, quoteId: true } },
      },
    });
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');

    // DoD: selecting twice creates one order (same quote → same order).
    if (request.selection) {
      if (request.selection.quoteId === input.quoteId) {
        return this.buildResponse(requestId, request.selection.id, input.quoteId, true);
      }
      throw new ConflictException('Yêu cầu đã chọn một báo giá khác.');
    }
    if (request.status !== 'OPEN' && request.status !== 'QUOTED') {
      throw new ConflictException('Yêu cầu không còn nhận báo giá.');
    }

    const quote = await this.prisma.quote.findFirst({
      where: { id: input.quoteId, requestId },
      select: {
        id: true,
        supplierId: true,
        unitPrice: true,
        currency: true,
        moq: true,
        status: true,
        validUntil: true,
      },
    });
    if (!quote) throw new NotFoundException('Báo giá không tồn tại.');
    if (quote.status !== 'SUBMITTED') {
      throw new ConflictException('Báo giá không còn hiệu lực để chọn.');
    }
    if (quote.validUntil && quote.validUntil.getTime() <= Date.now()) {
      await this.prisma.quote.update({
        where: { id: quote.id },
        data: { status: 'EXPIRED' },
      });
      throw new ConflictException('Báo giá đã hết hiệu lực.');
    }

    const quantity = request.quantity ?? quote.moq;
    const totalAmount = new Prisma.Decimal(quote.unitPrice).mul(quantity);

    let created: {
      selectionId: string;
      orderId: string;
      dealRoomId: string;
      memberIds: string[];
    };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const selection = await tx.quoteSelection.create({
          data: {
            requestId,
            quoteId: quote.id,
            decidedById: buyer.sub,
            note: input.note,
          },
        });
        await tx.quote.update({
          where: { id: quote.id },
          data: { status: 'SELECTED', selectedAt: new Date() },
        });
        await tx.quote.updateMany({
          where: { requestId, id: { not: quote.id }, status: 'SUBMITTED' },
          data: { status: 'REJECTED' },
        });
        await tx.sourcingRequest.update({
          where: { id: requestId },
          data: { status: 'CONVERTED' },
        });

        const order = await tx.order.create({
          data: {
            orderNo: `CVC-ORD-${randomBytes(5).toString('hex').toUpperCase()}`,
            buyerId: buyer.sub,
            supplierId: quote.supplierId,
            sourcingRequestId: requestId,
            selectedQuoteId: quote.id,
            status: 'NEGOTIATING',
            stageIndex: 0,
            totalAmount,
            currency: quote.currency,
            note: input.note,
          },
          select: { id: true },
        });
        await tx.orderStageLog.create({
          data: {
            orderId: order.id,
            stageIndex: 0,
            status: 'NEGOTIATING',
            actorId: buyer.sub,
            note: 'Chọn báo giá và tạo đơn',
          },
        });

        // Reuse the RFQ room when it already exists (e.g. concierge), else open
        // a new room tied to both the order and the RFQ.
        const existingRoom = await tx.dealRoom.findUnique({
          where: { sourcingRequestId: requestId },
          select: { id: true },
        });
        const room = existingRoom
          ? await tx.dealRoom.update({
              where: { id: existingRoom.id },
              data: { orderId: order.id },
              select: { id: true },
            })
          : await tx.dealRoom.create({
              data: {
                orderId: order.id,
                sourcingRequestId: requestId,
                title: request.title,
                status: 'OPEN',
              },
              select: { id: true },
            });

        const members = new Map<string, string>();
        members.set(buyer.sub, 'buyer');
        if (request.assignedToId) members.set(request.assignedToId, 'sales');
        const accounts = await tx.supplierAccount.findMany({
          where: { supplierId: quote.supplierId },
          select: { userId: true },
        });
        for (const account of accounts) members.set(account.userId, 'supplier');
        for (const [userId, role] of members) {
          await tx.dealRoomMember.upsert({
            where: { roomId_userId: { roomId: room.id, userId } },
            create: { roomId: room.id, userId, role },
            update: {},
          });
        }
        return {
          selectionId: selection.id,
          orderId: order.id,
          dealRoomId: room.id,
          memberIds: [...members.keys()],
        };
      });
    } catch (error) {
      // Concurrent double-select: the second transaction hits the unique
      // requestId key. Same quote stays idempotent, a different one conflicts.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const selection = await this.prisma.quoteSelection.findUnique({
          where: { requestId },
          select: { id: true, quoteId: true },
        });
        if (selection?.quoteId === input.quoteId) {
          return this.buildResponse(requestId, selection.id, input.quoteId, true);
        }
        throw new ConflictException('Yêu cầu đã chọn một báo giá khác.');
      }
      throw error;
    }

    await this.notifySelection(requestId, request.requestNo, request.title, quote.supplierId);
    // P4.12: room members may join the realtime room right away.
    await Promise.all(
      created.memberIds.map((userId) =>
        this.realtime.grantDealRoomAccess(created.dealRoomId, userId),
      ),
    );

    this.logger.log(
      { requestId, quoteId: quote.id, orderId: created.orderId, buyerId: buyer.sub },
      'quote selected',
    );
    return this.buildResponse(requestId, created.selectionId, quote.id, false);
  }

  // ---------------------------------------------------------------- helpers

  private async notifySelection(
    requestId: string,
    requestNo: string,
    title: string,
    winnerSupplierId: string,
  ): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { sourcingRequestId: requestId },
      select: { orderNo: true, totalAmount: true, currency: true },
    });
    const winnerAccounts = await this.prisma.supplierAccount.findMany({
      where: { supplierId: winnerSupplierId },
      select: { userId: true },
    });
    for (const account of winnerAccounts) {
      await this.notifications.emit('sourcing.quote_selected', account.userId, {
        requestNo,
        title,
        orderNo: order?.orderNo,
        totalAmount: order?.totalAmount?.toString(),
        currency: order?.currency,
      });
    }
    const rejected = await this.prisma.quote.findMany({
      where: { requestId, status: 'REJECTED' },
      select: {
        supplierId: true,
        supplier: { select: { accounts: { select: { userId: true } } } },
      },
    });
    for (const quote of rejected) {
      if (quote.supplierId === winnerSupplierId) continue;
      for (const account of quote.supplier.accounts) {
        await this.notifications.emit('sourcing.quote_rejected', account.userId, {
          requestNo,
          title,
        });
      }
    }
  }

  private async buildResponse(
    requestId: string,
    selectionId: string,
    quoteId: string,
    idempotent: boolean,
  ) {
    const [order, room] = await Promise.all([
      this.prisma.order.findFirst({
        where: { sourcingRequestId: requestId },
        select: {
          id: true,
          orderNo: true,
          status: true,
          stageIndex: true,
          totalAmount: true,
          currency: true,
          createdAt: true,
        },
      }),
      this.prisma.dealRoom.findUnique({
        where: { sourcingRequestId: requestId },
        select: { id: true },
      }),
    ]);
    return {
      selectionId,
      requestId,
      quoteId,
      order,
      dealRoomId: room?.id ?? null,
      idempotent,
    };
  }
}
