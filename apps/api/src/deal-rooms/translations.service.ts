import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { DealRoomsService } from './deal-rooms.service';
import { sanitizeMessageBody } from './messages.sanitize';
import { TRANSLATION_PROVIDER, type TranslationProvider } from './translation.provider';

// P4.14 — message translation. Results are cached per (messageId, lang), so a
// repeated request never calls the provider again. New translations consume a
// per-user daily quota from Redis; the limit is an admin setting. The reply
// always carries the original text plus `autoTranslated` for the UI label.
@Injectable()
export class TranslationsService {
  private readonly logger = new Logger(TranslationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: DealRoomsService,
    private readonly settings: SystemSettingsService,
    private readonly redis: RedisService,
    @Inject(TRANSLATION_PROVIDER) private readonly provider: TranslationProvider,
  ) {}

  async translate(actor: AccessPayload, messageId: string, lang: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, roomId: true, body: true },
    });
    if (!message) throw new NotFoundException('Tin nhắn không tồn tại.');
    // Same room policy as chat: outsiders get 404.
    await this.rooms.assertMember(actor, message.roomId);

    // DoD: cached translation is reused without spending quota.
    const cached = await this.prisma.translation.findUnique({
      where: { messageId_lang: { messageId, lang } },
    });
    if (cached) return this.build(message.body, cached, true);

    const dailyLimit = (await this.settings.get<number>('translate.dailyLimit')) ?? 0;
    const quotaKey = this.quotaKey(actor.sub);
    const used = await this.redis.incrementWithTtl(quotaKey, this.secondsUntilUtcMidnight());
    if (used > dailyLimit) {
      throw new HttpException(
        {
          code: 'TRANSLATION_QUOTA_EXCEEDED',
          message: `Bạn đã dùng hết ${dailyLimit} lượt dịch hôm nay. Vui lòng thử lại vào ngày mai.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let translated: string;
    try {
      translated = await this.provider.translate({
        // Bodies are stored HTML-escaped; translate the plain text.
        text: decodeEscapedEntities(message.body),
        targetLang: lang,
      });
    } catch (error) {
      this.logger.error({ messageId, lang, err: String(error) }, 'translation provider failed');
      throw new BadGatewayException({
        code: 'TRANSLATION_PROVIDER_ERROR',
        message: 'Không thể dịch tin nhắn lúc này. Vui lòng thử lại sau.',
      });
    }

    const text = sanitizeMessageBody(translated).slice(0, 4000);
    if (!text) {
      throw new BadGatewayException({
        code: 'TRANSLATION_PROVIDER_ERROR',
        message: 'Bản dịch rỗng. Vui lòng thử lại sau.',
      });
    }

    // Concurrent requests race on the unique key; upsert keeps one row.
    const row = await this.prisma.translation.upsert({
      where: { messageId_lang: { messageId, lang } },
      create: { messageId, lang, text, provider: this.provider.name },
      update: {},
    });
    this.logger.log(
      { messageId, lang, actor: actor.sub, provider: this.provider.name },
      'message translated',
    );
    return this.build(message.body, row, false);
  }

  private build(
    originalText: string,
    row: { messageId: string; lang: string; text: string; provider: string; createdAt: Date },
    cached: boolean,
  ) {
    return {
      messageId: row.messageId,
      lang: row.lang,
      originalText,
      text: row.text,
      provider: row.provider,
      // UI shows the "dịch tự động" badge from this flag.
      autoTranslated: row.provider !== 'human',
      cached,
      createdAt: row.createdAt,
    };
  }

  private quotaKey(userId: string): string {
    return `translate:quota:${userId}:${new Date().toISOString().slice(0, 10)}`;
  }

  private secondsUntilUtcMidnight(): number {
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return Math.max(60, Math.ceil((midnight - now.getTime()) / 1000));
  }
}

function decodeEscapedEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
