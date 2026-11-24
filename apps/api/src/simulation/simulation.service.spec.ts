import { Role } from '@cvc/shared';
import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { SimulationService } from './simulation.service';

// P4.21 DoD — the service returns 404 unless the environment enables the
// simulation. No DB is touched because the environment gate runs first.
function buildService(config: { isProduction: boolean; enableSimulation: boolean }) {
  const configService = {
    get: (key: string) =>
      key === 'app.isProduction'
        ? config.isProduction
        : key === 'app.enableSimulation'
          ? config.enableSimulation
          : undefined,
  } as unknown as ConfigService;
  return new SimulationService(configService, {} as never, {} as never, {} as never, {} as never);
}

const actor = { sub: 'u1', email: 'u1@example.com', sid: 's1', role: Role.Admin };

describe('Simulation environment gate (P4.21)', () => {
  it('returns 404 when ENABLE_SIMULATION is off', async () => {
    const service = buildService({ isProduction: false, enableSimulation: false });
    await expect(service.setAuto(actor, 'order-1', { enabled: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.pump(actor, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 in production even if the flag is on', async () => {
    const service = buildService({ isProduction: true, enableSimulation: true });
    await expect(service.setAuto(actor, 'order-1', { enabled: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
