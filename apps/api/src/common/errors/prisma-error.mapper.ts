import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ErrorCode } from './error-codes';

export interface MappedError {
  status: number;
  code: ErrorCode;
  message: string;
}

// Map known Prisma request errors to clear HTTP codes (P2002 unique, P2025 missing, P2003 FK).
export function mapPrismaError(err: Prisma.PrismaClientKnownRequestError): MappedError {
  switch (err.code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.UniqueConstraint,
        message: 'Resource already exists.',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        code: ErrorCode.NotFound,
        message: 'Resource not found.',
      };
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.ForeignKeyConstraint,
        message: 'Related resource constraint failed.',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.InternalError,
        message: 'Database error.',
      };
  }
}
