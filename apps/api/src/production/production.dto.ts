import { z } from 'zod';

// P4.19 B — supplier production reports (photos/videos) and the "ready" signal.
export const productionReportSchema = z.object({
  note: z.string().trim().max(2000).optional(),
  fileObjectIds: z.array(z.string().cuid()).min(1).max(10),
});
export type ProductionReportInput = z.infer<typeof productionReportSchema>;

export const productionReadySchema = z.object({
  note: z.string().trim().max(2000).optional(),
  fileObjectIds: z.array(z.string().cuid()).max(10).default([]),
});
export type ProductionReadyInput = z.infer<typeof productionReadySchema>;
