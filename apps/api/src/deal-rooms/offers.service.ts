import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Offer, Prisma } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { CounterOfferInput, CreateOfferInput, SaveDealTermsInput } from './deal-rooms.dto';
import { DealRoomsService } from './deal-rooms.service';
import { DealRoomMessagesService } from './messages.service';

// P4.15 — offers, counter-offers and locked terms. Only the two parties may
// act: buyers and suppliers. Sales/admin keep read access through P4.12 but
// cannot set prices or confirm terms. Accepting an offer updates the order's
// current price; locking terms requires both sides to confirm the same draft
// version and freezes an immutable LockedTerms snapshot.
type PartySide = 'buyer' | 'supplier';
type RoomForActor = Awaited<ReturnType<DealRoomsService['assertMember']>>;

const TERMS_LOCKED = 'Điều khoản đã được khóa; cần mở lại theo quy trình riêng.';

@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: DealRoomsService,
    private readonly messages: DealRoomMessagesService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  // POST /deal-rooms/:id/offers
  async create(actor: AccessPayload, roomId: string, input: CreateOfferInput) {
    const { room, side } = await this.roomFor(actor, roomId);
    this.assertNegotiating(room);
    const currency = this.resolveCurrency(room, input.currency);

    const created = await this.prisma.$transaction(async (tx) => {
      // A fresh offer replaces this side's still-pending one.
      await tx.offer.updateMany({
        where: { roomId, createdById: actor.sub, status: 'PENDING' },
        data: { status: 'WITHDRAWN', decidedAt: new Date() },
      });
      return tx.offer.create({
        data: {
          roomId,
          createdById: actor.sub,
          unitPrice: new Prisma.Decimal(input.unitPrice),
          quantity: input.quantity,
          currency,
          conditions: input.conditions ?? null,
          validUntil: input.validUntil ?? null,
        },
      });
    });

    const mapped = this.mapOffer(created, side);
    await this.messages.postOfferMessage(
      roomId,
      actor.sub,
      `${this.sideLabel(side)} đề nghị đơn giá ${this.formatMoney(created.unitPrice, currency)} × ${created.quantity}` +
        `${created.conditions ? ` (${created.conditions})` : ''}.`,
      { offerId: created.id, status: created.status, side },
    );
    await this.notifyOtherParty(roomId, actor.sub, 'deal.offer_received', {
      offerId: created.id,
      unitPrice: created.unitPrice.toString(),
      quantity: created.quantity,
      currency,
    });
    this.logger.log({ roomId, offerId: created.id, side }, 'offer created');
    return mapped;
  }

  // POST /offers/:id/accept — only the other side, only the current offer.
  async accept(actor: AccessPayload, offerId: string) {
    const offer = await this.loadOffer(offerId);
    const { room, side } = await this.roomFor(actor, offer.roomId);
    if (offer.createdById === actor.sub) {
      throw new ForbiddenException('Bạn không thể chấp nhận đề nghị của chính mình.');
    }
    this.assertNegotiating(room);
    await this.assertCurrentPending(offer);

    const now = new Date();
    const totalAmount = offer.unitPrice.mul(offer.quantity);
    const accepted = await this.prisma.$transaction(async (tx) => {
      // Guard against a concurrent counter/accept: only a PENDING row flips.
      const updated = await tx.offer.updateMany({
        where: { id: offer.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', decidedAt: now },
      });
      if (updated.count === 0) {
        throw this.conflict('OFFER_NOT_PENDING', 'Đề nghị này đã được xử lý.');
      }
      await tx.offer.updateMany({
        where: { roomId: offer.roomId, id: { not: offer.id }, status: 'PENDING' },
        data: { status: 'REJECTED', decidedAt: now },
      });
      if (room.order) {
        await tx.order.update({
          where: { id: room.order.id },
          data: { totalAmount, currency: offer.currency },
        });
        await tx.orderEvent.create({
          data: {
            orderId: room.order.id,
            type: 'offer.accepted',
            actorId: actor.sub,
            message: `Chấp nhận đề nghị ${this.formatMoney(offer.unitPrice, offer.currency)} × ${offer.quantity}.`,
            data: {
              offerId: offer.id,
              unitPrice: offer.unitPrice.toString(),
              quantity: offer.quantity,
              totalAmount: totalAmount.toString(),
              currency: offer.currency,
            },
          },
        });
      }
      return { ...offer, status: 'ACCEPTED' as const, decidedAt: now };
    });

    if (room.order) {
      this.realtime.toDealRoom(offer.roomId, 'order.status', {
        orderId: room.order.id,
        status: room.order.status,
        stageIndex: room.order.stageIndex,
        totalAmount: totalAmount.toString(),
        currency: offer.currency,
      });
    }

    const mapped = this.mapOffer(accepted, side === 'buyer' ? 'supplier' : 'buyer', actor.sub);
    await this.messages.postOfferMessage(
      offer.roomId,
      actor.sub,
      `${this.sideLabel(side)} đã chấp nhận đề nghị: ${this.formatMoney(offer.unitPrice, offer.currency)} × ${offer.quantity}. Giá hiện hành của đơn đã cập nhật.`,
      {
        offerId: offer.id,
        status: 'ACCEPTED',
        unitPrice: offer.unitPrice.toString(),
        quantity: offer.quantity,
        totalAmount: totalAmount.toString(),
      },
    );
    await this.notifyOtherParty(offer.roomId, actor.sub, 'deal.offer_accepted', {
      offerId: offer.id,
      unitPrice: offer.unitPrice.toString(),
      totalAmount: totalAmount.toString(),
      currency: offer.currency,
    });
    this.logger.log(
      { roomId: offer.roomId, offerId: offer.id, actor: actor.sub },
      'offer accepted',
    );
    return mapped;
  }

  // POST /offers/:id/reject — only the other side.
  async reject(actor: AccessPayload, offerId: string) {
    const offer = await this.loadOffer(offerId);
    const { room, side } = await this.roomFor(actor, offer.roomId);
    if (offer.createdById === actor.sub) {
      throw new ForbiddenException('Bạn không thể từ chối đề nghị của chính mình.');
    }
    this.assertNegotiating(room);
    if (offer.status !== 'PENDING') {
      throw this.conflict('OFFER_NOT_PENDING', 'Đề nghị này đã được xử lý.');
    }
    const now = new Date();
    const updated = await this.prisma.offer.updateMany({
      where: { id: offer.id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedAt: now },
    });
    if (updated.count === 0) {
      throw this.conflict('OFFER_NOT_PENDING', 'Đề nghị này đã được xử lý.');
    }

    const mapped = this.mapOffer(
      { ...offer, status: 'REJECTED', decidedAt: now },
      side === 'buyer' ? 'supplier' : 'buyer',
      actor.sub,
    );
    await this.messages.postOfferMessage(
      offer.roomId,
      actor.sub,
      `${this.sideLabel(side)} đã từ chối đề nghị ${this.formatMoney(offer.unitPrice, offer.currency)} × ${offer.quantity}.`,
      { offerId: offer.id, status: 'REJECTED' },
    );
    await this.notifyOtherParty(offer.roomId, actor.sub, 'deal.offer_rejected', {
      offerId: offer.id,
      unitPrice: offer.unitPrice.toString(),
      currency: offer.currency,
    });
    return mapped;
  }

  // POST /offers/:id/counter — the other side answers with a new offer.
  async counter(actor: AccessPayload, offerId: string, input: CounterOfferInput) {
    const target = await this.loadOffer(offerId);
    const { room, side } = await this.roomFor(actor, target.roomId);
    if (target.createdById === actor.sub) {
      throw new ForbiddenException('Bạn không thể đối đề nghị của chính mình.');
    }
    this.assertNegotiating(room);
    await this.assertCurrentPending(target);
    const currency = this.resolveCurrency(room, input.currency);

    const created = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.offer.updateMany({
        where: { id: target.id, status: 'PENDING' },
        data: { status: 'COUNTERED', decidedAt: new Date() },
      });
      if (updated.count === 0) {
        throw this.conflict('OFFER_NOT_PENDING', 'Đề nghị này đã được xử lý.');
      }
      // A counter replaces this side's own pending offer as well.
      await tx.offer.updateMany({
        where: { roomId: target.roomId, createdById: actor.sub, status: 'PENDING' },
        data: { status: 'WITHDRAWN', decidedAt: new Date() },
      });
      return tx.offer.create({
        data: {
          roomId: target.roomId,
          createdById: actor.sub,
          unitPrice: new Prisma.Decimal(input.unitPrice),
          quantity: input.quantity,
          currency,
          conditions: input.conditions ?? null,
          validUntil: input.validUntil ?? null,
        },
      });
    });

    const mapped = this.mapOffer(created, side);
    await this.messages.postOfferMessage(
      target.roomId,
      actor.sub,
      `${this.sideLabel(side)} đối đề nghị ${this.formatMoney(created.unitPrice, currency)} × ${created.quantity}` +
        `${created.conditions ? ` (${created.conditions})` : ''}.`,
      { offerId: created.id, status: created.status, side, counterOf: target.id },
    );
    await this.notifyOtherParty(target.roomId, actor.sub, 'deal.offer_received', {
      offerId: created.id,
      unitPrice: created.unitPrice.toString(),
      quantity: created.quantity,
      currency,
      counter: true,
    });
    this.logger.log(
      { roomId: target.roomId, offerId: created.id, counterOf: target.id },
      'offer countered',
    );
    return mapped;
  }

  // PUT /deal-rooms/:id/terms — save the editable draft (versioned).
  async saveTerms(actor: AccessPayload, roomId: string, input: SaveDealTermsInput) {
    const { room } = await this.roomFor(actor, roomId);
    this.assertNegotiating(room);
    await this.assertUnlocked(room);
    const currency = this.resolveCurrency(room, input.currency);
    const terms = input.terms as Prisma.InputJsonValue;

    const existing = await this.prisma.dealTermsDraft.findUnique({
      where: { roomId },
      select: { id: true, terms: true, version: true },
    });
    const sameContent =
      existing !== null && JSON.stringify(existing.terms) === JSON.stringify(input.terms);

    const draft = existing
      ? await this.prisma.dealTermsDraft.update({
          where: { roomId },
          data: {
            terms,
            currency,
            updatedById: actor.sub,
            ...(sameContent ? {} : { version: { increment: 1 } }),
          },
        })
      : await this.prisma.dealTermsDraft.create({
          data: { roomId, terms, currency, updatedById: actor.sub, version: 1 },
        });

    const state = await this.termsState(roomId, draft.id, draft.version);
    // A changed draft invalidates earlier confirmations; say so in the room.
    if (existing && !sameContent) {
      await this.messages.postSystemMessage(
        roomId,
        `Điều khoản đã được cập nhật lên phiên bản ${draft.version}; hai bên cần xác nhận lại.`,
      );
    }
    this.logger.log(
      { roomId, version: draft.version, actor: actor.sub, changed: !sameContent },
      'deal terms saved',
    );
    return {
      roomId,
      terms: draft.terms,
      currency: draft.currency,
      updatedById: draft.updatedById,
      ...state,
    };
  }

  // POST /deal-rooms/:id/terms/lock — records this side's confirmation; the
  // second side's call creates the immutable snapshot and moves the order on.
  async lockTerms(actor: AccessPayload, roomId: string) {
    const { room, side } = await this.roomFor(actor, roomId);
    this.assertNegotiating(room);
    await this.assertUnlocked(room);
    if (!room.order) {
      throw this.conflict('ORDER_REQUIRED', 'Phòng chưa gắn với đơn hàng.');
    }

    const draft = await this.prisma.dealTermsDraft.findUnique({ where: { roomId } });
    if (!draft) {
      throw this.conflict('TERMS_NOT_SAVED', 'Chưa có điều khoản nào được lưu để khóa.');
    }

    await this.prisma.dealTermsConfirmation.upsert({
      where: {
        draftId_userId_version: {
          draftId: draft.id,
          userId: actor.sub,
          version: draft.version,
        },
      },
      create: {
        draftId: draft.id,
        roomId,
        userId: actor.sub,
        side,
        version: draft.version,
      },
      update: {},
    });

    const confirmed = await this.termsState(roomId, draft.id, draft.version);
    if (confirmed.awaiting.length > 0) {
      await this.messages.postSystemMessage(
        roomId,
        `${this.sideLabel(side)} đã xác nhận điều khoản phiên bản ${draft.version}; chờ ${confirmed.awaiting
          .map((item) => this.sideLabel(item))
          .join(', ')} xác nhận.`,
      );
      await this.notifyOtherParty(roomId, actor.sub, 'deal.terms_confirm_needed', {
        version: draft.version,
        side,
      });
      return {
        roomId,
        locked: false,
        ...confirmed,
      };
    }

    // Price must already be agreed: the latest offer has to be accepted.
    const latestOffer = await this.prisma.offer.findFirst({
      where: { roomId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!latestOffer || latestOffer.status !== 'ACCEPTED') {
      throw this.conflict(
        'PRICE_NOT_AGREED',
        'Cần chấp nhận một đề nghị giá trước khi khóa điều khoản.',
      );
    }

    const snapshotTerms: Prisma.InputJsonValue = {
      ...(draft.terms as Record<string, Prisma.InputJsonValue>),
      price: {
        unitPrice: latestOffer.unitPrice.toString(),
        quantity: latestOffer.quantity,
        currency: latestOffer.currency,
        offerId: latestOffer.id,
        acceptedAt: (latestOffer.decidedAt ?? new Date()).toISOString(),
      },
    };

    let snapshot: { id: string; version: number; lockedAt: Date; terms: Prisma.JsonValue };
    try {
      snapshot = await this.prisma.$transaction(async (tx) => {
        // Re-check within the transaction: the other side may have edited in
        // the meantime (version bump) or another lock may have won the race.
        const current = await tx.dealTermsDraft.findUniqueOrThrow({ where: { id: draft.id } });
        if (current.version !== draft.version) {
          throw this.conflict(
            'TERMS_CHANGED',
            'Điều khoản vừa thay đổi; vui lòng xác nhận lại phiên bản mới.',
          );
        }
        const fresh = await tx.dealTermsConfirmation.findMany({
          where: { roomId, version: draft.version },
          select: { side: true },
        });
        const sides = new Set(fresh.map((row) => row.side));
        if (!sides.has('buyer') || !sides.has('supplier')) {
          throw this.conflict('TERMS_NOT_CONFIRMED', 'Cả hai bên phải xác nhận điều khoản.');
        }

        const row = await tx.lockedTerms.create({
          data: {
            orderId: room.order!.id,
            terms: snapshotTerms,
            currency: draft.currency,
            lockedById: actor.sub,
            version: draft.version,
          },
          select: { id: true, version: true, lockedAt: true, terms: true },
        });
        await tx.dealRoom.update({ where: { id: roomId }, data: { status: 'LOCKED' } });
        await tx.order.update({
          where: { id: room.order!.id },
          data: {
            status: room.order!.status === 'NEGOTIATING' ? 'SAMPLING' : room.order!.status,
            stageIndex: Math.max(room.order!.stageIndex, 1),
            totalAmount: latestOffer.unitPrice.mul(latestOffer.quantity),
            currency: latestOffer.currency,
          },
        });
        await tx.orderStageLog.create({
          data: {
            orderId: room.order!.id,
            stageIndex: Math.max(room.order!.stageIndex, 1),
            status: room.order!.status === 'NEGOTIATING' ? 'SAMPLING' : room.order!.status,
            actorId: actor.sub,
            note: `Khóa điều khoản phiên bản ${draft.version} (hai bên xác nhận).`,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: room.order!.id,
            type: 'terms.locked',
            actorId: actor.sub,
            message: `Khóa điều khoản phiên bản ${draft.version}.`,
            data: {
              lockedTermsId: row.id,
              version: draft.version,
              offerId: latestOffer.id,
              unitPrice: latestOffer.unitPrice.toString(),
              quantity: latestOffer.quantity,
              currency: latestOffer.currency,
            },
          },
        });
        return row;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.conflict('TERMS_ALREADY_LOCKED', TERMS_LOCKED);
      }
      throw error;
    }

    await this.messages.postSystemMessage(
      roomId,
      `Điều khoản đã được khóa ở phiên bản ${snapshot.version} với giá ${this.formatMoney(
        latestOffer.unitPrice,
        latestOffer.currency,
      )} × ${latestOffer.quantity}. Đơn chuyển sang bước lấy mẫu.`,
    );
    const memberIds = await this.partyUserIds(roomId);
    for (const userId of memberIds) {
      await this.notifications.emit('deal.terms_locked', userId, {
        roomId,
        version: snapshot.version,
      });
    }
    this.realtime.toDealRoom(roomId, 'order.status', {
      orderId: room.order.id,
      status: room.order.status === 'NEGOTIATING' ? 'SAMPLING' : room.order.status,
      stageIndex: Math.max(room.order.stageIndex, 1),
      totalAmount: latestOffer.unitPrice.mul(latestOffer.quantity).toString(),
      currency: latestOffer.currency,
      lockedTermsId: snapshot.id,
    });
    this.logger.log(
      { roomId, orderId: room.order.id, version: snapshot.version },
      'deal terms locked',
    );
    return {
      roomId,
      locked: true,
      snapshot,
      order: {
        id: room.order.id,
        status: 'SAMPLING',
        stageIndex: Math.max(room.order.stageIndex, 1),
        totalAmount: latestOffer.unitPrice.mul(latestOffer.quantity),
        currency: latestOffer.currency,
      },
      ...confirmed,
    };
  }

  // GET /deal-rooms/:id/offers — parties and staff observers can read the
  // negotiation history; outsiders still get 404 through assertMember.
  async list(actor: AccessPayload, roomId: string) {
    const { room, membership } = await this.rooms.assertMember(actor, roomId);
    const viewerSide = this.sideOf(membership);
    const creatorSides = new Map(
      room.members.map((member) => [member.userId, this.sideOf(member)] as const),
    );
    const offers = await this.prisma.offer.findMany({
      where: { roomId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { createdBy: { select: { profile: { select: { displayName: true } } } } },
    });
    return {
      roomId,
      viewerSide,
      offers: offers.map((offer) => ({
        ...this.mapOffer(offer, creatorSides.get(offer.createdById) ?? null, actor.sub),
        createdBy: {
          id: offer.createdById,
          name: offer.createdBy.profile?.displayName ?? null,
        },
      })),
      locked: room.status === 'LOCKED',
    };
  }

  // GET /deal-rooms/:id/terms — draft + confirmation state for the UI.
  async getTerms(actor: AccessPayload, roomId: string) {
    const { room, membership } = await this.rooms.assertMember(actor, roomId);
    const draft = await this.prisma.dealTermsDraft.findUnique({ where: { roomId } });
    const locked = room.order
      ? await this.prisma.lockedTerms.findUnique({
          where: { orderId: room.order.id },
          select: { id: true, version: true, lockedAt: true, terms: true, currency: true },
        })
      : null;
    const state = draft
      ? await this.termsState(roomId, draft.id, draft.version)
      : { confirmedSides: [] as PartySide[], awaiting: ['buyer', 'supplier'] as PartySide[] };
    return {
      roomId,
      viewerSide: this.sideOf(membership),
      locked: room.status === 'LOCKED',
      draft: draft
        ? {
            terms: draft.terms,
            currency: draft.currency,
            version: draft.version,
            updatedById: draft.updatedById,
            updatedAt: draft.updatedAt,
          }
        : null,
      ...state,
      snapshot: locked,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async roomFor(
    actor: AccessPayload,
    roomId: string,
  ): Promise<{ room: RoomForActor['room']; side: PartySide }> {
    const { room, membership } = await this.rooms.assertMember(actor, roomId);
    const side = this.sideOf(membership);
    if (!side) {
      throw new ForbiddenException(
        'Chỉ khách hàng và nhà cung cấp của giao dịch được thao tác giá/điều khoản.',
      );
    }
    return { room, side };
  }

  private sideOf(membership: { role: string } | null): PartySide | null {
    if (!membership) return null;
    return membership.role === 'buyer' || membership.role === 'supplier' ? membership.role : null;
  }

  private sideLabel(side: PartySide): string {
    return side === 'buyer' ? 'Khách hàng' : 'Nhà cung cấp';
  }

  private async loadOffer(offerId: string) {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('Đề nghị không tồn tại.');
    return offer;
  }

  private assertNegotiating(room: RoomForActor['room']): void {
    if (room.status !== 'OPEN') {
      throw this.conflict('ROOM_LOCKED', TERMS_LOCKED);
    }
    if (!room.order) {
      throw this.conflict('ORDER_REQUIRED', 'Phòng chưa gắn với đơn hàng.');
    }
    if (room.order.status !== 'NEGOTIATING') {
      throw this.conflict('ORDER_NOT_NEGOTIATING', 'Đơn hàng không còn ở bước thương lượng giá.');
    }
  }

  private async assertUnlocked(room: RoomForActor['room']): Promise<void> {
    if (room.status !== 'OPEN') {
      throw this.conflict('ROOM_LOCKED', TERMS_LOCKED);
    }
    if (room.order) {
      const locked = await this.prisma.lockedTerms.findUnique({
        where: { orderId: room.order.id },
        select: { id: true },
      });
      if (locked) throw this.conflict('TERMS_LOCKED', TERMS_LOCKED);
    }
  }

  private async assertCurrentPending(offer: Offer): Promise<void> {
    if (offer.status !== 'PENDING') {
      throw this.conflict(
        'OFFER_NOT_PENDING',
        'Đề nghị này đã được xử lý hoặc không còn hiệu lực.',
      );
    }
    if (offer.validUntil && offer.validUntil.getTime() <= Date.now()) {
      throw this.conflict('OFFER_EXPIRED', 'Đề nghị này đã hết hạn.');
    }
    const latest = await this.prisma.offer.findFirst({
      where: { roomId: offer.roomId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (latest?.id !== offer.id) {
      throw this.conflict(
        'OFFER_SUPERSEDED',
        'Đã có đề nghị mới hơn; không thể chấp nhận/đối đề nghị cũ.',
      );
    }
  }

  private resolveCurrency(room: RoomForActor['room'], requested: string | undefined): string {
    if (!room.order) {
      throw this.conflict('ORDER_REQUIRED', 'Phòng chưa gắn với đơn hàng.');
    }
    const currency = requested ?? room.order.currency;
    if (currency !== room.order.currency) {
      throw new BadRequestException('Loại tiền phải khớp với đơn hàng.');
    }
    return currency;
  }

  private async termsState(roomId: string, draftId: string, version: number) {
    const rows = await this.prisma.dealTermsConfirmation.findMany({
      where: { roomId, version },
      select: { side: true },
    });
    const sides = new Set(rows.map((row) => row.side));
    const confirmedSides = (['buyer', 'supplier'] as PartySide[]).filter((side) => sides.has(side));
    const awaiting = (['buyer', 'supplier'] as PartySide[]).filter((side) => !sides.has(side));
    return { draftId, version, confirmedSides, awaiting };
  }

  private async partyUserIds(roomId: string, excludeUserId?: string): Promise<string[]> {
    const members = await this.prisma.dealRoomMember.findMany({
      where: { roomId, role: { in: ['buyer', 'supplier'] } },
      select: { userId: true },
    });
    const ids = new Set(members.map((row) => row.userId));
    if (excludeUserId) ids.delete(excludeUserId);
    return [...ids];
  }

  private async notifyOtherParty(
    roomId: string,
    actorId: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const userIds = await this.partyUserIds(roomId, actorId);
    for (const userId of userIds) {
      await this.notifications.emit(event, userId, { roomId, ...data });
    }
  }

  private mapOffer(offer: Offer, side: PartySide | null, viewerId?: string) {
    return {
      id: offer.id,
      roomId: offer.roomId,
      unitPrice: offer.unitPrice,
      quantity: offer.quantity,
      totalAmount: offer.unitPrice.mul(offer.quantity),
      currency: offer.currency,
      conditions: offer.conditions,
      status: offer.status,
      validUntil: offer.validUntil,
      decidedAt: offer.decidedAt,
      createdAt: offer.createdAt,
      side,
      createdById: offer.createdById,
      mine: viewerId ? offer.createdById === viewerId : undefined,
    };
  }

  private formatMoney(value: Prisma.Decimal | string | number, currency: string): string {
    const number = Number(value);
    const text = Number.isFinite(number)
      ? number.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : String(value);
    return `${text} ${currency}`;
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
