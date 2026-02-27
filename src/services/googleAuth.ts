import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';
import { logger, hashSessionId } from '../utils/logger';
import { getRefreshToken, upsertSession } from '../db/sqlite';

// ---------------------------------------------------------------------------
// Custom error — carries an HTTP status code for the route handler to use
// ---------------------------------------------------------------------------

export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

// ---------------------------------------------------------------------------
// OAuth2 client factory
// ---------------------------------------------------------------------------

/** Returns a configured OAuth2 client. Credentials are NOT set here. */
function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

// ---------------------------------------------------------------------------
// Auth URL
// ---------------------------------------------------------------------------

/**
 * Builds the Google consent-screen URL.
 * The sessionId round-trips through the `state` param — no server-side session
 * storage needed before the callback.
 */
export function buildAuthUrl(sessionId: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',   // required to get a refresh_token
    prompt:      'consent',   // always show consent screen so refresh_token is issued
    scope:       ['https://www.googleapis.com/auth/calendar.events'],
    state:       sessionId,
  });
}

// ---------------------------------------------------------------------------
// Code exchange
// ---------------------------------------------------------------------------

/**
 * Exchanges a one-time authorization code for tokens.
 * Returns ONLY { refreshToken, expiryDate } — access_token is never stored or logged.
 */
export async function exchangeCodeForTokens(
  code: string,
): Promise<{ refreshToken: string; expiryDate: number | null | undefined }> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh_token. ' +
      'Ensure prompt=consent is set and the user has not previously granted access.',
    );
  }

  return {
    refreshToken: tokens.refresh_token,  // stored in SQLite — never logged
    expiryDate:   tokens.expiry_date,    // safe to log
  };
}

// ---------------------------------------------------------------------------
// Authorised client (used per API call)
// ---------------------------------------------------------------------------

/**
 * Loads the refresh_token for `sessionId` from SQLite, configures an OAuth2
 * client, and attaches a token-rotation listener.
 *
 * Token rotation: if Google issues a new refresh_token, it is upserted to SQLite
 * immediately. Only expiry_date is logged — token strings are never logged.
 *
 * Throws GoogleApiError(401) if no session is found.
 */
export function buildAuthorisedClient(sessionId: string): OAuth2Client {
  const refreshToken = getRefreshToken(sessionId);

  if (!refreshToken) {
    throw new GoogleApiError(
      'Session not connected. Please authorise with Google Calendar first.',
      401,
    );
  }

  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });

  // Fired automatically by googleapis whenever the access_token is silently refreshed
  client.on('tokens', (tokens) => {
    // Log only expiry_date — never the token strings
    logger.debug(
      { sessionIdHash: hashSessionId(sessionId), expiryDate: tokens.expiry_date },
      'google.auth: access token refreshed',
    );

    // If Google rotated the refresh_token (rare but possible), persist the new one
    if (tokens.refresh_token) {
      upsertSession(sessionId, tokens.refresh_token);
      logger.debug(
        { sessionIdHash: hashSessionId(sessionId) },
        'google.auth: rotated refresh_token saved to DB',
      );
    }
  });

  return client;
}

// ---------------------------------------------------------------------------
// Error mapper — converts raw Google API / auth errors to GoogleApiError
// ---------------------------------------------------------------------------

/**
 * Call this in catch blocks after Google API calls.
 * Maps known Google error codes to appropriate HTTP status codes.
 */
export function mapGoogleError(err: unknown): GoogleApiError {
  if (err instanceof GoogleApiError) return err;

  // googleapis wraps errors in an object with .code and .errors[]
  const e = err as {
    code?:    number | string;
    message?: string;
    errors?:  { reason?: string; domain?: string }[];
  };

  const reason  = e.errors?.[0]?.reason ?? '';
  const message = e.message ?? 'Google API error';
  const code    = typeof e.code === 'number' ? e.code : 0;

  // invalid_grant: refresh token revoked / expired — user must re-auth
  if (reason === 'invalid_grant' || message.includes('invalid_grant') || message.includes('Token has been expired')) {
    return new GoogleApiError(
      'Google authorisation expired. Please reconnect Google Calendar at /auth/google/start.',
      401,
    );
  }

  // Insufficient scope / permissions
  if (
    reason === 'insufficientPermissions' ||
    reason === 'forbidden' ||
    code === 403
  ) {
    return new GoogleApiError(
      'Insufficient Google Calendar permissions. Please reconnect and grant calendar access.',
      403,
    );
  }

  // Quota / rate limit
  if (
    reason === 'quotaExceeded' ||
    reason === 'userRateLimitExceeded' ||
    reason === 'rateLimitExceeded' ||
    code === 429
  ) {
    return new GoogleApiError('Google Calendar API rate limit exceeded. Please try again shortly.', 429);
  }

  // Generic Google API error — preserve original message for debugging
  return new GoogleApiError(`Google Calendar API error: ${message}`, 502);
}
