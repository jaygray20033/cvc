import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ErrorCode } from '../common/errors/error-codes';
import { MailService } from '../common/mail/mail.service';
import { assertOwned } from '../common/policies/ownership';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATION_TEMPLATES } from './notification-templates';
import type { UpdatePreferencesInput } from './notifications.dto';

// Notification engine (P2.18). emit(event, userId, data) renders a template
// and delivers per channel: in-app rows are always stored, email goes through
// MailService, sms/zns/push are stubs until their providers are integrated
// (D13/D11). User opt-outs apply except for mandatory events (security/money).
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async emit(event: string, userId: string, data: Record<string, unknown> = {}): Promise<void> {
    const template = NOTIFICATION_TEMPLATES[event];
    const rendered = template
      ? template.render(data)
      : {
          title: 'Thông báo từ CVC',
          body: JSON.stringify(data).slice(0, 400),
          emailSubject: 'CVC — Thông báo',
        };

    const prefs = await this.getPreferences(userId);

    // In-app row unless the user opted out of in_app for this non-mandatory event.
    const inAppAllowed = template?.mandatory || prefs.inApp;
    if (inAppAllowed) {
      await this.prisma.notification.create({
        data: {
          userId,
          event,
          title: rendered.title,
          body: rendered.body,
          data: data as object,
        },
      });
    }

    // Email channel.
    const emailAllowed =
      template?.channels.includes('email') && (template?.mandatory || prefs.email);
    if (emailAllowed && rendered.emailSubject) {
      try {
        await this.sendEmail(
          userId,
          rendered.emailSubject,
          rendered.emailHtml ?? '',
          rendered.emailText ?? '',
        );
      } catch (error) {
        this.logger.error(
          { err: error instanceof Error ? error.message : String(error), event },
          'notification email failed',
        );
      }
    }

    // sms / zns / push: providers not integrated (D13) — log intent only.
    for (const channel of ['sms', 'zns', 'push'] as const) {
      if (template?.channels.includes(channel)) {
        this.logger.warn({ event, channel, userId }, 'channel not implemented yet');
      }
    }
  }

  // GET /notifications — own list with unread count.
  async list(userId: string, page: number, limit: number) {
    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, total, unreadCount, page, limit };
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Không tìm thấy thông báo.',
      });
    }
    assertOwned(userId, notification.userId, 'thông báo');
    if (!notification.readAt) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { readAt: new Date() },
      });
    }
    return { message: 'Đã đánh dấu đã đọc.' };
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { message: `Đã đọc ${res.count} thông báo.` };
  }

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async updatePreferences(userId: string, input: UpdatePreferencesInput) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...input },
      update: { ...input },
    });
  }

  private async sendEmail(
    userId: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) return;
    await this.mail.send({ to: user.email, subject, html, text });
  }
}
