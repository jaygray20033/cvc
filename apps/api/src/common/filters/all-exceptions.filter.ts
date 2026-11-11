import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ZodError } from 'zod';

import { codeFromStatus, ErrorCode } from '../errors/error-codes';
import { mapPrismaError } from '../errors/prisma-error.mapper';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

// Turns every error into { code, message, details?, requestId }. 5xx details stay generic.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id ?? req.header('x-request-id') ?? 'unknown';

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.InternalError;
    let message = 'Internal server error.';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = codeFromStatus(status);
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (Array.isArray(record.message)) {
          message = 'Validation failed.';
          code = ErrorCode.ValidationError;
          details = record.message;
        } else if (typeof record.message === 'string') {
          message = record.message;
        }
        if (typeof record.code === 'string') {
          code = record.code;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaError(exception);
      status = mapped.status;
      code = mapped.code;
      message = mapped.message;
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = ErrorCode.ValidationError;
      message = 'Validation failed.';
      details = exception.issues;
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ err: exception, requestId }, message);
    } else {
      this.logger.warn({ requestId, code }, message);
    }

    const payload: ErrorBody = { code, message, requestId };
    if (details !== undefined) {
      payload.details = details;
    }
    res.status(status).json(payload);
  }
}
