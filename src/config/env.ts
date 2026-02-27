import 'dotenv/config';

// Fail fast: if any required variable is missing the process exits at startup,
// preventing silent misconfiguration in production.
function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`[env] Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const env = {
  NODE_ENV:             optional('NODE_ENV', 'development'),
  PORT:                 parseInt(optional('PORT', '3000'), 10),
  LOG_LEVEL:            optional('LOG_LEVEL', 'info'),

  // Google OAuth2
  GOOGLE_CLIENT_ID:     required('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: required('GOOGLE_CLIENT_SECRET'),
  GOOGLE_REDIRECT_URI:  required('GOOGLE_REDIRECT_URI'),  // full URL e.g. https://your-app.railway.app/auth/google/callback

  // Vapi
  // VAPI_PUBLIC_KEY  — the browser-safe public key (not the private API key).
  //                    Found in Vapi dashboard → Account → Public Key.
  // VAPI_ASSISTANT_ID — the assistant to start when the user clicks the button.
  VAPI_PUBLIC_KEY:      required('VAPI_PUBLIC_KEY'),
  VAPI_ASSISTANT_ID:    required('VAPI_ASSISTANT_ID'),

  // SQLite file path — Railway volume should set this to /data/tokens.db
  DB_PATH:              optional('DB_PATH', './tokens.db'),
} as const;
