import { Injectable, Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { RedisService } from '../redis/redis.service';

// Room name shapes handled by the gateway (P2.20). New domain rooms extend
// this policy; unknown prefixes are always denied.
type RoomDecision = { ok: true } | { ok: false; reason: string };

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  constructor(private readonly redis: RedisService) {}

  // Called by the gateway once the underlying HTTP server is up.
  setServer(server: Server): void {
    this.server = server;
  }

  get ready(): boolean {
    return this.server !== null;
  }

  // Push an event to every socket of one user (their private room).
  toUser(userId: string, event: string, payload: Record<string, unknown>): void {
    if (!this.server) return; // worker process / standalone context: no-op
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  // Push an event to a deal room.
  toDealRoom(dealRoomId: string, event: string, payload: Record<string, unknown>): void {
    if (!this.server) return;
    this.server.to(`dealRoom:${dealRoomId}`).emit(event, payload);
  }

  // Deal room membership is stored in Redis so future modules (P3.4) can
  // grant/revoke when rooms are created/removed.
  async grantDealRoomAccess(dealRoomId: string, userId: string): Promise<void> {
    await this.redis.sadd(`realtime:dealroom:${dealRoomId}:members`, userId);
  }

  async revokeDealRoomAccess(dealRoomId: string, userId: string): Promise<void> {
    await this.redis.srem(`realtime:dealroom:${dealRoomId}:members`, userId);
  }

  // Join permission check (P2.20 DoD): users can only join their own user
  // room; deal rooms need membership or admin; anything else is denied.
  async assertCanJoin(user: AccessPayload, room: string): Promise<RoomDecision> {
    if (room === `user:${user.sub}`) return { ok: true };
    const dealRoomMatch = /^dealRoom:([A-Za-z0-9_-]+)$/.exec(room);
    if (dealRoomMatch) {
      if (user.role === 'admin') return { ok: true };
      const member = await this.redis.isMember(
        `realtime:dealroom:${dealRoomMatch[1]}:members`,
        user.sub,
      );
      return member ? { ok: true } : { ok: false, reason: 'Bạn không phải thành viên phòng này.' };
    }
    return { ok: false, reason: 'Phòng không tồn tại hoặc không được phép.' };
  }

  // Handshake auth: token comes in `auth.token` (browser) or query (curl).
  extractToken(socket: Socket): string | null {
    const fromAuth = socket.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
    const fromQuery = socket.handshake.query?.token;
    if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
    return null;
  }

  logClientError(userId: string, err: string): void {
    this.logger.warn({ userId, err }, 'realtime client error');
  }
}
