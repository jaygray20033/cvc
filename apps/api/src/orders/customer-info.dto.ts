import { z } from 'zod';

import { CCCD_RE, TAX_ID_RE } from '../common/utils/validators';
import { ORG_TYPES } from '../me/profile.dto';

// P4.18 — legal customer snapshot for the sourcing contract. The CCCD is
// optional in the body: when omitted the service falls back to the saved row
// or the approved KYC submission, which is how profile/KYC data is reconciled.
const trimmed = z.string().trim();

export const upsertCustomerInfoSchema = z.object({
  orgType: z.enum(ORG_TYPES),
  legalName: trimmed.pipe(z.string().min(2).max(191)),
  taxId: trimmed
    .pipe(
      z.string().regex(TAX_ID_RE, 'MST không đúng định dạng (10 số hoặc 10 số + -3 số chi nhánh)'),
    )
    .nullish(),
  businessRegNo: trimmed.pipe(z.string().max(20)).nullish(),
  cccdNumber: trimmed.pipe(z.string().regex(CCCD_RE, 'CCCD phải gồm 12 chữ số')).nullish(),
  address: trimmed.pipe(z.string().min(5).max(255)),
  representativeName: trimmed.pipe(z.string().min(2).max(191)).nullish(),
});
export type UpsertCustomerInfoInput = z.infer<typeof upsertCustomerInfoSchema>;
