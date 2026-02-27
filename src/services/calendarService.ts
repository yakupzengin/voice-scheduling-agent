import { google } from 'googleapis';
import { buildAuthorisedClient, mapGoogleError, GoogleApiError } from './googleAuth';
import { logger, hashSessionId } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateEventParams {
  sessionId:    string;
  requestId:    string;
  title:        string;
  description:  string;   // e.g. "Scheduled for {name}"
  startRFC3339: string;   // ISO 8601 with UTC offset from luxon
  endRFC3339:   string;
  timezone:     string;   // IANA — passed as timeZone on event start/end
}

export interface CreateEventResult {
  eventId:  string;
  htmlLink: string;
}

// ---------------------------------------------------------------------------
// createCalendarEvent
// ---------------------------------------------------------------------------

/**
 * Creates a Google Calendar event on the user's primary calendar.
 *
 * - Builds an authorised OAuth2 client from the stored session (auto-refreshes token)
 * - Passes IANA timezone directly to Google so DST is handled server-side
 * - Returns { eventId, htmlLink } on success
 * - Maps all Google errors to GoogleApiError with appropriate HTTP status codes
 */
export async function createCalendarEvent(
  params: CreateEventParams,
): Promise<CreateEventResult> {
  const { sessionId, requestId, title, description, startRFC3339, endRFC3339, timezone } = params;

  const log = logger.child({ requestId, sessionIdHash: hashSessionId(sessionId) });

  log.info(
    {
      event: 'calendar.create.attempt',
      startISO: startRFC3339,
      timezone,
    },
    'calendar.create.attempt',
  );

  // Build OAuth2 client — throws GoogleApiError(401) if session not found
  let oauthClient;
  try {
    oauthClient = buildAuthorisedClient(sessionId);
  } catch (err) {
    if (err instanceof GoogleApiError) throw err;
    throw mapGoogleError(err);
  }

  const calendar = google.calendar({ version: 'v3', auth: oauthClient });

  try {
    const response = await calendar.events.insert({
      calendarId:  'primary',
      requestBody: {
        summary:     title,
        description: description,
        start: {
          dateTime: startRFC3339,
          timeZone: timezone,   // IANA — Google handles DST correctly
        },
        end: {
          dateTime: endRFC3339,
          timeZone: timezone,
        },
      },
    });

    const data = response.data;

    if (!data.id || !data.htmlLink) {
      throw new GoogleApiError('Google Calendar returned an incomplete event response.', 502);
    }

    log.info(
      {
        event:    'calendar.create.success',
        eventId:  data.id,
        htmlLink: data.htmlLink,
      },
      'calendar.create.success',
    );

    return {
      eventId:  data.id,
      htmlLink: data.htmlLink,
    };
  } catch (err) {
    // Don't double-wrap GoogleApiErrors
    if (err instanceof GoogleApiError) {
      log.warn(
        { event: 'calendar.create.failure', status: err.statusCode, message: err.message },
        'calendar.create.failure',
      );
      throw err;
    }

    const mapped = mapGoogleError(err);
    log.error(
      { event: 'calendar.create.failure', status: mapped.statusCode, message: mapped.message },
      'calendar.create.failure',
    );
    throw mapped;
  }
}
