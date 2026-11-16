import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server as HttpServer } from 'http';
import { Redis } from 'ioredis';
import type { Server as IoServer, Socket } from 'socket.io';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { RealtimeService } from './realtime.service';

// Socket.IO gateway (P2.20). JWT in the handshake (`auth.token`); private
// room per user joined automatically; other rooms via `room:join` guarded by
// RealtimeService. Redis adapter fans events out across processes.
@WebSocketGateway({ path: '/ws', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private adapterPub: Redis | null = null;

  @WebSocketServer()
  server: IoServer | undefined;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(_httpServer: HttpServer): void {
    if (!this.server) return; // standalone context (worker): skip
    // Redis pub/sub adapter: events emitted in one process reach sockets in
    // every other process.
    const url = this.config.get<string>('redis.url', 'redis://localhost:6379');
    this.adapterPub = new Redis(url, { maxRetriesPerRequest: 2 });
    const sub = this.adapterPub.duplicate();
    this.server.adapter(createAdapter(this.adapterPub, sub));
    this.realtime.setServer(this.server);
    this.logger.log('realtime gateway ready (/ws)');
  }

  // Release the adapter's pub/sub connections on shutdown.
  async onModuleDestroy(): Promise<void> {
    if (this.adapterPub) await this.adapterPub.quit().catch(() => undefined);
  }

  handleConnection(client: Socket): void {
    const token = this.realtime.extractToken(client);
    if (!token) {
      client.emit('error', { message: 'Thiếu token.' });
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwt.verify<AccessPayload>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      if (!payload.sub || !payload.sid) throw new Error('Malformed token payload.');
      client.data.user = payload;
      // Private per-user room for direct pushes (notification.new...).
      void client.join(`user:${payload.sub}`);
    } catch {
      client.emit('error', { message: 'Token không hợp lệ.' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    // FE auto-reconnects (socket.io default); nothing to clean per-user since
    // rooms are per-connection.
    this.logger.debug({ id: client.id }, 'realtime disconnected');
  }

  @SubscribeMessage('room:join')
  async onJoin(client: Socket, data: { room?: string }): Promise<{ ok: boolean; reason?: string }> {
    const user = client.data.user as AccessPayload | undefined;
    const room = data?.room;
    if (!user || !room) return { ok: false, reason: 'Chưa xác thực hoặc thiếu phòng.' };
    const decision = await this.realtime.assertCanJoin(user, room);
    if (!decision.ok) {
      // Log, don't leak details to the socket beyond the reason string.
      this.realtime.logClientError(user.sub, `join denied: ${room}`);
      return { ok: false, reason: decision.reason };
    }
    await client.join(room);
    return { ok: true };
  }

  @SubscribeMessage('room:leave')
  async onLeave(client: Socket, data: { room?: string }): Promise<{ ok: boolean }> {
    if (data?.room) await client.leave(data.room);
    return { ok: true };
  }
}
