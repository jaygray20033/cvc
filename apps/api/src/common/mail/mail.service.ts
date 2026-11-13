import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// SMTP adapter. dev/test → mailpit; production → Gmail SMTP (free OTP channel,
// no SMS). Message bodies are never logged (may contain verification links/OTP).
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>('mail.from', 'CVC <no-reply@cvc.local>');
    this.transporter = nodemailer.createTransport({
      host: config.get<string>('mail.host'),
      port: config.get<number>('mail.port', 1025),
      secure: config.get<number>('mail.port', 1025) === 465,
      auth:
        config.get<string>('mail.user') && config.get<string>('mail.pass')
          ? { user: config.get<string>('mail.user'), pass: config.get<string>('mail.pass') }
          : undefined,
    });
  }

  async send(input: SendMailInput): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      this.logger.log({ to: input.to, subject: input.subject }, 'email sent');
    } catch (error) {
      // Log the error, not the message content.
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'email send failed',
      );
      throw error;
    }
  }
}
