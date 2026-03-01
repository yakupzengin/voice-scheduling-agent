import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as chrono from 'chrono-node';
import { DateTime, IANAZone } from 'luxon';
import { hashSessionId } from '../utils/logger';
import { writeCalendarAuditLog, type CalendarAuditEntry } from '../utils/auditLog';
import { createCalendarEvent } from '../services/calendarService';
import { GoogleApiError } from '../services/googleAuth';

export const calendarRouter = Router();

// ---------------------------------------------------------------------------
// In-memory store: sessionId → list of successfully created events
// Cleared when the process restarts (Railway redeploys).
// Sufficient for a single-session UI — no persistence needed.
// ---------------------------------------------------------------------------
interface SessionEvent {
  title:    string;
  startISO: string;
  timezone: string;
  htmlLink: string;
}
const sessionEventStore = new Map<string, SessionEvent[]>();

/** Append an event to the session store (max 50 per session). */
function storeSessionEvent(sessionId: string, evt: SessionEvent): void {
  const list = sessionEventStore.get(sessionId) ?? [];
  list.push(evt);
  if (list.length > 50) list.shift();
  sessionEventStore.set(sessionId, list);
}

// ---------------------------------------------------------------------------
// GET /api/session-events/:sessionId
// Returns all events created during this session (called after call-end).
// ---------------------------------------------------------------------------
calendarRouter.get('/session-events/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }
  return res.status(200).json({ events: sessionEventStore.get(sessionId) ?? [] });
});

// ---------------------------------------------------------------------------
// Validation schema
//
// date and time are accepted as plain strings — the backend resolves them
// deterministically via chrono-node using the server's real-time clock.
// The LLM only collects the user's intent; it never needs to convert or
// format dates itself.  This permanently eliminates the "Oct 2023" issue
// that arose when the LLM anchored relative expressions to its training data.
// ---------------------------------------------------------------------------

const CreateEventSchema = z.object({
  /** Session ID returned from OAuth — links request to a stored refresh token */
  sessionId: z.string().uuid({ message: 'sessionId must be a valid UUID' }),

  /** Attendee / invitee name — used in event description */
  name: z
    .string()
    .min(1, 'name is required')
    .max(100, 'name must be 100 characters or fewer')
    .trim(),

  /**
   * Date as provided by the user — any natural-language string is accepted
   * (e.g. "today", "tomorrow", "5 March", "2026-03-15").
   * chrono-node resolves it server-side using the real runtime clock.
   */
  date: z.string().min(1, 'date is required').trim(),

  /**
   * Time as provided by the user — any natural-language string is accepted
   * (e.g. "3 PM", "15:00", "3pm", "3 in the afternoon").
   * chrono-node resolves it server-side using the real runtime clock.
   */
  time: z.string().min(1, 'time is required').trim(),

  /**
   * IANA timezone identifier e.g. "America/New_York", "Europe/London".
   * Injected automatically from browser metadata — no LLM guessing needed.
   */
  timezone: z
    .string()
    .refine((tz) => IANAZone.isValidZone(tz), {
      message: 'timezone must be a valid IANA timezone (e.g. "America/New_York")',
    }),

  /** Meeting duration in minutes — clamped between 5 and 240 (4 hours max) */
  durationMins: z
    .number({ invalid_type_error: 'durationMins must be a number' })
    .int('durationMins must be an integer')
    .min(5, 'durationMins must be at least 5')
    .max(240, 'durationMins must be at most 240'),

  /** Optional human-readable event title — defaults to "Meeting with {name}" if omitted */
  title: z
    .string()
    .min(1)
    .max(200, 'title must be 200 characters or fewer')
    .trim()
    .optional(),
});

export type CreateEventInput = z.infer<typeof CreateEventSchema>;

// ---------------------------------------------------------------------------
// POST /api/create-event
// ---------------------------------------------------------------------------

