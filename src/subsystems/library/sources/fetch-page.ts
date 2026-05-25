import { Logger } from '../../../core/logger';

/**
 * Shared transient-retry wrapper for source-plugin API calls (#25).
 *
 * Each source plugin previously had `catch { break; }` pagination loops
 * that silently aborted on any error. This helper:
 *   - retries 5xx, 429, and network errors with exponential backoff
 *     (1s, 2s, 4s — 3 attempts total by default)
 *   - logs the failure with HTTP status before each retry
 *   - throws on permanent failures (4xx other than 429) so the caller
 *     can decide whether to break or skip
 */
export class TransientFetchError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'TransientFetchError';
  }
}

export class PermanentFetchError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'PermanentFetchError';
  }
}

export interface FetchWithRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  logger?: Logger;
  context?: string;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchWithRetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const logger = opts.logger;
  const context = opts.context ?? url;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;

      // 5xx + 429 are transient
      if (response.status === 429 || response.status >= 500) {
        const msg = `${context}: HTTP ${response.status} (transient)`;
        logger?.warn(msg);
        lastError = new TransientFetchError(msg, response.status);
        if (attempt < retries) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      } else {
        // 4xx other than 429 — permanent
        throw new PermanentFetchError(`${context}: HTTP ${response.status}`, response.status);
      }
    } catch (e) {
      if (e instanceof PermanentFetchError) throw e;
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      logger?.warn(`${context}: ${msg} (network error)`);
      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new TransientFetchError(`${context}: failed after ${retries + 1} attempts`);
}

/**
 * Source-API response validator (#26). Pass a guard returning true when the
 * shape is valid; throws on mismatch with a useful slice of the raw text.
 */
export function validateResponseShape<T>(
  body: unknown,
  guard: (b: unknown) => b is T,
  context: string,
  rawText?: string,
): T {
  if (!guard(body)) {
    const sample = rawText ? rawText.slice(0, 300) : JSON.stringify(body).slice(0, 300);
    throw new Error(`${context}: unexpected response shape: ${sample}`);
  }
  return body;
}
