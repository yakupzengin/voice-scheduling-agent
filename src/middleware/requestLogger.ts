import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

/**
 * Attaches a unique requestId (UUID v4) to every inbound request and binds a
 * child pino logger so all downstream log calls carry the same requestId.
 *
 * Log fields: requestId, method, path, ip
 * Never logged: body, headers, query params (may contain tokens/secrets)
 */
export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = uuidv4();
  req.log = logger.child({ requestId: req.requestId });

  req.log.info(
    { method: req.method, path: req.path, ip: req.ip },
    'Request received',
  );

  next();
}
