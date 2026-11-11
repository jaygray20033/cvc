// Stable API error codes returned in { code, message, details?, requestId }.
export const ErrorCode = {
  InternalError: 'INTERNAL_ERROR',
  BadRequest: 'BAD_REQUEST',
  ValidationError: 'VALIDATION_ERROR',
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  UniqueConstraint: 'UNIQUE_CONSTRAINT',
  ForeignKeyConstraint: 'FOREIGN_KEY_CONSTRAINT',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export function codeFromStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCode.BadRequest;
    case 401:
      return ErrorCode.Unauthorized;
    case 403:
      return ErrorCode.Forbidden;
    case 404:
      return ErrorCode.NotFound;
    case 409:
      return ErrorCode.Conflict;
    default:
      return ErrorCode.InternalError;
  }
}
