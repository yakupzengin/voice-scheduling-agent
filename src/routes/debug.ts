import { Router } from 'express';
import * as fs   from 'fs';
import { ringBuffer } from '../utils/ringBuffer';
import { AUDIT_FILE } from '../utils/auditLog';
import { env } from '../config/env';

export const debugRouter = Router();

/**
 * GET /debug/last-logs
 *
 * Returns the last 200 structured log lines from the in-memory ring buffer.
 * Available in development only (NODE_ENV !== 'production').
 *
 * Secrets are safe here: pino redacts all sensitive keys BEFORE lines reach
 * the ring buffer, so no tokens or secrets can appear in the output.
 */
debugRouter.get('/last-logs', (_req, res) => {
  if (env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const entries = ringBuffer.drain();
  return res.status(200).json({
    count:   entries.length,
    entries,
  });
});

/**
 * GET /debug/last-audit[?n=50]
 *
 * Returns the last N lines (default 50, max 200) of logs/calendar-audit.jsonl
 * as a JSON array. Shows every scheduling attempt with full input, parsed
 * ISO times, Google payload, and outcome.
 *
 * Available in development only. Returns 404 in production.
 *
 * Query params:
 *   n  — number of lines to return (1–200, default 50)
 */
debugRouter.get('/last-audit', (req, res) => {
  if (env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  if (!fs.existsSync(AUDIT_FILE)) {
    return res.status(200).json({ count: 0, entries: [], file: AUDIT_FILE });
  }

  const n = Math.min(Math.max(Number(req.query.n) || 50, 1), 200);

  const raw     = fs.readFileSync(AUDIT_FILE, 'utf8');
  const lines   = raw.split('\n').filter(Boolean);
  const lastN   = lines.slice(-n);
  const entries = lastN.map((line) => {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      return { _parseError: true, raw: line };
    }
  });

  return res.status(200).json({
    count:   entries.length,
    total:   lines.length,
    file:    AUDIT_FILE,
    entries,
  });
});
