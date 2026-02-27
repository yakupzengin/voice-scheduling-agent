/**
 * In-memory ring buffer for structured log lines.
 * Used only in development (NODE_ENV !== 'production') by the /debug/last-logs endpoint.
 *
 * The buffer holds the last N log lines as plain objects with secrets already
 * redacted by pino before they arrive here.
 *
 * Never instantiated in production — the export is conditional in logger.ts.
 */

const MAX_SIZE = 200;

export interface LogEntry {
  time:  number;
  level: number;
  msg:   string;
  [key: string]: unknown;
}

class RingBuffer {
  private buf: LogEntry[] = [];

  push(entry: LogEntry): void {
    if (this.buf.length >= MAX_SIZE) {
      this.buf.shift();  // drop oldest
    }
    this.buf.push(entry);
  }

  drain(): LogEntry[] {
    return [...this.buf];
  }
}

export const ringBuffer = new RingBuffer();
