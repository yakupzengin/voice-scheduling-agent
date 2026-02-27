import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { upsertSession } from '../db/sqlite';
import { buildAuthUrl, exchangeCodeForTokens } from '../services/googleAuth';

export const authRouter = Router();

/**
 * GET /auth/google/start
 *
 * Generates a new sessionId, embeds it in the OAuth `state` parameter,
 * then redirects the browser to Google's consent screen.
 *
 * The sessionId round-trips through Google's state param so no server-side
 * session storage is needed before the callback.
 */
authRouter.get('/google/start', (req, res) => {
  const sessionId = uuidv4();

  req.log.info({ sessionId }, 'OAuth flow started');

  const authUrl = buildAuthUrl(sessionId);
  res.redirect(authUrl);
});

/**
 * GET /auth/google/callback
 *
 * Google redirects here after user grants (or denies) permission.
 * Exchanges the one-time `code` for tokens, stores only the refresh_token,
 * then redirects to the session page where the Vapi SDK is loaded.
 *
 * Query params: code (string), state (sessionId), error (on denial)
 */
authRouter.get('/google/callback', async (req, res) => {
  const { code, state: sessionId, error } = req.query as Record<string, string>;

  // User denied consent
  if (error) {
    req.log.warn({ sessionId, oauthError: error }, 'OAuth callback: user denied consent');
    return res.status(400).send('Google authorisation denied. Please try again.');
  }

  if (!code || !sessionId) {
    req.log.warn({ sessionId }, 'OAuth callback: missing code or state param');
    return res.status(400).send('Invalid OAuth callback parameters.');
  }

  try {
    // exchangeCodeForTokens handles the Google API call and returns only what we need
    const { refreshToken, expiryDate } = await exchangeCodeForTokens(code);

    // Persist only the refresh token — access token is discarded
    upsertSession(sessionId, refreshToken);

    req.log.info(
      { sessionId, expiryDate },
      'OAuth callback: tokens received and session stored',
    );

    // Redirect to the session page where the Vapi Web SDK is served
    return res.redirect(`/session/${sessionId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    req.log.error({ sessionId, error: message }, 'OAuth callback: token exchange failed');
    return res.status(500).send('Failed to complete Google authorisation. Please try again.');
  }
});
