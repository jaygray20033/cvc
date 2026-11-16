import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { TokenService } from './auth/token.service';
import { DEAD_LETTER_QUEUE, QUEUE_NAMES } from './queue/queue.constants';
import { QueueService } from './queue/queue.service';

// Bull-board UI mounted at /api/v1/admin/queues (P2.19). Not a Nest route, so
// it does not go through the Nest guard chain: a small express middleware
// verifies the bearer token and requires the admin role.
export function mountJobBoard(app: INestApplication): void {
  const queues = app.get(QueueService);
  const tokens = app.get(TokenService);

  const adapter = new ExpressAdapter();
  createBullBoard({
    queues: [...QUEUE_NAMES, DEAD_LETTER_QUEUE].map(
      (name) => new BullMQAdapter(queues.getQueue(name as (typeof QUEUE_NAMES)[number])),
    ),
    serverAdapter: adapter,
  });
  adapter.setBasePath('/api/v1/admin/queues');

  const guard = (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
    if (!token) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Missing bearer token.' });
      return;
    }
    try {
      const payload = tokens.verifyAccessToken(token);
      if (payload.role !== 'admin') {
        res.status(403).json({ code: 'FORBIDDEN', message: 'Admin only.' });
        return;
      }
      next();
    } catch {
      res.status(401).json({ code: 'UNAUTHORIZED', message: 'Invalid or expired access token.' });
    }
  };
  app.use('/api/v1/admin/queues', guard, adapter.getRouter());
}
