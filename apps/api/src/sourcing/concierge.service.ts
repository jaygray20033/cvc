import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AdminConciergeRequestInput, OpenConciergeRoomInput } from './sourcing-requests.dto';
import { SourcingRequestsService } from './sourcing-requests.service';

// P4.11 — CVC concierge. Sales files a sourcing request for a walk-in customer
// (guest user under the hood) and connects the matched supplier in one private
// order + Deal Room. Opening the room is idempotent and never changes roles.
@Injectable()
export class ConciergeService {
  private readonly logger = new Logger(ConciergeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly requests: SourcingRequestsService,
    private readonly realtime: RealtimeService,
  ) {}

  async createRequest(actor: AccessPayload, input: AdminConciergeRequestInput) {
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Hạn nhận báo giá phải ở tương lai.');
    }
    if (input.categoryId) await this.assertCategory(input.categoryId);
    if (input.referenceProductId) await this.assertReferenceProduct(input.referenceProductId);
    const buyer = await this.resolveBuyer(input);

    const request = await this.prisma.sourcingRequest.create({
      data: {
        requestNo: `CVC-RFQ-${randomBytes(5).toString('hex').toUpperCase()}`,
        buyerId: buyer.userId,
        title: input.title,
        content: input.content,
        quantity: input.quantity,
        categoryId: input.categoryId,
        referenceProductId: input.referenceProductId,
        market: input.market,
        // No target price ⇒ budgetSpecified = false (P4.11 DoD).
        targetPrice: input.targetPrice,
        currency: input.currency ?? 'VND',
        expiresAt: input.expiresAt,
        status: 'OPEN',
        workflow: 'CONCIERGE',
        contactName: input.buyerName,
        contactPhone: input.buyerPhone,
        assignedToId: actor.sub,
        slaDueAt: new Date(Date.now() + 2 * 86_400_000),
      },
      select: { id: true, requestNo: true, title: true, quantity: true },
    });

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
    this.logger.log(
      { requestId: request.id, actor: actor.sub, guest: buyer.guest },
      'concierge request created',
    );

    const created = await this.requests.getAdmin(request.id);
    if (!input.startExperience) return created;

