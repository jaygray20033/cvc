import { Role } from '@cvc/shared';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  health() {
    // roleCount proves the @cvc/shared workspace alias resolves.
    return { status: 'ok', roleCount: Object.keys(Role).length };
  }

  ready() {
    return { status: 'ready' };
  }
}
