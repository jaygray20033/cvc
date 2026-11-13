import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';

// Validates request bodies/params at the boundary with a Zod schema.
// Failures surface as VALIDATION_ERROR through AllExceptionsFilter.
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed.',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
