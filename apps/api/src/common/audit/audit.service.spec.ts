import { AuditService } from './audit.service';

// Unit tests for the audit hash chain (P2.16): every row hashes its payload
// plus the previous row's hash, so editing any row breaks the chain.
function entry(overrides: Partial<Parameters<typeof AuditService.rowHash>[1]> = {}) {
  return {
    actorId: 'user-1',
    actorRole: 'admin',
    action: 'kyc.approved',
    entityType: 'kyc_submission',
    entityId: 'sub-1',
    before: undefined,
    after: { status: 'APPROVED' },
    ip: '1.2.3.4',
    userAgent: 'jest',
    requestId: 'req-1',
    ...overrides,
  };
}

describe('AuditService hash chain', () => {
  it('produces a deterministic hash per payload + prevHash', () => {
    const h1 = AuditService.rowHash('GENESIS', entry());
    const h1Again = AuditService.rowHash('GENESIS', entry());
    expect(h1).toBe(h1Again);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('different prevHash -> different hash (chaining works)', () => {
    const first = AuditService.rowHash('GENESIS', entry());
    const second = AuditService.rowHash(first, entry({ action: 'kyc.rejected' }));
    expect(second).not.toBe(first);
  });

  it('any payload change changes the hash (tamper detection)', () => {
    const base = AuditService.rowHash('GENESIS', entry());
    const tampered = AuditService.rowHash('GENESIS', entry({ after: { status: 'REJECTED' } }));
    expect(tampered).not.toBe(base);
  });
});
