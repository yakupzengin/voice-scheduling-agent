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
    <button id="startBtn" onclick="startCall()">Start Voice Call</button>
    <div id="status"></div>
  </div>

  <!--
    Official Vapi Web SDK loaded synchronously — exposes the global Vapi constructor.
    Must appear before the inline script so new Vapi() is always defined.
  -->
  <script src="https://cdn.vapi.ai/sdk/web.js"></script>

  <script>
    // Server-injected values — never derived from URL params on the client
    var PUBLIC_KEY   = "${safePublicKey}";
    var ASSISTANT_ID = "${safeAssistantId}";
    var SESSION_ID   = "${safeSessionId}";

    async function startCall() {
      var btn    = document.getElementById('startBtn');
      var status = document.getElementById('status');

      btn.disabled       = true;
      status.textContent = 'Connecting\u2026';

      try {
        // Vapi constructor takes the PUBLIC KEY (not the assistant ID)
        var vapi = new Vapi(PUBLIC_KEY);

        // Detect IANA timezone and forward it to the agent via call metadata.
        var browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        vapi.on('call-start', function () {
          status.textContent = 'Call started \u2014 speak now!';
        });
        vapi.on('call-end', function () {
          status.textContent = 'Call ended.';
          btn.disabled = false;
        });
        vapi.on('error', function (e) {
          status.textContent = 'Connection error. Please refresh and try again.';
          btn.disabled = false;
          console.error('Vapi error:', e);
        });

        // Use object form: assistant ID + metadata in a single config object
        vapi.start({
          assistant: ASSISTANT_ID,
          metadata: {
            sessionId: SESSION_ID,
            timezone:  browserTimezone,
          },
        });

      } catch (e) {
        status.textContent = 'Failed to start voice call. Please refresh and try again.';
        btn.disabled = false;
        console.error('Vapi init error:', e);
      }
    }
  </script>
</body>
</html>`;
}
