import type { Logger } from 'pino';

// Augment the Express Request interface via express-serve-static-core — the
// internal module that @types/express reads from. This is more reliably picked
// up by ts-node than the global `namespace Express` pattern.
declare module 'express-serve-static-core' {
  interface Request {
    /** UUID v4 assigned per-request; included in every log line for tracing. */
    requestId: string;
    /** Pino child logger with requestId pre-bound. Use req.log instead of the root logger. */
    log: Logger;
  }
}
