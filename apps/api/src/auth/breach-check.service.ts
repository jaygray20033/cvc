import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Password breach check (P2.1): k-anonymity lookup against HIBP Pwned Passwords.
// Adapter rules (CLAUDE.md #8/#10): never called from dev/test (breachCheck
// disabled by default outside production), fails open on network errors so the
// login flow is never blocked by a third-party outage.
@Injectable()
export class BreachCheckService {
  private readonly logger = new Logger(BreachCheckService.name);
  private readonly enabled: boolean;
  private readonly cache = new Map<string, { suffixes: Set<string>; expiresAt: number }>();

  constructor(config: ConfigService) {
    this.enabled = config.get<boolean>('password.breachCheck', false);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // `sha1` is the HIBP wire format (hex, uppercase, no salt).
  async isBreached(sha1Hex: string): Promise<boolean> {
    if (!this.enabled) return false;

    const prefix = sha1Hex.slice(0, 5).toUpperCase();
    const suffixes = await this.loadSuffixes(prefix);
    return suffixes.has(sha1Hex.slice(5).toUpperCase());
  }

  private async loadSuffixes(prefix: string): Promise<Set<string>> {
    const cached = this.cache.get(prefix);
    if (cached && cached.expiresAt > Date.now()) return cached.suffixes;

    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      const suffixes = new Set(
        body
          .split('\n')
          .map((line) => line.split(':')[0]?.trim().toUpperCase())
          .filter((value): value is string => Boolean(value)),
      );
      this.cache.set(prefix, { suffixes, expiresAt: Date.now() + 3600_000 });
      return suffixes;
    } catch (error) {
      // Fail open: allow the password, log the reason. Never block auth on HIBP.
      this.logger.warn(
        { prefix, err: error instanceof Error ? error.message : String(error) },
        'breach check unavailable, failing open',
      );
      return new Set();
    }
  }
}

export function sha1Hex(value: string): string {
  return createHash('sha1').update(value, 'utf8').digest('hex');
}
