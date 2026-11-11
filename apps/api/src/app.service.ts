import { Injectable } from '@nestjs/common';
import { Role } from '@cvc/shared';

@Injectable()
export class AppService {
  health() {
    // roleCount proves the @cvc/shared workspace alias resolves.
    return { status: 'ok', roleCount: Object.keys(Role).length };
  }
}