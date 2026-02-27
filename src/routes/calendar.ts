import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DateTime, IANAZone } from 'luxon';
import { hashSessionId } from '../utils/logger';
import { createCalendarEvent } from '../services/calendarService';
import { GoogleApiError } from '../services/googleAuth';

export const calendarRouter = Router();

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
   * Date in YYYY-MM-DD format (local date in the provided timezone).
   * The backend constructs the full datetime — the LLM must NOT perform
   * timezone offset arithmetic itself.
   */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),

  /**
   * Time in HH:mm 24-hour format (local time in the provided timezone).
   */
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be in HH:mm 24-hour format'),

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

  // --- 2. Construct datetime with luxon and validate not-in-the-past ---
  const [year, month, day]   = date.split('-').map(Number);
  const [hour, minute]       = time.split(':').map(Number);

  const startDt = DateTime.fromObject(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { zone: timezone },
  );

  if (!startDt.isValid) {
    req.log.warn({ date, time, timezone }, 'Calendar: invalid datetime constructed');
    return res.status(400).json({
      error: 'Invalid date/time combination for the given timezone.',
    });
  }

  if (startDt <= DateTime.now()) {
    req.log.warn({ startDt: startDt.toISO(), timezone }, 'Calendar: event is in the past');
    return res.status(400).json({
      error: 'The requested event time is in the past. Please choose a future date and time.',
    });
  }

  const endDt        = startDt.plus({ minutes: durationMins });
  // RFC3339 with offset — safe to pass directly to Google Calendar API
  const startRFC3339 = startDt.toISO()!;
  const endRFC3339   = endDt.toISO()!;
  const eventTitle   = title ?? `Meeting with ${name}`;

  req.log.info(
    {
      sessionIdHash: hashSessionId(sessionId),
      eventTitle,
      startRFC3339,
      endRFC3339,
      timezone,
      durationMins,
    },
    'Calendar: create-event request validated',
  );

  // --- 3. Create event via Google Calendar ---
  // buildAuthorisedClient (inside calendarService) loads the refresh token from
  // SQLite by sessionId and throws GoogleApiError(401) if no session is found.
  try {
    const result = await createCalendarEvent({
      sessionId,
      requestId:    req.requestId,
      title:        eventTitle,
      description:  `Scheduled for ${name}`,
      startRFC3339,
      endRFC3339,
      timezone,
    });

    return res.status(201).json({
      ok:           true,
      eventId:      result.eventId,
      htmlLink:     result.htmlLink,
      summary:      eventTitle,
      startISO:     startRFC3339,
      endISO:       endRFC3339,
      timezone,
    });
  } catch (err) {
    if (err instanceof GoogleApiError) {
      // Status code already determined by error mapper — pass it through
      return res.status(err.statusCode).json({
        ok:     false,
        error:  err.message,
      });
    }

    const message = err instanceof Error ? err.message : 'Unknown error';
    req.log.error(
      { sessionIdHash: hashSessionId(sessionId), error: message },
      'Calendar: unexpected error',
    );
    return res.status(500).json({ ok: false, error: 'Internal server error.' });
  }
});
