import pino from 'pino';
import { createHash } from 'crypto';
import { env } from '../config/env';
import { ringBuffer, type LogEntry } from './ringBuffer';

// ---------------------------------------------------------------------------
// Security: redact sensitive keys at any depth before writing to stdout.
// This is a final safety net — catches accidental token leaks even if a
// developer logs a credentials object directly.
// ---------------------------------------------------------------------------
const REDACTED_KEYS = [
  'access_token',
  'refresh_token',
  'client_secret',
  'code',
  '*.access_token',
  '*.refresh_token',
  '*.client_secret',
  '*.code',
  'req.headers.authorization',
];

// ---------------------------------------------------------------------------
// Ring buffer destination — dev only.
// Pino redacts BEFORE passing to destinations, so no secrets reach the buffer.
// ---------------------------------------------------------------------------
const destinations: pino.StreamEntry[] = [
  { stream: pino.destination({ sync: false }), level: env.LOG_LEVEL as pino.Level },
];

if (env.NODE_ENV !== 'production') {
  const bufferStream: pino.DestinationStream = {
    write(line: string): void {
      try {
        const entry = JSON.parse(line) as LogEntry;
        ringBuffer.push(entry);
      } catch {
        // malformed line — ignore
      }
    },
  };
  destinations.push({ stream: bufferStream, level: env.LOG_LEVEL as pino.Level });
}

const multiDest = pino.multistream(destinations);

// ---------------------------------------------------------------------------
// Transport (pretty-print in dev, plain JSON in production)
// ---------------------------------------------------------------------------
const baseOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths:  REDACTED_KEYS,
    censor: '[REDACTED]',
  },
};

export const logger =
  env.NODE_ENV !== 'production'
    ? pino(
        {
          ...baseOptions,
          transport: {
            target:  'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          },
        },
      )
    : pino(baseOptions, multiDest);

// ---------------------------------------------------------------------------
// Utility: one-way hash of a sessionId for safe log correlation.
// Allows tracing a session across logs without exposing the raw UUID.
// ---------------------------------------------------------------------------
export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 12);
}
