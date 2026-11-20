import { Role } from '@cvc/shared';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RedisService } from '../redis/redis.service';
import type {
  ListDealRoomMessagesInput,
  MarkDealRoomReadInput,
  SendDealRoomMessageInput,
} from './deal-rooms.dto';
import { DealRoomsService } from './deal-rooms.service';
import { sanitizeMessageBody } from './messages.sanitize';

// P4.13 — Deal Room chat. Text is sanitized on write, attachments must be the
// sender's READY files, reads are tracked per member, and every page reuses
// the P4.12 membership check (outsiders get 404). Sends are rate limited per
// room+user through Redis so a single account cannot flood the room.
const SEND_LIMIT = 20;
const SEND_WINDOW_SECONDS = 10;

const MESSAGE_INCLUDE = {
  sender: { select: { id: true, profile: { select: { displayName: true } } } },
  attachments: {
    select: {
      id: true,
      fileObject: {
        select: {
          id: true,
          declaredMime: true,
          detectedMime: true,
          sizeBytes: true,
          status: true,
          scanStatus: true,
          thumbnailKey: true,
        },
      },
    },
    orderBy: { sortIndex: 'asc' as const },
  },
  reads: { select: { userId: true } },
} satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

@Injectable()
export class DealRoomMessagesService {
  private readonly logger = new Logger(DealRoomMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: DealRoomsService,
    private readonly files: FilesService,
    private readonly realtime: RealtimeService,
    private readonly redis: RedisService,
  ) {}

