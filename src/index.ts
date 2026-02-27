import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import { logger } from './utils/logger';
import { getDb } from './db/sqlite';
import { requestLogger } from './middleware/requestLogger';

import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { sessionRouter } from './routes/session';
import { calendarRouter } from './routes/calendar';
import { debugRouter } from './routes/debug';
import { landingRouter } from './routes/landing';

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
const app = express();

app.set('trust proxy', 1);   // Required for correct IP on Railway (behind a proxy)
app.use(express.json());
app.use(requestLogger);

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------

/** Tight limit on OAuth routes — prevents token-farming / redirect abuse */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
});

/** Reasonable limit on calendar API — prevents runaway Vapi tool calls */
const calendarLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/health',  healthRouter);
app.use('/auth',    authLimiter,     authRouter);
app.use('/session', sessionRouter);
app.use('/api',     calendarLimiter, calendarRouter);
app.use('/debug',   debugRouter);   // dev only — returns 404 in production
app.use('/',        landingRouter);  // landing page — registered last, only handles GET /

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler — catches unhandled errors from async route handlers
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  logger.error({ error: message }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

// Initialise DB on startup (creates file + table if not exists)
getDb();

app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, dbPath: env.DB_PATH },
    'Voice scheduling agent server started',
  );
});

export default app;
