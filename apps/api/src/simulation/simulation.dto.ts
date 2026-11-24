import { z } from 'zod';

// P4.21 — demo automation is only reachable when ENABLE_SIMULATION=true.
export const setSimulationSchema = z.object({
  enabled: z.boolean(),
});
export type SetSimulationInput = z.infer<typeof setSimulationSchema>;

export const pumpSimulationSchema = z.object({
  orderId: z.string().cuid().optional(),
  now: z.coerce.date().optional(),
});
export type PumpSimulationInput = z.infer<typeof pumpSimulationSchema>;
