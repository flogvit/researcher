import type { z } from 'zod';
import type { ProjectConfig } from '../../config';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface AdminHandlerContext {
  config: ProjectConfig;
  projectDir: string;
}

/**
 * An admin task handler.
 *
 * - `type` is the part after the `admin:` prefix on agentTasks.agentType
 * - `payloadSchema` validates payload shape at runtime (no more unchecked casts)
 * - `riskLevel` will gate Fase 2's brief-mode approval flow:
 *     low    = auto-approved (pure reads, idempotent writes to safe paths)
 *     medium = approved by default, surfaced in the audit log
 *     high   = requires explicit user approval (writes outside the project,
 *              external API mutations, anything that changes LLM tool surface)
 *
 * Each handler owns its own validation and risk classification; adding a new
 * admin task is a single-file change rather than the 5-site edit it was before.
 */
export interface AdminHandler<S extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly type: string;
  readonly riskLevel: RiskLevel;
  readonly payloadSchema: S;
  handle(payload: z.infer<S>, ctx: AdminHandlerContext): Promise<Record<string, unknown>>;
}
