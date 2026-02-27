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

const baseOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths:  REDACTED_KEYS,
    censor: '[REDACTED]',
  },
};

const isProd = env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Production: plain JSON to stdout — no devDependencies needed.
//
// Development: pino-pretty transport (human-readable, colorized) combined
// with a ring-buffer destination (feeds GET /debug/last-logs).
// Using pino.transport() here — instead of the logger-options `transport:`
// key — lets us pass the resulting stream into pino.multistream() so that
// both destinations receive every log line that pino has already redacted.
// ---------------------------------------------------------------------------
export const logger: pino.Logger = isProd
  ? pino(baseOptions)
  : (() => {
      const prettyStream = pino.transport({
        target:  'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      });

      const bufferStream: pino.DestinationStream = {
        write(line: string): void {
          try {
            ringBuffer.push(JSON.parse(line) as LogEntry);
          } catch {
            // malformed JSON line — ignore
          }
        },
      };

      const multi = pino.multistream([
        { stream: prettyStream, level: env.LOG_LEVEL as pino.Level },
        { stream: bufferStream, level: env.LOG_LEVEL as pino.Level },
      ]);

      return pino(baseOptions, multi);
    })();

// ---------------------------------------------------------------------------
// Utility: one-way hash of a sessionId for safe log correlation.
// Allows tracing a session across logs without exposing the raw UUID.
// ---------------------------------------------------------------------------
export function hashSessionId(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 12);
}
