import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { IANAZone } from 'luxon';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import utc from 'dayjs/plugin/utc';
import dayjsTimezone from 'dayjs/plugin/timezone';
import { hashSessionId } from '../utils/logger';
import { createCalendarEvent } from '../services/calendarService';
import { GoogleApiError } from '../services/googleAuth';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(dayjsTimezone);

export const calendarRouter = Router();

// ---------------------------------------------------------------------------
// Flexible datetime parsing
// ---------------------------------------------------------------------------

// Date formats the LLM commonly produces
const DATE_FORMATS = [
  'YYYY-MM-DD',       // 2026-02-28  (strict ISO — try first)
  'DD/MM/YYYY',       // 28/02/2026
  'MM/DD/YYYY',       // 02/28/2026
  'D/M/YYYY',         // 2/3/2026
  'MMMM D, YYYY',     // February 28, 2026
  'MMMM D YYYY',      // February 28 2026
  'MMM D, YYYY',      // Feb 28, 2026
  'MMM D YYYY',       // Feb 28 2026
  'D MMMM YYYY',      // 28 February 2026
  'D MMM YYYY',       // 28 Feb 2026
];

// Time formats the LLM commonly produces
const TIME_FORMATS = [
  'HH:mm',            // 14:30
  'H:mm',             // 9:30
  'HH:mm:ss',         // 14:30:00
  'h:mm A',           // 2:30 PM
  'h:mm a',           // 2:30 pm
  'h A',              // 3 PM
  'h a',              // 3 pm
  'hA',               // 3PM
  'ha',               // 3pm
  'h:mm:ss A',        // 2:30:00 PM
];

/**
 * Tries every DATE × TIME format combination via dayjs customParseFormat.
 * Returns an ISO-8601 local datetime string "YYYY-MM-DDTHH:mm:ss" in the
 * given IANA timezone, or throws if no format matches.
 */
function parseFlexibleDatetime(
  rawDate: string,
  rawTime: string,
  tz: string,
): { startISO: string; dayjsDt: dayjs.Dayjs } {
  const combined = `${rawDate.trim()} ${rawTime.trim()}`;

  for (const dateFmt of DATE_FORMATS) {
    for (const timeFmt of TIME_FORMATS) {
      const dt = dayjs.tz(combined, `${dateFmt} ${timeFmt}`, tz);
      if (dt.isValid()) {
        return {
          startISO: dt.format('YYYY-MM-DDTHH:mm:ss'),
          dayjsDt:  dt,
        };
      }
    }
  }

  throw new Error(
    `Invalid date/time format received from assistant: date="${rawDate}" time="${rawTime}"`,
  );
}

// ---------------------------------------------------------------------------
// Validation schema
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
   * Date as a plain string — any human-readable format is accepted.
   * The backend normalises it; the LLM does not need strict YYYY-MM-DD.
   * Examples: "2026-03-15", "15/03/2026", "March 15, 2026"
   */
  date: z.string().min(1, 'date is required').trim(),

  /**
   * Time as a plain string — any human-readable format is accepted.
   * The backend normalises it; the LLM does not need strict HH:mm.
   * Examples: "14:30", "2:30 PM", "3 PM"
   */
  time: z.string().min(1, 'time is required').trim(),

  /**
   * IANA timezone identifier e.g. "America/New_York", "Europe/London".
   * Validated against luxon's IANAZone — guarantees DST is handled correctly
   * by the Google Calendar API.
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
  // --- 1. Zod schema validation ---
  console.log('Raw tool input:', req.body);

  const parsed = CreateEventSchema.safeParse(req.body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    req.log.warn({ fieldErrors }, 'Calendar: validation failed');
    return res.status(400).json({
      error: 'Validation failed',
      details: fieldErrors,
    });
  }

  const { sessionId, name, date, time, timezone, durationMins, title } = parsed.data;

  // --- 2. Flexible datetime parsing with dayjs ---
  let startISO: string;
  let endISO: string;
  let startDt: dayjs.Dayjs;

  try {
    const result = parseFlexibleDatetime(date, time, timezone);
    startISO = result.startISO;
    startDt  = result.dayjsDt;
    endISO   = startDt.add(durationMins, 'minute').format('YYYY-MM-DDTHH:mm:ss');
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    req.log.warn({ date, time, timezone, error: msg }, 'Calendar: datetime parse failed');
    return res.status(400).json({ error: msg });
  }

  console.log('Generated ISO start:', startISO, '| end:', endISO);

  // --- 3. Past-date guard ---
  if (!startDt.isAfter(dayjs())) {
    req.log.warn({ startISO, timezone }, 'Calendar: event is in the past');
    return res.status(400).json({
      error: 'The requested event time is in the past. Please choose a future date and time.',
    });
  }

  const eventTitle = title ?? `Meeting with ${name}`;

  req.log.info(
    {
      sessionIdHash: hashSessionId(sessionId),
      eventTitle,
      startISO,
      endISO,
      timezone,
      durationMins,
    },
    'Calendar: create-event request validated',
  );

  // --- 4. Create event via Google Calendar ---
  // buildAuthorisedClient (inside calendarService) loads the refresh token from
  // SQLite by sessionId and throws GoogleApiError(401) if no session is found.
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

    return res.status(201).json({
      ok:       true,
      eventId:  result.eventId,
      htmlLink: result.htmlLink,
      summary:  eventTitle,
      startISO,
      endISO,
      timezone,
    });
  } catch (err) {
    if (err instanceof GoogleApiError) {
      return res.status(err.statusCode).json({ ok: false, error: err.message });
    }

    const message = err instanceof Error ? err.message : 'Unknown error';
    req.log.error(
      { sessionIdHash: hashSessionId(sessionId), error: message },
      'Calendar: unexpected error',
    );
    return res.status(500).json({ ok: false, error: 'Internal server error.' });
  }
});