calendarRouter.post('/create-event', async (req: Request, res: Response) => {
  // --- 0. Write 'received' audit entry FIRST — before any processing ---
  writeCalendarAuditLog({
    timestamp:     new Date().toISOString(),
    requestId:     req.requestId,
    sessionIdHash: '--',
    stage:         'received',
    rawBody:       req.body,
  });

  // --- 1. Log raw request (full body — critical for debugging Vapi envelope) ---
  console.log('===== TOOL REQUEST RECEIVED =====');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Raw Body:', JSON.stringify(req.body, null, 2));
  console.log('=================================');

  // ---------------------------------------------------------------------------
  // --- 2. Unwrap Vapi webhook envelope ---
  //
  // Vapi POSTs tool calls as:
  //   { message: { type: "tool-calls", toolCallList: [{ id, function: { name, arguments } }], call: { metadata } } }
  //
  // We extract:
  //   - toolCallId  — required for the Vapi response format
  //   - args        — the actual tool arguments (flat object)
  //   - callMeta    — call.metadata fallback for sessionId / timezone
  //
  // If the body is already flat (e.g. direct curl test), we use it as-is.
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = req.body as any;
  const isVapiEnvelope =
    body?.message?.type === 'tool-calls' &&
    Array.isArray(body?.message?.toolCallList) &&
    body.message.toolCallList.length > 0;

  const toolCallId: string | undefined = isVapiEnvelope
    ? (body.message.toolCallList[0].id as string | undefined)
    : undefined;

  // Raw args — either unwrapped from Vapi envelope or the body itself
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawArgs: Record<string, any> = isVapiEnvelope
    ? (body.message.toolCallList[0].function?.arguments ?? {})
    : body;

  // call.metadata provides sessionId and timezone injected by the session page
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callMeta: Record<string, any> = isVapiEnvelope
    ? (body.message?.call?.metadata ?? {})
    : {};

  // Merge: explicit args take precedence; metadata fills missing sessionId / timezone
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merged: Record<string, any> = {
    sessionId: callMeta.sessionId,
    timezone:  callMeta.timezone,
    ...rawArgs,
  };

  req.log.info(
    { isVapiEnvelope, toolCallId, argKeys: Object.keys(rawArgs), metaKeys: Object.keys(callMeta) },
    'Calendar: envelope unwrapped',
  );

  // Helper: send a response in Vapi's expected format.
  // Always HTTP 200 — non-200 causes Vapi to show "No result returned" to the LLM.
  // For errors we return a descriptive string so the LLM can relay it to the user.
  function vapiReply(result: string, httpStatus = 200): void {
    if (toolCallId) {
      res.status(httpStatus).json({ results: [{ toolCallId, result }] });
    } else {
      // Direct (non-Vapi) caller — use plain JSON
      res.status(httpStatus).json({ error: result });
    }
  }

  // --- 3. Zod schema validation ---
  const parseResult = CreateEventSchema.safeParse(merged);
  if (!parseResult.success) {
    const fieldErrors = parseResult.error.flatten().fieldErrors;
    req.log.warn({ fieldErrors, merged }, 'Calendar: validation failed');

    const sessionIdHash =
      typeof merged?.sessionId === 'string' && merged.sessionId.length > 0
        ? hashSessionId(merged.sessionId as string)
        : '--';

    writeCalendarAuditLog({
      timestamp:     new Date().toISOString(),
      requestId:     req.requestId,
      sessionIdHash,
      stage:         'validation_error',
      rawBody:       req.body,
      errorMessage:  JSON.stringify(fieldErrors),
    });

    const errorSummary = Object.entries(fieldErrors)
      .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(', ')}`)
      .join('; ');

    vapiReply(`Validation failed — ${errorSummary}`);
    return;
  }

  const { sessionId, name, date, time, timezone, durationMins, title } = parseResult.data;

  // Compute once — used in every audit entry for this request
  const sessionIdHash = hashSessionId(sessionId);

  // Shared input block for all audit entries
  const auditInput: CalendarAuditEntry['input'] = {
    date, time, timezone, durationMins, name, title,
  };

  // --- 3. chrono-node date/time parsing ---
  //
  // The LLM sends whatever the user said — "today", "5 March", "3 PM", etc.
  //
  // TIMEZONE TRICK: chrono-node has no timezone awareness — it always uses the
  // JS environment's local time (UTC on Railway). To make "tomorrow" and
  // "11 PM" resolve correctly in the USER's timezone we:
  //
  //   1. Compute "now" in the user's timezone via luxon.
  //   2. Build a fake JS Date whose UTC fields hold those local components
  //      (e.g. if Istanbul is 01:24 on March 2, we create Date(2026,2,2,1,24,0)
  //       which JS stores as if it were 01:24 UTC).  chrono sees those
  //      components and resolves "tomorrow" as March 3.
  //   3. Parse — chrono returns a Date whose UTC fields are the user's
  //      intended local wall-clock time (23:00 for "11 PM").
  //   4. Apply the real timezone with keepLocalTime:true — luxon reinterprets
  //      those UTC components as Istanbul time → 2026-03-03T23:00:00+03:00 ✓
  //
  // Without this trick: "11 PM" → parsed as 23:00 UTC → displayed as
  // 02:00 Istanbul (+3 h shift) — 3-hour error the user observed.
  //
  const nowInUserTz = DateTime.now().setZone(timezone);
  // Fake reference: UTC fields = user's local time components
  const tzAwareRef = new Date(
    nowInUserTz.year,
    nowInUserTz.month - 1,   // JS months are 0-based
    nowInUserTz.day,
    nowInUserTz.hour,
    nowInUserTz.minute,
    nowInUserTz.second,
  );

  const combined = `${date} ${time}`;
  const parsedDate = chrono.parseDate(combined, tzAwareRef, { forwardDate: true });

  if (!parsedDate) {
    const msg =
      `Could not parse date/time from: "${combined}". ` +
      'Please provide a recognisable date and time (e.g. "tomorrow at 3pm" or "5 March at 14:00").';
    req.log.warn({ date, time, combined }, 'Calendar: chrono could not parse datetime');

    writeCalendarAuditLog({
      timestamp:    new Date().toISOString(),
      requestId:    req.requestId,
      sessionIdHash,
      stage:        'validation_error',
      rawBody:      req.body,
      input:        auditInput,
      timezone,
      errorMessage: msg,
    });

    vapiReply(msg);
    return;
  }

  // keepLocalTime: true — treat parsedDate's UTC fields as the user's local
  // wall-clock time, then anchor to the real timezone offset.
  const startDt = DateTime.fromJSDate(parsedDate).setZone(timezone, { keepLocalTime: true });

  if (!startDt.isValid) {
    const msg =
      `Parsed datetime is invalid for timezone "${timezone}". ` +
      (startDt.invalidExplanation ?? 'luxon could not apply the timezone.');
    req.log.warn({ combined, timezone, reason: startDt.invalidExplanation }, 'Calendar: invalid timezone application');

    writeCalendarAuditLog({
      timestamp:    new Date().toISOString(),
      requestId:    req.requestId,
      sessionIdHash,
      stage:        'validation_error',
      rawBody:      req.body,
      input:        auditInput,
      timezone,
      errorMessage: msg,
    });

    vapiReply(msg);
    return;
  }

  const startISO = startDt.toFormat("yyyy-MM-dd'T'HH:mm:ss");
  const endISO   = startDt.plus({ minutes: durationMins }).toFormat("yyyy-MM-dd'T'HH:mm:ss");

  console.log(`[create-event] parsed → startISO=${startISO}  endISO=${endISO}  zone=${timezone}`);

  // --- 4. Past-date guard ---
  if (startDt <= DateTime.now().setZone(timezone)) {
    const msg =
      `The requested time ${startISO} (${timezone}) is in the past. ` +
      'Please choose a future date and time.';
    req.log.warn({ startISO, timezone }, 'Calendar: event is in the past');

    writeCalendarAuditLog({
      timestamp:      new Date().toISOString(),
      requestId:      req.requestId,
      sessionIdHash,
      stage:          'past_time',
      rawBody:        req.body,
      input:          auditInput,
      parsedStartISO: startISO,
      parsedEndISO:   endISO,
      timezone,
      errorMessage:   msg,
    });

    vapiReply(msg);
    return;
  }

  const eventTitle = title ?? `Meeting with ${name}`;

  req.log.info(
    { sessionIdHash, eventTitle, startISO, endISO, timezone, durationMins },
    'Calendar: create-event request validated',
  );

  // --- 5. Build Google payload (also stored in audit on success/error) ---
  const googlePayload: CalendarAuditEntry['googlePayload'] = {
    summary: eventTitle,
    start:   { dateTime: startISO, timeZone: timezone },
    end:     { dateTime: endISO,   timeZone: timezone },
  };

  console.log('===== GOOGLE EVENT INPUT =====');
  console.log(googlePayload);
  console.log('================================');

  // --- 6. Create event via Google Calendar ---
  try {
    const result = await createCalendarEvent({
      sessionId,
      requestId:    req.requestId,
      title:        eventTitle,
      description:  `Scheduled for ${name}`,
      startRFC3339: startISO,
      endRFC3339:   endISO,
      timezone,
    });

    writeCalendarAuditLog({
      timestamp:      new Date().toISOString(),
      requestId:      req.requestId,
      sessionIdHash,
      stage:          'google_success',
      rawBody:        req.body,
      input:          auditInput,
      parsedStartISO: startISO,
      parsedEndISO:   endISO,
      timezone,
      googlePayload,
      eventId:        result.eventId,
      htmlLink:       result.htmlLink,
    });

    // Store for client-side polling after call ends
    storeSessionEvent(sessionId, {
      title:    eventTitle,
      startISO,
      timezone,
      htmlLink: result.htmlLink,
    });

    vapiReply(
      `Successfully created "${eventTitle}" on ${startISO} (${timezone}).`,
    );
    return;

  } catch (err) {
    if (err instanceof GoogleApiError) {
      writeCalendarAuditLog({
        timestamp:      new Date().toISOString(),
        requestId:      req.requestId,
        sessionIdHash,
        stage:          'google_error',
        rawBody:        req.body,
        input:          auditInput,
        parsedStartISO: startISO,
        parsedEndISO:   endISO,
        timezone,
        googlePayload,
        googleStatus:   err.statusCode,
        errorMessage:   err.message,
      });

      vapiReply(err.message);
      return;
    }

    const message = err instanceof Error ? err.message : 'Unknown error';
    req.log.error({ sessionIdHash, error: message }, 'Calendar: unexpected error');

    writeCalendarAuditLog({
      timestamp:      new Date().toISOString(),
      requestId:      req.requestId,
      sessionIdHash,
      stage:          'google_error',
      rawBody:        req.body,
      input:          auditInput,
      parsedStartISO: startISO,
      parsedEndISO:   endISO,
      timezone,
      googlePayload,
      googleStatus:   500,
      errorMessage:   message,
    });

    vapiReply('Internal server error. Please try again.');
    return;
  }
});
