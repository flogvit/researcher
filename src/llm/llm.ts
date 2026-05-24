/**
 * Extract a JSON value from LLM output.
 *
 * Order of attempts:
 *  1. ```json ... ``` fenced block (preferred — the LLM was asked for this)
 *  2. ``` ... ``` plain fenced block
 *  3. Balanced-brace scan for first valid {...} or [...]
 *
 * The brace scanner tracks string state (with backslash escapes) so braces
 * inside JSON strings don't confuse balance counting. We try each candidate
 * with JSON.parse and keep the first one that parses; this avoids the previous
 * greedy /(\{[\s\S]*\})/ regex which matched from the first `{` to the last `}`
 * in prose and produced silent garbage. See issue #18.
 */
export function extractJSON<T>(text: string): { ok: true; data: T } | { ok: false; error: string } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    const r = tryParse<T>(fenced[1]);
    if (r.ok) return r;
  }

  for (const candidate of scanBalanced(text)) {
    const r = tryParse<T>(candidate);
    if (r.ok) return r;
  }

  return { ok: false, error: 'No valid JSON found in response' };
}

function tryParse<T>(s: string): { ok: true; data: T } | { ok: false; error: string } {
  try {
    return { ok: true, data: JSON.parse(s) as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function* scanBalanced(text: string): Generator<string> {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    const end = findMatchingClose(text, i);
    if (end > i) yield text.slice(i, end + 1);
  }
}

function findMatchingClose(text: string, start: number): number {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Rate limit detection patterns (from flogvit-coder)
const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /usage.?limit/i,
  /quota.?exceeded/i,
  /hit your limit/i,
];

function isRateLimited(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some(p => p.test(text));
}

function parseRateLimitDelay(text: string): number | null {
  const seconds = text.match(/try again in (\d+)\s*second/i);
  if (seconds) return parseInt(seconds[1]) * 1000;

  const minutes = text.match(/try again in (\d+)\s*minute/i);
  if (minutes) return parseInt(minutes[1]) * 60_000;

  const hours = text.match(/try again in (\d+)\s*hour/i);
  if (hours) return parseInt(hours[1]) * 3_600_000;

  const resetsAt = text.match(/resets? at (\d{1,2}):(\d{2})/i);
  if (resetsAt) {
    const now = new Date();
    const target = new Date();
    target.setHours(parseInt(resetsAt[1]), parseInt(resetsAt[2]), 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }

  const resetsPm = text.match(/resets?\s+(\d{1,2})(am|pm)\b/i);
  if (resetsPm) {
    let hour = parseInt(resetsPm[1]);
    if (resetsPm[2].toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (resetsPm[2].toLowerCase() === 'am' && hour === 12) hour = 0;
    const now = new Date();
    const target = new Date();
    target.setHours(hour, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }

  return null;
}

export interface LLMConfig {
  provider: 'claude' | 'ollama' | 'codex' | 'opencode';
  model?: string;
  baseUrl?: string;
  allowedTools?: string[];
  maxTurns?: number;
  /** Per-call timeout in ms. Default 5 minutes. Hung CLI no longer wedges the dispatcher (#16). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/**
 * Spawn a child process and capture stdout+stderr with a hard timeout.
 *
 * Two issues addressed:
 *  - #16: previously hung CLIs ran forever. Now the timer kills the proc
 *    and resolves with a marker so the caller can decide what to do.
 *  - #27: previously stdout was awaited before stderr, which deadlocks if
 *    the child writes >64KB to stderr before flushing stdout. Now we
 *    drain both streams concurrently via Promise.all.
 */
export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export async function spawnWithTimeout(
  cmd: string[],
  opts: { stdin?: Response; timeoutMs?: number },
): Promise<SpawnResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const proc = Bun.spawn(cmd, {
    stdin: opts.stdin,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill(); } catch { /* already gone */ }
  }, timeoutMs);

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

export type LLMProvider = 'claude' | 'ollama' | 'codex' | 'opencode';

export function createLLM(
  agentName: string,
  globalConfig: LLMConfig,
  agents?: Record<string, Partial<LLMConfig>>,
): LLM {
  const agentOverride = agents?.[agentName] ?? {};
  return new LLM({
    provider: agentOverride.provider ?? globalConfig.provider,
    model: agentOverride.model ?? globalConfig.model,
    baseUrl: agentOverride.baseUrl ?? globalConfig.baseUrl,
    allowedTools: agentOverride.allowedTools ?? globalConfig.allowedTools,
    maxTurns: agentOverride.maxTurns ?? globalConfig.maxTurns,
  });
}

export interface LLMResponse {
  text: string;
  tokensUsed: number;
  model: string;
}

export class RateLimitError extends Error {
  readonly waitMs: number;
  constructor(message: string, waitMs: number) {
    super(message);
    this.name = 'RateLimitError';
    this.waitMs = waitMs;
  }
}

export class LLM {
  readonly provider: string;
  readonly model: string;
  private baseUrl: string;
  private allowedTools: string[];
  private maxTurns: number;
  private timeoutMs: number;

  // Shared rate limit state — when one call hits limit, all pause
  private static rateLimitedUntil = 0;

  static isCurrentlyRateLimited(): boolean {
    return Date.now() < LLM.rateLimitedUntil;
  }

  static getRateLimitWaitMs(): number {
    return Math.max(0, LLM.rateLimitedUntil - Date.now());
  }

  private ollamaReady = false;

  constructor(config: LLMConfig) {
    this.provider = config.provider;
    const defaultModels: Record<string, string> = {
      claude: 'sonnet', codex: 'codex', opencode: 'opencode', ollama: 'qwen3.5:32b',
    };
    this.model = config.model ?? defaultModels[config.provider] ?? 'sonnet';
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
    this.allowedTools = config.allowedTools ?? [];
    this.maxTurns = config.maxTurns ?? 25;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async call(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    // Wait if rate limited
    if (LLM.isCurrentlyRateLimited()) {
      const waitMs = LLM.getRateLimitWaitMs();
      throw new RateLimitError(`Rate limited. Waiting ${Math.ceil(waitMs / 60_000)} minutes.`, waitMs);
    }

    switch (this.provider) {
      case 'claude': return this.callClaude(prompt, systemPrompt);
      case 'codex': return this.callCodex(prompt, systemPrompt);
      case 'opencode': return this.callOpenCode(prompt, systemPrompt);
      default: return this.callOllama(prompt, systemPrompt);
    }
  }

  async callJSON<T>(prompt: string, systemPrompt?: string): Promise<{ data: T } & LLMResponse> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.call(
        attempt === 0 ? prompt : `${prompt}\n\nIMPORTANT: Reply ONLY with valid JSON in a json code block. No other text.`,
        systemPrompt,
      );

      const parsed = extractJSON<T>(response.text);
      if (parsed.ok) return { ...response, data: parsed.data };

      if (attempt === 0) continue;
      throw new Error(`${parsed.error}: ${response.text.slice(0, 200)}`);
    }
    throw new Error('Failed to get valid JSON after 2 attempts');
  }

  private async callClaude(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const args: string[] = [
      '-p',
      '--output-format', 'text',
      '--model', this.model,
      '--max-turns', String(this.maxTurns),
      '--dangerously-skip-permissions',
    ];

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    if (this.allowedTools.length > 0) {
      args.push('--allowedTools', this.allowedTools.join(','));
    }

    const { stdout, stderr, exitCode, timedOut } = await spawnWithTimeout(
      ['claude', ...args],
      { stdin: new Response(prompt), timeoutMs: this.timeoutMs },
    );

    if (timedOut) {
      throw new Error(`claude timed out after ${this.timeoutMs}ms`);
    }

    const combined = `${stdout}\n${stderr}`;

    if (exitCode !== 0 && isRateLimited(combined)) {
      const delayMs = parseRateLimitDelay(combined) ?? 5 * 60_000;
      LLM.rateLimitedUntil = Date.now() + delayMs;
      const delayMin = Math.ceil(delayMs / 60_000);
      console.error(`Rate limited! Pausing all Claude calls for ${delayMin} minutes.`);
      console.error(`   Raw output: ${combined.slice(0, 300)}`);
      throw new RateLimitError(`Rate limited. Waiting ${delayMin} minutes.`, delayMs);
    }

    if (exitCode !== 0) {
      const errMsg = stderr.trim() || stdout.trim();
      throw new Error(`claude exited with code ${exitCode}: ${errMsg.slice(0, 500)}`);
    }

    return { text: stdout.trim(), tokensUsed: 0, model: this.model };
  }

  private async callCodex(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const args: string[] = ['exec', '-m', this.model];
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    const { stdout, stderr, exitCode, timedOut } = await spawnWithTimeout(
      ['codex', ...args],
      { stdin: new Response(prompt), timeoutMs: this.timeoutMs },
    );

    if (timedOut) {
      throw new Error(`codex timed out after ${this.timeoutMs}ms`);
    }

    const combined = `${stdout}\n${stderr}`;

    if (exitCode !== 0 && isRateLimited(combined)) {
      const delayMs = parseRateLimitDelay(combined) ?? 5 * 60_000;
      LLM.rateLimitedUntil = Date.now() + delayMs;
      throw new RateLimitError(`Rate limited. Waiting ${Math.ceil(delayMs / 60_000)} minutes.`, delayMs);
    }

    if (exitCode !== 0) {
      throw new Error(`codex exited with code ${exitCode}: ${(stderr.trim() || stdout.trim()).slice(0, 500)}`);
    }

    return { text: stdout.trim(), tokensUsed: 0, model: this.model };
  }

  private async callOpenCode(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const args: string[] = ['run', '-m', this.model];

    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    args.push(fullPrompt);

    const { stdout, stderr, exitCode, timedOut } = await spawnWithTimeout(
      ['opencode', ...args],
      { timeoutMs: this.timeoutMs },
    );

    if (timedOut) {
      throw new Error(`opencode timed out after ${this.timeoutMs}ms`);
    }

    const combined = `${stdout}\n${stderr}`;

    if (exitCode !== 0 && isRateLimited(combined)) {
      const delayMs = parseRateLimitDelay(combined) ?? 5 * 60_000;
      LLM.rateLimitedUntil = Date.now() + delayMs;
      throw new RateLimitError(`Rate limited. Waiting ${Math.ceil(delayMs / 60_000)} minutes.`, delayMs);
    }

    if (exitCode !== 0) {
      throw new Error(`opencode exited with code ${exitCode}: ${(stderr.trim() || stdout.trim()).slice(0, 500)}`);
    }

    return { text: stdout.trim(), tokensUsed: 0, model: this.model };
  }

  private async callOllama(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    if (!this.ollamaReady) {
      const { ensureOllamaRunning, ensureModel } = await import('./ollama-manager');
      await ensureOllamaRunning(this.baseUrl);
      await ensureModel(this.model, this.baseUrl);
      this.ollamaReady = true;
    }

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${await response.text()}`);
    }

    const result = await response.json() as {
      message: { content: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      text: result.message.content,
      tokensUsed: (result.eval_count ?? 0) + (result.prompt_eval_count ?? 0),
      model: this.model,
    };
  }

  static formatPrompt(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return vars[key] ?? match;
    });
  }
}
