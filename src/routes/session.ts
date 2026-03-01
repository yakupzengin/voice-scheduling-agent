import { Router } from 'express';
import { sessionExists } from '../db/sqlite';
import { env } from '../config/env';

export const sessionRouter = Router();

/**
 * GET /session/:sessionId
 *
 * Served after successful OAuth. Renders a minimal HTML page that:
 *   1. Detects the browser's IANA timezone via Intl.DateTimeFormat
 *   2. Injects both sessionId and timezone into Vapi call metadata
 *   3. Starts the Vapi voice call on button click
 *
 * The agent receives metadata.sessionId and metadata.timezone automatically,
 * so the user never needs to type or copy either value.
 */
sessionRouter.get('/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  // Basic format guard — UUID v4 pattern
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(sessionId)) {
    req.log.warn({ sessionId }, 'Session page: invalid sessionId format');
    return res.status(400).send('Invalid session.');
  }

  // Confirm this session completed OAuth before rendering the call page
  if (!sessionExists(sessionId)) {
    req.log.warn({ sessionId }, 'Session page: sessionId not found in DB');
    return res.status(404).send(
      '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Session not found</title></head>' +
      '<body style="font-family:system-ui;text-align:center;padding:3rem">' +
      '<h2>Session not found or expired</h2>' +
      '<p>Please <a href="/auth/google/start">connect your Google Calendar</a> to start a new session.</p>' +
      '</body></html>',
    );
  }

  req.log.info({ sessionId }, 'Session page served');

  // sessionId, VAPI_PUBLIC_KEY, and VAPI_ASSISTANT_ID are server-rendered.
  // Client-side JS detects timezone and adds it to Vapi metadata automatically.
  const html = buildSessionPage(sessionId, env.VAPI_PUBLIC_KEY, env.VAPI_ASSISTANT_ID);
  return res.status(200).send(html);
});

// ---------------------------------------------------------------------------
// HTML template — intentionally minimal, no external CSS frameworks
// ---------------------------------------------------------------------------
function buildSessionPage(sessionId: string, publicKey: string, assistantId: string): string {
  // Sanitise — these values are rendered directly into JS string literals
  const safeSessionId   = sessionId.replace(/[^a-zA-Z0-9\-]/g, '');
  const safePublicKey   = publicKey.replace(/[^a-zA-Z0-9\-_.]/g, '');
  const safeAssistantId = assistantId.replace(/[^a-zA-Z0-9\-_]/g, '');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Voice Scheduling Agent</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; flex-direction: column;
           align-items: center; justify-content: center; min-height: 100vh;
           margin: 0; background: #f5f5f5; }
    .card { background: white; border-radius: 12px; padding: 2rem 3rem;
            box-shadow: 0 2px 16px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
    h1 { font-size: 1.4rem; margin-bottom: 0.5rem; }
    p  { color: #666; margin-bottom: 1.5rem; font-size: 0.95rem; }
    button { background: #2563eb; color: white; border: none; border-radius: 8px;
             padding: 0.75rem 2rem; font-size: 1rem; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    button:disabled { background: #93c5fd; cursor: not-allowed; }
    #status { margin-top: 1rem; font-size: 0.85rem; color: #555; min-height: 1.2em; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Schedule with Voice</h1>
    <p>Click below to speak with your AI scheduling assistant.</p>
    <button id="startBtn">Start Voice Call</button>
    <div id="status"></div>
  </div>

  <!--
    Vapi Web SDK loaded via ESM from esm.sh — no CDN domain required.
    type="module" defers automatically and scopes all variables locally,
    so the event listener is wired inside the module rather than via onclick.
  -->
  <script type="module">
    import Vapi from "https://esm.sh/@vapi-ai/web@2.5.2";

    // Server-injected values
    const PUBLIC_KEY   = "${safePublicKey}";
    const ASSISTANT_ID = "${safeAssistantId}";
    const SESSION_ID   = "${safeSessionId}";

    const btn    = document.getElementById('startBtn');
    const status = document.getElementById('status');

    const vapi = new Vapi(PUBLIC_KEY);

    vapi.on('call-start', () => {
      status.textContent = 'Call started \u2014 speak now!';
    });
    vapi.on('call-end', () => {
      status.textContent = 'Call ended.';
      btn.disabled = false;
    });
    vapi.on('error', (e) => {
      status.textContent = 'Connection error. Please refresh and try again.';
      btn.disabled = false;
      // Stringify fully so the validation-error detail is visible in console
      console.error('[vapi] error event:', JSON.stringify(e, Object.getOwnPropertyNames(e)));
    });

    btn.addEventListener('click', async () => {
      btn.disabled       = true;
      status.textContent = 'Connecting\u2026';

      try {
        // --- Temporal context ---
        // timezone: IANA name from the browser (e.g. "Europe/Istanbul")
        // nowISO:   UTC instant — used by the assistant for current-time awareness
        // todayISO: local calendar date YYYY-MM-DD in the user's timezone.
        //           The sv-SE locale formats dates as YYYY-MM-DD natively,
        //           avoiding manual string concatenation.
        //
        // These are passed in BOTH metadata (accessible via {{call.metadata.*}}
        // in the Vapi system prompt) AND variableValues (accessible via {{*}}
        // directly in the prompt template).
        //
        // Recommended system-prompt addition in the Vapi dashboard:
        //   "Today's date is {{todayISO}}. Current UTC time is {{nowISO}}.
        //    The user's timezone is {{timezone}}.
        //    You MUST use these values to resolve relative dates like 'today'
        //    or 'tomorrow'. Always output date as YYYY-MM-DD and time as HH:mm
        //    (24-hour) when calling the create-event tool."

        const timezone  = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const nowISO    = new Date().toISOString();
        const todayISO  = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(new Date());

        console.log('[vapi] temporal context →', { timezone, nowISO, todayISO });

        // ---------------------------------------------------------------
        // Vapi template resolution:
        //
        // Vapi replaces {{token}} in the system prompt using the
        // variableValues map, where the key must match the token text EXACTLY.
        //
        // IMPORTANT: Vapi intercepts the "metadata" namespace internally.
        // Dotted keys like "metadata.todayISO" in variableValues are NOT
        // substituted into {{metadata.todayISO}} template tokens — they are
        // silently ignored.
        //
        // The system prompt MUST use plain tokens: {{sessionId}}, {{timezone}},
        // {{todayISO}}, {{nowISO}}.  The plain keys below resolve those tokens.
        // ---------------------------------------------------------------
        await vapi.start(ASSISTANT_ID, {
          metadata: {
            sessionId: SESSION_ID,
            timezone,
            nowISO,
            todayISO,
          },
          variableValues: {
            // Plain keys — the system prompt MUST use {{sessionId}}, {{timezone}},
            // {{todayISO}}, {{nowISO}} for these to be substituted correctly.
            sessionId: SESSION_ID,
            timezone,
            nowISO,
            todayISO,
          },
        });
      } catch (e) {
        // Log the full error so the browser console shows the real cause
        console.error('[vapi] start() threw:', JSON.stringify(e, Object.getOwnPropertyNames(e)));
        status.textContent = 'Failed to start voice call. Please refresh and try again.';
        btn.disabled = false;
        console.error('Vapi init error:', e);
      }
    });
  </script>
</body>
</html>`;
}
