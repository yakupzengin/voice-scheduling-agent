import { Router } from 'express';

export const landingRouter = Router();

/**
 * GET /
 * Public SaaS landing page — no authentication required.
 * CTA redirects to /auth/google/start.
 * All CSS is embedded; zero external dependencies beyond Google Fonts.
 */
landingRouter.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.status(200).send(getLandingHtml());
});

// ---------------------------------------------------------------------------
// HTML — built as a plain string to avoid backtick/interpolation conflicts
// ---------------------------------------------------------------------------
function getLandingHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="AI-powered voice scheduling agent integrated with Google Calendar." />
  <title>VoiceSchedule &mdash; AI Meeting Scheduler</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:      #0f172a;
      --purple:  #8b5cf6;
      --indigo:  #6366f1;
      --blue:    #3b82f6;
      --text:    #f1f5f9;
      --muted:   #94a3b8;
      --border:  rgba(255,255,255,0.07);
      --glass:   rgba(255,255,255,0.03);
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      overflow-x: hidden;
      min-height: 100vh;
    }

    /* ------------------------------------------------------------------ */
    /* Animated background                                                  */
    /* ------------------------------------------------------------------ */
    .bg-layer {
      position: fixed;
      inset: 0;
      z-index: 0;
      background: linear-gradient(135deg, #0f172a 0%, #1a0a2e 40%, #0a1628 70%, #0f172a 100%);
      background-size: 400% 400%;
      animation: gradShift 22s ease infinite;
    }

    @keyframes gradShift {
      0%   { background-position: 0% 50%;   }
      50%  { background-position: 100% 50%; }
      100% { background-position: 0% 50%;   }
    }

    /* ------------------------------------------------------------------ */
    /* Floating blurred blobs                                               */
    /* ------------------------------------------------------------------ */
    .blob {
      position: fixed;
      border-radius: 50%;
      filter: blur(90px);
      opacity: 0.16;
      z-index: 0;
    }
    .blob-1 {
      width: 640px; height: 640px;
      background: radial-gradient(circle, var(--purple), transparent 70%);
      top: -220px; left: -220px;
      animation: floatA 20s ease-in-out infinite;
    }
    .blob-2 {
      width: 560px; height: 560px;
      background: radial-gradient(circle, var(--blue), transparent 70%);
      bottom: -180px; right: -180px;
      animation: floatB 24s ease-in-out infinite;
    }
    .blob-3 {
      width: 420px; height: 420px;
      background: radial-gradient(circle, var(--indigo), transparent 70%);
      top: 45%; left: 50%;
      animation: floatC 18s ease-in-out infinite;
    }

    @keyframes floatA {
      0%, 100% { transform: translate(0, 0);        }
      33%       { transform: translate(40px, -40px); }
      66%       { transform: translate(-25px, 25px); }
    }
    @keyframes floatB {
      0%, 100% { transform: translate(0, 0);         }
      33%       { transform: translate(-35px, 35px); }
      66%       { transform: translate(20px, -20px); }
    }
    @keyframes floatC {
      0%, 100% { transform: translate(-50%, -50%);              }
      33%       { transform: translate(calc(-50% + 30px), calc(-50% - 30px)); }
      66%       { transform: translate(calc(-50% - 20px), calc(-50% + 20px)); }
    }

    /* ------------------------------------------------------------------ */
    /* Layout                                                               */
    /* ------------------------------------------------------------------ */
    .content { position: relative; z-index: 1; }
    .container { max-width: 1100px; margin: 0 auto; padding: 0 2rem; }

    /* ------------------------------------------------------------------ */
    /* Navigation                                                           */
    /* ------------------------------------------------------------------ */
    nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.4rem 2rem;
      max-width: 1100px;
      margin: 0 auto;
    }

    .logo {
      font-size: 1.1rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, #c4b5fd 0%, #818cf8 50%, #60a5fa 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .live-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--border);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      padding: 0.4rem 1rem;
      border-radius: 999px;
      font-size: 0.73rem;
      color: var(--muted);
      letter-spacing: 0.01em;
    }

    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
      animation: pulseDot 2.2s ease-in-out infinite;
    }

    @keyframes pulseDot {
      0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.7); }
      50%       { box-shadow: 0 0 0 6px rgba(34,197,94,0);  }
    }

    /* ------------------------------------------------------------------ */
    /* Hero                                                                 */
    /* ------------------------------------------------------------------ */
    .hero {
      padding: 5rem 2rem 7rem;
      text-align: center;
      max-width: 1100px;
      margin: 0 auto;
    }

    .powered-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      background: rgba(99,102,241,0.1);
      border: 1px solid rgba(99,102,241,0.28);
      padding: 0.45rem 1.1rem;
      border-radius: 999px;
      font-size: 0.75rem;
      color: #a5b4fc;
      margin-bottom: 2.2rem;
      letter-spacing: 0.04em;
      font-weight: 500;
    }

    .badge-star { opacity: 0.7; }

    .hero h1 {
      font-size: clamp(2.6rem, 6.5vw, 4.4rem);
      font-weight: 800;
      line-height: 1.08;
      letter-spacing: -0.035em;
      margin-bottom: 1.5rem;
      background: linear-gradient(150deg, #f1f5f9 20%, #c4b5fd 55%, #818cf8 80%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-sub {
      font-size: 1.15rem;
      color: var(--muted);
      max-width: 520px;
      margin: 0 auto 2.8rem;
      line-height: 1.75;
      font-weight: 400;
    }

    /* ------------------------------------------------------------------ */
    /* CTA Button                                                           */
    /* ------------------------------------------------------------------ */
    .btn-primary {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.65rem;
      background: linear-gradient(135deg, #7c3aed, #6366f1, #3b82f6);
      background-size: 200% 200%;
      background-position: left center;
      color: #fff;
      font-family: inherit;
      font-size: 1.02rem;
      font-weight: 600;
      padding: 0.92rem 2.4rem;
      border-radius: 14px;
      border: none;
      cursor: pointer;
      letter-spacing: 0.01em;
      transition: transform 0.22s ease, box-shadow 0.22s ease, background-position 0.5s ease;
      box-shadow: 0 4px 28px rgba(99,102,241,0.38), 0 1px 0 rgba(255,255,255,0.12) inset;
    }

    .btn-primary:hover {
      transform: translateY(-3px) scale(1.03);
      box-shadow: 0 10px 44px rgba(99,102,241,0.58), 0 1px 0 rgba(255,255,255,0.12) inset;
      background-position: right center;
    }

    .btn-primary:active {
      transform: translateY(0) scale(0.98);
      box-shadow: 0 2px 12px rgba(99,102,241,0.3);
    }

    .btn-arrow {
      display: inline-block;
      font-size: 1.1rem;
      line-height: 1;
      transition: transform 0.22s ease;
    }

    .btn-primary:hover .btn-arrow { transform: translateX(4px); }

    .cta-meta {
      margin-top: 1.1rem;
      font-size: 0.77rem;
      color: #334155;
      letter-spacing: 0.06em;
    }

    .cta-meta .sep { margin: 0 0.4rem; color: #1e293b; }

    /* ------------------------------------------------------------------ */
    /* Features section                                                     */
    /* ------------------------------------------------------------------ */
    .features {
      padding: 2rem 2rem 6rem;
      max-width: 1100px;
      margin: 0 auto;
    }

    .eyebrow {
      text-align: center;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: #6366f1;
      font-weight: 600;
      margin-bottom: 0.7rem;
    }

    .section-title {
      text-align: center;
      font-size: clamp(1.6rem, 3vw, 2.2rem);
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--text);
      margin-bottom: 3.2rem;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
      gap: 1.5rem;
    }

    .card {
      background: var(--glass);
      border: 1px solid var(--border);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 18px;
      padding: 2rem 1.75rem;
      transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.28s ease;
    }

    .card:hover {
      transform: translateY(-6px);
      box-shadow: 0 20px 52px rgba(99,102,241,0.13);
      border-color: rgba(99,102,241,0.25);
    }

    .card-icon {
      width: 46px;
      height: 46px;
      border-radius: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.35rem;
      margin-bottom: 1.3rem;
    }

    .icon-purple { background: rgba(139,92,246,0.14); }
    .icon-blue   { background: rgba(59,130,246,0.14); }
    .icon-green  { background: rgba(34,197,94,0.11);  }

    .card h3 {
      font-size: 1rem;
      font-weight: 650;
      margin-bottom: 0.6rem;
      color: var(--text);
      letter-spacing: -0.01em;
    }

    .card p {
      font-size: 0.89rem;
      color: var(--muted);
      line-height: 1.68;
    }

    /* ------------------------------------------------------------------ */
    /* Divider + Footer                                                     */
    /* ------------------------------------------------------------------ */
    .divider {
      max-width: 1100px;
      margin: 0 auto 0;
      padding: 0 2rem;
      border: none;
      border-top: 1px solid var(--border);
    }

    footer {
      max-width: 1100px;
      margin: 0 auto;
      padding: 1.8rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.75rem;
      font-size: 0.8rem;
      color: #334155;
    }

    footer a {
      color: #4f46e5;
      text-decoration: none;
      transition: color 0.18s;
    }

    footer a:hover { color: #a5b4fc; }

    /* ------------------------------------------------------------------ */
    /* Scroll fade-in                                                       */
    /* ------------------------------------------------------------------ */
    .fade-in {
      opacity: 0;
      transform: translateY(30px);
      transition: opacity 0.6s ease, transform 0.6s ease;
    }

    .fade-in.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .delay-1 { transition-delay: 0.08s; }
    .delay-2 { transition-delay: 0.17s; }
    .delay-3 { transition-delay: 0.26s; }

    /* ------------------------------------------------------------------ */
    /* Responsive                                                           */
    /* ------------------------------------------------------------------ */
    @media (max-width: 600px) {
      nav { padding: 1rem 1.25rem; }
      .live-badge { display: none; }
      .hero { padding: 3.5rem 1.25rem 5rem; }
      .features { padding: 1.5rem 1.25rem 4rem; }
      footer { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>

  <!-- Animated background layers -->
  <div class="bg-layer" aria-hidden="true"></div>
  <div class="blob blob-1" aria-hidden="true"></div>
  <div class="blob blob-2" aria-hidden="true"></div>
  <div class="blob blob-3" aria-hidden="true"></div>

  <div class="content">

    <!-- Navigation -->
    <nav aria-label="Main navigation">
      <span class="logo">VoiceSchedule</span>
      <div class="live-badge" role="status" aria-label="Service status: live">
        <span class="pulse-dot" aria-hidden="true"></span>
        Powered by GPT-4o &amp; Google Calendar
      </div>
    </nav>

    <!-- Hero -->
    <section class="hero" aria-labelledby="hero-heading">
      <div class="powered-badge fade-in" aria-label="Product badge">
        <span class="badge-star" aria-hidden="true">&#10022;</span>
        AI-Powered Voice Scheduling
        <span class="badge-star" aria-hidden="true">&#10022;</span>
      </div>

      <h1 id="hero-heading" class="fade-in delay-1">
        Schedule Meetings<br />Using Your Voice
      </h1>

      <p class="hero-sub fade-in delay-2">
        AI-powered voice assistant integrated securely with Google&nbsp;Calendar.
        Speak naturally &mdash; your calendar handles the&nbsp;rest.
      </p>

      <div class="fade-in delay-3">
        <button class="btn-primary" onclick="handleStart()" type="button">
          Start Voice Scheduling
          <span class="btn-arrow" aria-hidden="true">&#8594;</span>
        </button>
        <p class="cta-meta">
          Secure OAuth
          <span class="sep" aria-hidden="true">&bull;</span>
          Real-time AI
          <span class="sep" aria-hidden="true">&bull;</span>
          Production-ready
        </p>
      </div>
    </section>

    <!-- Features -->
    <section class="features" aria-labelledby="features-heading">
      <p class="eyebrow">What it does</p>
      <h2 id="features-heading" class="section-title fade-in">
        Everything you need, nothing you don&apos;t
      </h2>

      <div class="cards" role="list">

        <article class="card fade-in delay-1" role="listitem">
          <div class="card-icon icon-purple" aria-hidden="true">&#128274;</div>
          <h3>Secure Google OAuth</h3>
          <p>
            Full OAuth 2.0 with offline access. Only a refresh token is stored &mdash;
            never your credentials or access tokens. Sessions are isolated per user.
          </p>
        </article>

        <article class="card fade-in delay-2" role="listitem">
          <div class="card-icon icon-blue" aria-hidden="true">&#127908;</div>
          <h3>Real-time Voice Scheduling</h3>
          <p>
            Powered by Vapi and GPT-4o-mini. Speak naturally, confirm details,
            and your event appears on Google Calendar instantly.
          </p>
        </article>

        <article class="card fade-in delay-3" role="listitem">
          <div class="card-icon icon-green" aria-hidden="true">&#127758;</div>
          <h3>Timezone &amp; DST Handling</h3>
          <p>
            Your browser timezone is auto-detected and passed directly to the AI.
            Google Calendar receives IANA zone codes &mdash; DST handled correctly every time.
          </p>
        </article>

      </div>
    </section>

    <hr class="divider" aria-hidden="true" />

    <!-- Footer -->
    <footer>
      <span>&copy; 2026 VoiceSchedule. Built for production.</span>
      <a href="https://github.com" target="_blank" rel="noopener noreferrer">
        GitHub &#8599;
      </a>
    </footer>

  </div><!-- /.content -->

  <script>
    // Fade-in on scroll using IntersectionObserver
    (function () {
      var items = document.querySelectorAll('.fade-in');
      if (!('IntersectionObserver' in window)) {
        // Graceful fallback for old browsers
        items.forEach(function (el) { el.classList.add('visible'); });
        return;
      }
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('visible');
              io.unobserve(entry.target); // fire once only
            }
          });
        },
        { threshold: 0.12 }
      );
      items.forEach(function (el) { io.observe(el); });
    })();

    // CTA button handler
    function handleStart() {
      window.location.href = '/auth/google/start';
    }
  </script>
</body>
</html>`;
}
