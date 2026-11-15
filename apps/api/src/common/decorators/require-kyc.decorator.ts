import type { KycLevel } from '@cvc/shared';
import { SetMetadata } from '@nestjs/common';

export const REQUIRE_KYC_KEY = 'require_kyc';

// Requires the caller to have passed KYC at the given level (P2.15) before the
// route runs, enforced by KycGuard. Example: money actions use
// @RequireKyc('FULL'), participation/consignment/contract use 'BASIC'.
export const RequireKyc = (level: KycLevel) => SetMetadata(REQUIRE_KYC_KEY, level);
