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
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f172a; color: #e2e8f0;
      height: 100dvh; display: grid;
      grid-template-rows: auto auto 1fr auto;
      overflow: hidden;
    }

    /* ── Header ── */
    .header {
      background: #1e293b; padding: 0.85rem 1.25rem;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid #334155;
    }
    .header h1 { font-size: 0.95rem; font-weight: 600; color: #f1f5f9; }
    .status-badge { display: flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; color: #94a3b8; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #475569; transition: background .3s; }
    .status-dot.active { background: #22c55e; animation: statusPulse 1.5s infinite; }
    @keyframes statusPulse { 0%,100%{opacity:1} 50%{opacity:.4} }

    /* ── Speaking bar ── */
    .speaking-bar {
      background: #162032; padding: 0.45rem 1.25rem;
      display: none; align-items: center; gap: 0.65rem;
      font-size: 0.78rem; color: #94a3b8;
      border-bottom: 1px solid #1e3a5f;
      min-height: 32px;
    }
    .speaking-bar.visible { display: flex; }
    .waves { display: flex; gap: 3px; align-items: center; height: 18px; }
    .waves span {
      display: block; width: 3px; border-radius: 3px;
      animation: wave .85s ease-in-out infinite;
    }
    .waves span:nth-child(1){height:5px;animation-delay:0s}
    .waves span:nth-child(2){height:11px;animation-delay:.1s}
    .waves span:nth-child(3){height:16px;animation-delay:.2s}
    .waves span:nth-child(4){height:9px;animation-delay:.3s}
    .waves span:nth-child(5){height:5px;animation-delay:.4s}
    @keyframes wave { 0%,100%{transform:scaleY(.4)} 50%{transform:scaleY(1)} }
    .waves.user span { background: #3b82f6; }
    .waves.assistant span { background: #a855f7; }

    /* ── Main layout ── */
    .main { display: grid; grid-template-columns: 1fr 300px; overflow: hidden; }
    @media (max-width: 600px) {
      .main { grid-template-columns: 1fr; grid-template-rows: 1fr 180px; }
      .meetings-panel { border-left: none; border-top: 1px solid #334155; }
    }

    /* ── Transcript ── */
    .transcript-panel { padding: 1rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.65rem; }
    .transcript-empty { color: #334155; font-size: 0.83rem; text-align: center; margin-top: 3rem; user-select: none; }
    .msg { display: flex; flex-direction: column; gap: 0.2rem; animation: fadeUp .2s ease; }
    @keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
    .msg-role { font-size: 0.68rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .msg-role.user { color: #60a5fa; }
    .msg-role.assistant { color: #c084fc; }
    .msg-text {
      padding: .55rem .85rem; border-radius: 10px;
      font-size: 0.88rem; line-height: 1.5; max-width: 88%;
    }
    .msg.user  .msg-text { align-self: flex-end; background: #1e3a5f; border-bottom-right-radius: 3px; }
    .msg.assistant .msg-text { align-self: flex-start; background: #2d1b4e; border-bottom-left-radius: 3px; }
    .msg.partial .msg-text { opacity: .55; }

    /* ── Meetings panel ── */
    .meetings-panel {
      background: #1a2744; border-left: 1px solid #334155;
      padding: 1rem; overflow-y: auto;
      display: flex; flex-direction: column; gap: .65rem;
    }
    .meetings-panel h2 { font-size: .72rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .07em; margin-bottom: .15rem; }
    .meetings-empty { color: #334155; font-size: .8rem; }

    /* ── Meeting card ── */
    .meeting-card {
      background: linear-gradient(135deg,#052e16,#0f3d2e);
      border: 1px solid #16a34a; border-radius: 10px;
      padding: .85rem; animation: slideIn .45s cubic-bezier(.34,1.56,.64,1);
    }
    @keyframes slideIn { from{opacity:0;transform:translateX(18px) scale(.95)} to{opacity:1;transform:none} }
    .mc-badge { font-size: .85rem; margin-bottom: .35rem; }
    .mc-title { font-weight: 700; font-size: .9rem; color: #f0fdf4; margin-bottom: .45rem; word-break: break-word; }
    .mc-row { font-size: .75rem; color: #86efac; margin-bottom: .18rem; display: flex; align-items: flex-start; gap: .35rem; }
    .mc-icon { flex-shrink: 0; }
    .mc-link {
      display: inline-flex; align-items: center; gap: .4rem;
      margin-top: .6rem; font-size: .75rem;
      background: #16a34a; color: white;
      padding: .32rem .7rem; border-radius: 6px;
      text-decoration: none; font-weight: 600;
      transition: background .2s;
    }
    .mc-link:hover { background: #15803d; }

    /* ── Bottom bar ── */
    .bottom-bar {
      background: #1e293b; border-top: 1px solid #334155;
      padding: .85rem 1.25rem; display: flex;
      align-items: center; justify-content: center; gap: .85rem;
    }
    .btn-start {
      background: #2563eb; color: #fff; border: none; border-radius: 50px;
      padding: .7rem 2.2rem; font-size: .95rem; cursor: pointer; font-weight: 600;
      transition: background .2s, transform .1s;
    }
    .btn-start:hover { background: #1d4ed8; }
    .btn-start:active { transform: scale(.97); }
    .btn-start:disabled { opacity: .45; cursor: not-allowed; transform: none; }
    .btn-end {
      background: #dc2626; color: #fff; border: none; border-radius: 50px;
      padding: .7rem 1.8rem; font-size: .9rem; cursor: pointer; font-weight: 600;
      display: none; transition: background .2s;
    }
    .btn-end.visible { display: block; }
    .btn-end:hover { background: #b91c1c; }
    .bottom-hint { font-size: .78rem; color: #475569; }
  </style>
</head>
<body>

  <header class="header">
    <h1>🗓 Voice Scheduling Agent</h1>
    <div class="status-badge">
      <div class="status-dot" id="statusDot"></div>
      <span id="statusText">Ready</span>
    </div>
  </header>

  <div class="speaking-bar" id="speakingBar">
    <div class="waves" id="speakingWaves">
      <span></span><span></span><span></span><span></span><span></span>
    </div>
    <span id="speakingLabel">Speaking…</span>
  </div>

  <div class="main">
    <div class="transcript-panel" id="transcriptPanel">
      <div class="transcript-empty" id="transcriptEmpty">Conversation will appear here once you start the call.</div>
    </div>

    <div class="meetings-panel">
      <h2>📅 Scheduled Meetings</h2>
      <p class="meetings-empty" id="meetingsEmpty">No meetings yet.</p>
      <div id="meetingsList"></div>
    </div>
  </div>

  <div class="bottom-bar">
    <button class="btn-start" id="startBtn">🎙 Start Voice Call</button>
    <button class="btn-end"   id="endBtn">⏹ End Call</button>
    <span class="bottom-hint" id="bottomHint"></span>
  </div>

  <script type="module">
    import Vapi from "https://esm.sh/@vapi-ai/web@2.5.2";

    const PUBLIC_KEY   = "${safePublicKey}";
    const ASSISTANT_ID = "${safeAssistantId}";
    const SESSION_ID   = "${safeSessionId}";

    const startBtn       = document.getElementById('startBtn');
    const endBtn         = document.getElementById('endBtn');
    const statusDot      = document.getElementById('statusDot');
    const statusText     = document.getElementById('statusText');
    const speakingBar    = document.getElementById('speakingBar');
    const speakingWaves  = document.getElementById('speakingWaves');
    const speakingLabel  = document.getElementById('speakingLabel');
    const transcriptPanel= document.getElementById('transcriptPanel');
    const transcriptEmpty= document.getElementById('transcriptEmpty');
    const meetingsList   = document.getElementById('meetingsList');
    const meetingsEmpty  = document.getElementById('meetingsEmpty');
    const bottomHint     = document.getElementById('bottomHint');

    const vapi = new Vapi(PUBLIC_KEY);

    // ── Transcript helpers ────────────────────────────────────────────
    let partialEl   = null;
    let partialRole = null;

    function showMsg(role, text, isPartial) {
      if (transcriptEmpty) transcriptEmpty.style.display = 'none';

      if (isPartial) {
        if (!partialEl || partialRole !== role) {
          commitPartial();
          partialEl   = makeMsgEl(role, text, true);
          partialRole = role;
          transcriptPanel.appendChild(partialEl);
        } else {
          partialEl.querySelector('.msg-text').textContent = text;
        }
      } else {
        if (partialEl && partialRole === role) {
          partialEl.querySelector('.msg-text').textContent = text;
          partialEl.classList.remove('partial');
          partialEl = null; partialRole = null;
        } else {
          commitPartial();
          transcriptPanel.appendChild(makeMsgEl(role, text, false));
        }
      }
      transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
    }

    function commitPartial() {
      if (partialEl) { partialEl.classList.remove('partial'); partialEl = null; partialRole = null; }
    }

    function makeMsgEl(role, text, isPartial) {
      const d = document.createElement('div');
      d.className = 'msg ' + role + (isPartial ? ' partial' : '');
      const label = role === 'user' ? '🎙 You' : '🤖 Assistant';
      d.innerHTML = '<div class="msg-role ' + role + '">' + label + '</div><div class="msg-text"></div>';
      d.querySelector('.msg-text').textContent = text;
      return d;
    }

    // ── Speaking indicator ────────────────────────────────────────────
    function setSpeaking(role) {
      if (!role) { speakingBar.classList.remove('visible'); return; }
      speakingBar.classList.add('visible');
      speakingWaves.className = 'waves ' + role;
      speakingLabel.textContent = role === 'user' ? 'You are speaking…' : 'Assistant is speaking…';
    }

    // ── Meeting card ─────────────────────────────────────────────────
    // Called with structured data from the backend (no regex parsing needed).
    function addEventCard({ title, startISO, timezone, htmlLink }) {
      meetingsEmpty.style.display = 'none';

      // Format datetime from ISO without Date() to avoid TZ ambiguity
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      let displayDt = startISO;
      try {
        const [dp, tp] = startISO.split('T');
        const [yr, mo, dy] = dp.split('-').map(Number);
        const [hr, mn]     = tp.split(':').map(Number);
        const ampm  = hr >= 12 ? 'PM' : 'AM';
        const hr12  = hr % 12 || 12;
        displayDt   = MONTHS[mo-1] + ' ' + dy + ', ' + yr + ' — ' + hr12 + ':' + String(mn).padStart(2,'0') + ' ' + ampm;
      } catch (_) {}

      const calLink = htmlLink || 'https://calendar.google.com';
      const card = document.createElement('div');
      card.className = 'meeting-card';
      card.innerHTML =
        '<div class="mc-badge">✅ Created</div>' +
        '<div class="mc-title">' + esc(title) + '</div>' +
        '<div class="mc-row"><span class="mc-icon">🕐</span><span>' + esc(displayDt) + '</span></div>' +
        '<div class="mc-row"><span class="mc-icon">🌍</span><span>' + esc(timezone) + '</span></div>' +
        '<a class="mc-link" href="' + esc(calLink) + '" target="_blank" rel="noopener">📅 Open in Google Calendar</a>';

      meetingsList.prepend(card);
    }

    function esc(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ── Meeting deduplication set ───────────────────────────────────────
    const processedMeetings = new Set();

    function tryAddMeetingOnce(resultStr) {
      if (!resultStr) return;
      const key = resultStr.slice(0, 120);
      if (processedMeetings.has(key)) return;
      processedMeetings.add(key);
      tryAddMeeting(resultStr);
    }

    // ── Fetch events from backend after call ends ───────────────────────
    async function loadSessionEvents() {
      try {
        const res  = await fetch('/api/session-events/' + SESSION_ID);
        const data = await res.json();
        for (const evt of (data.events ?? [])) {
          addEventCard(evt);
        }
      } catch (e) {
        console.warn('[session-events] fetch failed:', e);
      }
    }

    // ── Vapi events ───────────────────────────────────────────────────
    vapi.on('call-start', () => {
      statusDot.classList.add('active');
      statusText.textContent = 'Connected';
      bottomHint.textContent = '';
      endBtn.classList.add('visible');
      startBtn.style.display = 'none';
    });

    vapi.on('call-end', () => {
      statusDot.classList.remove('active');
      statusText.textContent = 'Call ended';
      setSpeaking(null);
      commitPartial();
      endBtn.classList.remove('visible');
      startBtn.style.display = '';
      startBtn.disabled = false;
      bottomHint.textContent = 'Call ended. You can start a new call anytime.';
      // Fetch events the backend created during this call
      loadSessionEvents();
    });

    vapi.on('speech-end', () => setSpeaking(null));

    vapi.on('message', (msg) => {
      // Log every non-transcript message for debugging
      if (msg.type !== 'transcript') {
        console.log('[vapi] message:', msg.type, JSON.stringify(msg).slice(0, 300));
      }

      if (msg.type === 'transcript') {
        const { role, transcriptType, transcript } = msg;
        setSpeaking(role);
        showMsg(role, transcript, transcriptType === 'partial');
        if (transcriptType === 'final') setSpeaking(null);
      }
    });

    vapi.on('error', (e) => {
      statusText.textContent = 'Error';
      startBtn.disabled = false;
      bottomHint.textContent = 'Connection error — please refresh.';
      console.error('[vapi] error:', JSON.stringify(e, Object.getOwnPropertyNames(e)));
    });

    // ── Button handlers ───────────────────────────────────────────────
    startBtn.addEventListener('click', async () => {
      startBtn.disabled      = true;
      statusText.textContent = 'Connecting…';

      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const nowISO   = new Date().toISOString();
      const todayISO = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(new Date());

      try {
        await vapi.start(ASSISTANT_ID, {
          metadata:       { sessionId: SESSION_ID, timezone, nowISO, todayISO },
          variableValues: { sessionId: SESSION_ID, timezone, nowISO, todayISO },
        });
      } catch (e) {
        console.error('[vapi] start() threw:', JSON.stringify(e, Object.getOwnPropertyNames(e)));
        statusText.textContent = 'Failed to connect';
        startBtn.disabled = false;
        bottomHint.textContent = 'Failed to start. Please refresh.';
      }
    });

    endBtn.addEventListener('click', () => vapi.stop());
  </script>
</body>
</html>`;
}
