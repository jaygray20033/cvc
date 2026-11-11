// Block destructive reset in production (CLAUDE.md / P1.5 DoD).
import { execSync } from 'node:child_process';

if (process.env.NODE_ENV === 'production') {
  console.error('prisma:reset is blocked when NODE_ENV=production.');
  process.exit(1);
}

execSync('pnpm exec prisma migrate reset --force', { stdio: 'inherit' });
