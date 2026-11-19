import { Role } from '@cvc/shared';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AddDealRoomMemberInput, DealRoomMemberRole } from './deal-rooms.dto';

// P4.12 — private negotiation room per deal. Every read checks membership:
// non-members get 404 (not 403) so the room's existence is not leaked; admins
// keep their platform-wide oversight. Monetary fields follow P4.10 (the order
// total is what the buyer already sees); D1 is still open on whether CVC staff
// should hide supplier cost prices, which live on quotes, not on the order.
const ROOM_NOT_FOUND = 'Phòng thương lượng không tồn tại.';

@Injectable()
export class DealRoomsService {
  private readonly logger = new Logger(DealRoomsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async getRoom(actor: AccessPayload, roomId: string) {
    const { room, membership } = await this.loadRoom(actor, roomId);
    return {
      id: room.id,
      title: room.title,
      status: room.status,
      viewerRole: membership?.role ?? Role.Admin,
      memberCount: room._count.members,
      messageCount: room._count.messages,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      order: room.order
        ? {
            id: room.order.id,
            orderNo: room.order.orderNo,
            status: room.order.status,
            stageIndex: room.order.stageIndex,
            totalAmount: room.order.totalAmount,
            depositAmount: room.order.depositAmount,
            currency: room.order.currency,
            supplier: room.order.supplier,
            createdAt: room.order.createdAt,
          }
        : null,
      request: room.sourcingRequest,
    };
  }

  async listMembers(actor: AccessPayload, roomId: string) {
    await this.loadRoom(actor, roomId);
    const members = await this.prisma.dealRoomMember.findMany({
      where: { roomId },
      orderBy: { joinedAt: 'asc' },
      select: {
        userId: true,
        role: true,
        joinedAt: true,
        user: { select: { profile: { select: { displayName: true } } } },
      },
    });
    return {
      roomId,
      members: members.map((member) => ({
        userId: member.userId,
        role: member.role,
        // Display name only: member emails stay out of the room API.
        name: member.user.profile?.displayName ?? null,
        joinedAt: member.joinedAt,
      })),
    };
  }

  async addMember(actor: AccessPayload, roomId: string, input: AddDealRoomMemberInput) {
    const { room } = await this.loadRoom(actor, roomId);

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        status: true,
        userRoles: { select: { role: true } },
        supplierAccounts: { select: { supplierId: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new BadRequestException('Người dùng không tồn tại hoặc chưa kích hoạt.');
    }
    this.assertRoleFits(room, input.role, user);

    const existing = await this.prisma.dealRoomMember.findUnique({
      where: { roomId_userId: { roomId, userId: user.id } },
      select: { id: true },
    });
    const member = await this.prisma.dealRoomMember.upsert({
      where: { roomId_userId: { roomId, userId: user.id } },
      create: { roomId, userId: user.id, role: input.role },
      update: { role: input.role },
      select: { userId: true, role: true, joinedAt: true },
    });
    // Keep the realtime join allow-list in sync (P2.20 sockets).
    await this.realtime.grantDealRoomAccess(roomId, user.id);

    this.logger.log(
      { roomId, userId: user.id, role: input.role, actor: actor.sub, created: !existing },
      'deal room member added',
    );
    return { roomId, created: !existing, member };
  }

  // P4.13: messages reuse the same access policy (members only, 404 outside).
  async assertMember(actor: AccessPayload, roomId: string) {
    return this.loadRoom(actor, roomId);
  }

  // ---------------------------------------------------------------- helpers

  private async loadRoom(actor: AccessPayload, roomId: string) {
    const room = await this.prisma.dealRoom.findUnique({
      where: { id: roomId },
      include: {
        members: {
          select: { userId: true, role: true },
          orderBy: { joinedAt: 'asc' as const },
        },
        order: {
          select: {
            id: true,
            orderNo: true,
            buyerId: true,
            supplierId: true,
            status: true,
            stageIndex: true,
            totalAmount: true,
            depositAmount: true,
            currency: true,
            createdAt: true,
            supplier: { select: { id: true, name: true } },
          },
        },
        sourcingRequest: { select: { id: true, requestNo: true, title: true, status: true } },
        _count: { select: { members: true, messages: true } },
      },
    });
    if (!room) throw new NotFoundException(ROOM_NOT_FOUND);

    const membership = room.members.find((member) => member.userId === actor.sub) ?? null;
    // DoD: outsiders get 404; admins may inspect any room.
    if (!membership && actor.role !== Role.Admin) {
      this.logger.warn({ roomId, actor: actor.sub }, 'deal room access denied');
      throw new NotFoundException(ROOM_NOT_FOUND);
    }
    return { room, membership };
  }

  private assertRoleFits(
    room: {
      order: { buyerId: string; supplierId: string } | null;
    },
    role: DealRoomMemberRole,
    user: {
      id: string;
      userRoles: Array<{ role: string }>;
      supplierAccounts: { supplierId: string } | null;
    },
  ): void {
    const hasRole = (value: string) => user.userRoles.some((row) => row.role === value);

    if (role === 'buyer') {
      if (room.order && room.order.buyerId !== user.id) {
        throw new BadRequestException('Người được mời không phải khách của đơn này.');
      }
      if (!room.order && !hasRole(Role.Buyer)) {
        throw new BadRequestException('Người được mời không phải khách hàng.');
      }
      return;
    }
    if (role === 'supplier') {
      const supplierId = room.order?.supplierId;
      if (!supplierId || user.supplierAccounts?.supplierId !== supplierId) {
        throw new BadRequestException('Người được mời không thuộc nhà cung cấp của đơn này.');
      }
      return;
    }
    if (role === 'sales' || role === 'inspector' || role === 'admin') {
      if (!hasRole(role)) {
        throw new BadRequestException('Người được mời không giữ vai trò phù hợp.');
      }
      return;
    }
    // 'member': any active user the staff explicitly invites.
  }
}
