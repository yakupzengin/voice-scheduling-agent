import * as fs   from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Persistent calendar audit log — one JSON line per scheduling attempt.
//
// File:  logs/calendar-audit.jsonl  (newline-delimited JSON, append-only)
// The logs/ directory is created at module load time if it doesn't exist.
//
// Security guarantees:
//   - sessionId is NEVER written — callers must pass the pre-hashed value.
//   - rawBody is written verbatim; it must never contain access_token,
//     refresh_token, or client_secret (our Zod schema doesn't accept them).
//   - appendFileSync flushes every entry before the HTTP response leaves,
//     so no entries are lost on an unclean shutdown.
// ---------------------------------------------------------------------------

export const LOG_DIR   = path.resolve(process.cwd(), 'logs');
export const AUDIT_FILE = path.join(LOG_DIR, 'calendar-audit.jsonl');

// Create logs/ directory once at startup — no-op if it already exists.
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Stage type — every audit entry records which stage terminated the request
// ---------------------------------------------------------------------------

export type AuditStage =
  | 'received'           // written at the very start of every request
  | 'validation_error'   // Zod schema or format regex rejected the input
  | 'past_time'          // luxon confirmed the requested time is in the past
  | 'google_success'     // calendar.events.insert returned 200 OK
  | 'google_error';      // Google API error or unexpected server error

// ---------------------------------------------------------------------------
// Entry shape
// ---------------------------------------------------------------------------

export interface CalendarAuditEntry {
  /** ISO 8601 UTC timestamp of the log write */
  timestamp: string;

  /** UUID v4 from requestLogger middleware */
  requestId: string;

  /**
   * sha256[:12] of the sessionId — never the raw UUID.
   * '--' when sessionId is missing or unparseable (e.g. Zod pre-fail).
   */
  sessionIdHash: string;

  /** Terminal stage of this scheduling attempt */
  stage: AuditStage;

  /**
   * req.body exactly as received from Vapi, before any transformation.
   * Used to reproduce and diagnose issues in production.
   */
  rawBody: unknown;

  /** Populated when Zod validation passes */
  input?: {
    date:         string;
    time:         string;
    timezone:     string;
    durationMins: number;
    name:         string;
    title?:       string;
  };

  /** luxon-formatted start in the user's IANA timezone (YYYY-MM-DDTHH:mm:ss) */
  parsedStartISO?: string;

  /** luxon-formatted end in the user's IANA timezone */
  parsedEndISO?: string;

  /** IANA timezone used for all datetime operations */
  timezone?: string;

  /** The exact request body sent to calendar.events.insert */
  googlePayload?: {
    summary: string;
    start:   { dateTime: string; timeZone: string };
    end:     { dateTime: string; timeZone: string };
  };

  /** Human-readable reason for rejection — absent on success */
  errorMessage?: string;

  /** HTTP status code returned by Google — absent on success */
  googleStatus?: number;

  /** Google Calendar event ID — populated on google_success */
  eventId?: string;

  /** Google Calendar HTML link — populated on google_success */
  htmlLink?: string;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Appends one CalendarAuditEntry to logs/calendar-audit.jsonl.
 * Uses synchronous I/O — the entry is on disk before the HTTP response leaves.
 * I/O errors are swallowed with a stderr warning; they must never propagate
 * to the caller and cause a spurious 500.
 */
export function writeCalendarAuditLog(entry: CalendarAuditEntry): void {
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (ioErr) {
    console.error('[auditLog] Failed to write to logs/calendar-audit.jsonl:', ioErr);
  }
}