  // GET /deal-rooms/:id/messages?cursor=&limit=
  async list(actor: AccessPayload, roomId: string, query: ListDealRoomMessagesInput) {
    await this.rooms.assertMember(actor, roomId);
    const limit = query.limit ?? 30;

    let before: Prisma.MessageWhereInput | null = null;
    if (query.cursor) {
      const cursor = await this.prisma.message.findFirst({
        where: { id: query.cursor, roomId },
        select: { id: true, createdAt: true },
      });
      if (!cursor) throw new BadRequestException('Cursor không hợp lệ.');
      before = {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      };
    }

    const rows = await this.prisma.message.findMany({
      where: { roomId, ...(before ?? {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: MESSAGE_INCLUDE,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    // Return the page oldest→newest (chat order) while keeping the cursor at
    // the oldest message for the next (older) page.
    page.reverse();

    return {
      roomId,
      messages: page.map((row) => this.mapMessage(row, actor.sub, roomId)),
      nextCursor: hasMore ? page[0].id : null,
    };
  }

  // POST /deal-rooms/:id/messages
  async send(actor: AccessPayload, roomId: string, input: SendDealRoomMessageInput) {
    await this.rooms.assertMember(actor, roomId);
    await this.enforceSendRate(actor, roomId);

    const body = sanitizeMessageBody(input.body);
    if (!body) throw new BadRequestException('Nội dung tin nhắn không hợp lệ.');
    const attachmentIds = [...new Set(input.attachmentIds ?? [])];
    await this.validateAttachments(actor, attachmentIds);

    const created = await this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          roomId,
          senderId: actor.sub,
          type: 'TEXT',
          body,
          attachments: attachmentIds.length
            ? {
                create: attachmentIds.map((fileObjectId, index) => ({
                  fileObjectId,
                  sortIndex: index,
                })),
              }
            : undefined,
        },
        select: { id: true },
      });
      // Sender has implicitly read their own message.
      await tx.messageRead.create({ data: { messageId: message.id, userId: actor.sub } });
      return message;
    });

    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: created.id },
      include: MESSAGE_INCLUDE,
    });
    const mapped = this.mapMessage(message, actor.sub, roomId);
    this.realtime.toDealRoom(roomId, 'message.new', mapped);
    this.logger.log({ roomId, messageId: message.id, actor: actor.sub }, 'deal message sent');
    return mapped;
  }

  // POST /deal-rooms/:id/read — marks every message up to `messageId` as read.
  async markRead(actor: AccessPayload, roomId: string, input: MarkDealRoomReadInput) {
    await this.rooms.assertMember(actor, roomId);
    const target = await this.prisma.message.findFirst({
      where: { id: input.messageId, roomId },
      select: { id: true, createdAt: true },
    });
    if (!target) throw new NotFoundException('Tin nhắn không tồn tại.');

    const unread = await this.prisma.message.findMany({
      where: {
        roomId,
        createdAt: { lte: target.createdAt },
        reads: { none: { userId: actor.sub } },
      },
      select: { id: true },
    });
    if (unread.length > 0) {
      await this.prisma.messageRead.createMany({
        data: unread.map((message) => ({ messageId: message.id, userId: actor.sub })),
        skipDuplicates: true,
      });
      this.realtime.toDealRoom(roomId, 'message.read', {
        roomId,
        userId: actor.sub,
        messageIds: unread.map((message) => message.id),
      });
    }
    return { roomId, marked: unread.length, upToMessageId: target.id };
  }

  // GET /deal-rooms/:id/attachments/:attachmentId/download
  async downloadAttachment(actor: AccessPayload, roomId: string, attachmentId: string) {
    await this.rooms.assertMember(actor, roomId);
    // FilesService re-checks membership and only signs READY + CLEAN files.
    return this.files.downloadRoomAttachment(actor, roomId, attachmentId);
  }

  // Internal hook for order/status changes: writes a sender-less SYSTEM row
  // and pushes it to the room like any other message.
  async postSystemMessage(roomId: string, body: string): Promise<void> {
    const sanitized = sanitizeMessageBody(body);
    if (!sanitized) return;
    const message = await this.prisma.message.create({
      data: { roomId, type: 'SYSTEM', body: sanitized },
      include: MESSAGE_INCLUDE,
    });
    this.realtime.toDealRoom(roomId, 'message.new', this.mapMessage(message, '', roomId));
  }

  // P4.15 — offer traffic is a first-class OFFER message: rendered in the chat
  // timeline with the offer id in `data`, so the UI can deep-link to it.
  async postOfferMessage(
    roomId: string,
    senderId: string,
    body: string,
    data: Prisma.InputJsonValue,
  ): Promise<void> {
    const sanitized = sanitizeMessageBody(body);
    if (!sanitized) return;
    const message = await this.prisma.message.create({
      data: { roomId, senderId, type: 'OFFER', body: sanitized, data },
      include: MESSAGE_INCLUDE,
    });
    this.realtime.toDealRoom(roomId, 'message.new', this.mapMessage(message, senderId, roomId));
  }

  // ---------------------------------------------------------------- helpers

  private async enforceSendRate(actor: AccessPayload, roomId: string): Promise<void> {
    const count = await this.redis.incrementWithTtl(
      `chat:send:${roomId}:${actor.sub}`,
      SEND_WINDOW_SECONDS,
    );
    if (count > SEND_LIMIT) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: `Bạn gửi quá nhanh. Vui lòng thử lại sau ${SEND_WINDOW_SECONDS} giây.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async validateAttachments(actor: AccessPayload, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const files = await this.prisma.fileObject.findMany({
      where: { id: { in: ids } },
      select: { id: true, ownerId: true, status: true },
    });
    if (files.length !== ids.length) {
      throw new BadRequestException('Tệp đính kèm không tồn tại.');
    }
    // Only files the sender uploaded (admins may forward any file).
    if (actor.role !== Role.Admin && files.some((file) => file.ownerId !== actor.sub)) {
      throw new ForbiddenException('Bạn chỉ có thể đính kèm tệp mình đã tải lên.');
    }
    if (files.some((file) => file.status !== 'READY')) {
      throw new BadRequestException('Tệp đính kèm chưa sẵn sàng.');
    }
  }

  private mapMessage(row: MessageRow, viewerId: string, roomId: string) {
    return {
      id: row.id,
      roomId: row.roomId,
      type: row.type,
      body: row.body,
      sender: row.sender
        ? { id: row.sender.id, name: row.sender.profile?.displayName ?? null }
        : null,
      attachments: row.attachments.map((attachment) => ({
        id: attachment.id,
        fileId: attachment.fileObject?.id ?? null,
        mime: attachment.fileObject?.detectedMime ?? attachment.fileObject?.declaredMime ?? null,
        sizeBytes: attachment.fileObject?.sizeBytes ?? null,
        status: attachment.fileObject?.status ?? null,
        scanStatus: attachment.fileObject?.scanStatus ?? null,
        hasThumbnail: Boolean(attachment.fileObject?.thumbnailKey),
        downloadUrl: attachment.fileObject
          ? `/api/v1/deal-rooms/${roomId}/attachments/${attachment.id}/download`
          : null,
      })),
      readCount: row.reads.length,
      readByMe: row.reads.some((read) => read.userId === viewerId),
      createdAt: row.createdAt,
    };
  }
}