    const room = await this.openRoomInternal(actor, request.id);
    return { request: created, ...room };
  }

  // Sales/admin endpoint: connect the matched (or chosen) supplier.
  async openRoom(actor: AccessPayload, input: OpenConciergeRoomInput) {
    return this.openRoomInternal(actor, input.requestId, {
      quoteId: input.quoteId,
      supplierId: input.supplierId,
    });
  }

  // Buyer self-serve "start sourcing experience": own request only.
  async startExperienceForBuyer(actor: AccessPayload, requestId: string) {
    const request = await this.prisma.sourcingRequest.findFirst({
      where: { id: requestId, buyerId: actor.sub, deletedAt: null },
      select: { id: true },
    });
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');
    await this.prisma.sourcingRequest.update({
      where: { id: requestId },
      data: { workflow: 'CONCIERGE' },
    });
    return this.openRoomInternal(actor, requestId);
  }

  // ---------------------------------------------------------------- helpers

  private async openRoomInternal(
    actor: AccessPayload,
    requestId: string,
    input: { quoteId?: string; supplierId?: string } = {},
  ) {
    // DoD: repeating the call returns the same single order.
    const existing = await this.findExistingOrder(requestId);
    if (existing) return { ...existing, idempotent: true };

    await this.requests.expireDue();
    const request = await this.prisma.sourcingRequest.findFirst({
      where: { id: requestId, deletedAt: null },
      include: {
        referenceProduct: { select: { id: true, categoryId: true, priceRef: true } },
        quotes: {
          where: { status: 'SUBMITTED' },
          include: {
            supplier: {
              select: {
                id: true,
                name: true,
                deletedAt: true,
                accounts: { select: { userId: true, status: true } },
              },
            },
          },
        },
      },
    });
    if (!request) throw new NotFoundException('Yêu cầu không tồn tại.');
    if (request.status !== 'OPEN' && request.status !== 'QUOTED') {
      throw new ConflictException(
        'Yêu cầu đã đóng hoặc quá hạn. Vui lòng gửi nhu cầu mới cho CVC.',
      );
    }

    let supplierId = input.supplierId;
    const quote = input.quoteId
      ? request.quotes.find(
          (row) =>
            row.id === input.quoteId &&
            row.supplier.accounts.some((account) => account.status === 'ACTIVE'),
        )
      : undefined;
    if (input.quoteId && !quote) {
      throw new ConflictException('Báo giá được chọn không còn hợp lệ.');
    }
    if (quote) supplierId = quote.supplierId;

    if (!supplierId) {
      // Auto-match: active supplier with an approved listing in the RFQ
      // category (or in the reference product's category).
      const categoryId = request.categoryId ?? request.referenceProduct?.categoryId;
      if (categoryId) {
        const matched = await this.prisma.supplier.findFirst({
          where: {
            deletedAt: null,
            status: 'ACTIVE',
            accounts: { some: { status: 'ACTIVE' } },
            supplierProducts: {
              some: { approvedAt: { not: null }, product: { categoryId, deletedAt: null } },
            },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
        });
        if (!matched) {
          throw new ConflictException({
            code: 'NO_MATCHING_SUPPLIER',
            message: 'CVC chưa có nguồn phù hợp. Yêu cầu vẫn được giữ để tiếp tục xử lý.',
            requestId,
          });
        }
        supplierId = matched.id;
      } else {
        throw new ConflictException({
          code: 'NO_MATCHING_SUPPLIER',
          message: 'Cần chọn danh mục hoặc sản phẩm tham khảo để ghép nhà cung cấp.',
          requestId,
        });
      }
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, deletedAt: null },
      select: { id: true, name: true, accounts: { select: { userId: true } } },
    });
    if (!supplier) throw new NotFoundException('Nhà cung cấp không tồn tại.');

    const quoteForSupplier = quote ?? request.quotes.find((row) => row.supplierId === supplier.id);
    const quantity = request.quantity ?? quoteForSupplier?.moq ?? 1;
    const unitPrice =
      quoteForSupplier?.unitPrice ?? request.targetPrice ?? request.referenceProduct?.priceRef ?? 0;
    const currency = quoteForSupplier?.currency ?? request.currency;
    const totalAmount = new Prisma.Decimal(unitPrice).mul(quantity);

    const created = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNo: `CVC-ORD-${randomBytes(5).toString('hex').toUpperCase()}`,
          buyerId: request.buyerId,
          supplierId: supplier.id,
          sourcingRequestId: request.id,
          selectedQuoteId: quoteForSupplier?.id,
          status: 'NEGOTIATING',
          stageIndex: 0,
          totalAmount,
          currency,
          note: 'CVC ghép nguồn theo yêu cầu concierge',
        },
        select: { id: true, orderNo: true },
      });
      await tx.orderStageLog.create({
        data: {
          orderId: order.id,
          stageIndex: 0,
          status: 'NEGOTIATING',
          actorId: actor.sub,
          note: 'CVC mở phòng giới thiệu nhà cung cấp',
        },
      });

      if (quoteForSupplier) {
        await tx.quoteSelection.upsert({
          where: { requestId: request.id },
          create: {
            requestId: request.id,
            quoteId: quoteForSupplier.id,
            decidedById: actor.sub,
            note: 'CVC ghép nguồn',
          },
          update: {},
        });
        await tx.quote.update({
          where: { id: quoteForSupplier.id },
          data: { status: 'SELECTED', selectedAt: new Date() },
        });
        await tx.quote.updateMany({
          where: { requestId: request.id, id: { not: quoteForSupplier.id }, status: 'SUBMITTED' },
          data: { status: 'REJECTED' },
        });
      }
      await tx.sourcingRequest.update({
        where: { id: request.id },
        data: { status: 'CONVERTED' },
      });

      const existingRoom = await tx.dealRoom.findUnique({
        where: { sourcingRequestId: request.id },
        select: { id: true },
      });
      const room = existingRoom
        ? await tx.dealRoom.update({
            where: { id: existingRoom.id },
            data: { orderId: order.id, title: request.title },
            select: { id: true },
          })
        : await tx.dealRoom.create({
            data: {
              orderId: order.id,
              sourcingRequestId: request.id,
              title: request.title,
              status: 'OPEN',
            },
            select: { id: true },
          });

      // Intro message: the buyer learns the supplier inside the private room.
      await tx.message.create({
        data: {
          roomId: room.id,
          type: 'SYSTEM',
          body:
            'CVC đã tiếp nhận yêu cầu và kết nối nguồn phù hợp. ' +
            `Nhà cung cấp được giới thiệu trong phòng này: ${supplier.name}. ` +
            'Giá trong phòng là minh họa; bạn có thể đề xuất giá khác. ' +
            'Cùng chốt thông số, báo giá và mẫu trước khi ký hợp đồng.',
        },
      });

      const members = new Map<string, string>();
      members.set(request.buyerId, 'buyer');
      members.set(actor.sub, actor.role ?? 'sales');
      if (request.assignedToId) members.set(request.assignedToId, 'sales');
      for (const account of supplier.accounts) members.set(account.userId, 'supplier');
      for (const [userId, role] of members) {
        await tx.dealRoomMember.upsert({
          where: { roomId_userId: { roomId: room.id, userId } },
          create: { roomId: room.id, userId, role },
          update: {},
        });
      }
      return { order, roomId: room.id, memberIds: [...members.keys()] };
    });

    await this.notifyRoomOpened(request, supplier.id, created.order.orderNo);
    // P4.12: room members may join the realtime room right away.
    await this.grantRoomAccess(created.roomId, created.memberIds);

    this.logger.log(
      { requestId: request.id, orderId: created.order.id, supplierId: supplier.id },
      'concierge room opened',
    );
    return {
      requestId: request.id,
      idempotent: false,
      order: {
        id: created.order.id,
        orderNo: created.order.orderNo,
        status: 'NEGOTIATING',
        stageIndex: 0,
        totalAmount,
        currency,
      },
      dealRoomId: created.roomId,
      supplier: { id: supplier.id, name: supplier.name },
    };
  }

  private async findExistingOrder(requestId: string) {
    const order = await this.prisma.order.findFirst({
      where: { sourcingRequestId: requestId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        orderNo: true,
        status: true,
        stageIndex: true,
        totalAmount: true,
        currency: true,
        supplier: { select: { id: true, name: true } },
      },
    });
    if (!order) return null;
    const room = await this.prisma.dealRoom.findUnique({
      where: { sourcingRequestId: requestId },
      select: { id: true, members: { select: { userId: true } } },
    });
    // Self-heal the realtime allow-list when the room was opened before P4.12.
    if (room) {
      await this.grantRoomAccess(
        room.id,
        room.members.map((member) => member.userId),
      );
    }
    return {
      requestId,
      order,
      dealRoomId: room?.id ?? null,
      supplier: order.supplier,
    };
  }

  private async grantRoomAccess(roomId: string, userIds: string[]): Promise<void> {
    await Promise.all(userIds.map((userId) => this.realtime.grantDealRoomAccess(roomId, userId)));
  }

  private async notifyRoomOpened(
    request: { id: string; requestNo: string; title: string; buyerId: string },
    supplierId: string,
    orderNo: string,
  ): Promise<void> {
    const accounts = await this.prisma.supplierAccount.findMany({
      where: { supplierId, status: 'ACTIVE' },
      select: { userId: true },
    });
    for (const account of accounts) {
      // Supplier name stays out of notification copy (P4.11 privacy test).
      await this.notifications.emit('sourcing.room_opened', account.userId, {
        requestNo: request.requestNo,
        title: request.title,
        orderNo,
      });
    }
    await this.notifications.emit('sourcing.room_ready', request.buyerId, {
      requestNo: request.requestNo,
      title: request.title,
    });
  }

  private async resolveBuyer(input: AdminConciergeRequestInput) {
    if (input.buyerId) {
      const buyer = await this.prisma.user.findFirst({
        where: { id: input.buyerId, userRoles: { some: { role: 'buyer' } } },
        select: { id: true },
      });
      if (!buyer) throw new BadRequestException('Khách hàng không tồn tại hoặc không phải buyer.');
      return { userId: buyer.id, guest: false };
    }

    // Walk-in customer: reuse an existing phone, else create a guest buyer.
    if (input.buyerPhone) {
      const existing = await this.prisma.user.findUnique({
        where: { phone: input.buyerPhone },
        select: { id: true },
      });
      if (existing) return { userId: existing.id, guest: false };
    }
    const guest = await this.prisma.user.create({
      data: {
        email: `guest-${randomBytes(8).toString('hex')}@concierge.local`,
        phone: input.buyerPhone,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        userRoles: { create: { role: 'buyer' } },
      },
      select: { id: true },
    });
    this.logger.log({ userId: guest.id }, 'guest buyer created for concierge');
    return { userId: guest.id, guest: true };
  }

  private async assertCategory(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw new BadRequestException('Danh mục không tồn tại.');
  }

  private async assertReferenceProduct(productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new BadRequestException('Sản phẩm tham khảo không tồn tại.');
  }
}
