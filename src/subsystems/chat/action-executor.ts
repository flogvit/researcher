import { z } from 'zod';
import { getDb } from '../../db/connection';
import { agentTasks } from '../../db/schema';
import { createLLM, LLM } from '../../llm/llm';
import { Logger } from '../../core/logger';
import { listAdminHandlers, getAdminHandler } from '../../core/admin-handlers';
import type { ProjectConfig } from '../../config';

/**
 * Brief-mode action executor (Fase 2 #88).
 *
 * When the intent router classifies a message as 'brief', this maps the
 * request to a concrete admin task via the registry's RiskLevel field (#54):
 *
 *   low    — auto-execute (the admin task is queued, runs unattended)
 *   medium — queued as 'pending' but flagged for review in the proposal UI (#89)
 *   high   — only queued after explicit user confirmation via the proposal UI
 *
 * The LLM is asked to emit a single AdminTaskProposal matching one of the
 * registry's known types, with a validated payload. We never auto-execute
 * something with risk='high'.
 */

const log = new Logger('action-executor');

const ProposalSchema = z.object({
  taskType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  rationale: z.string(),
});

export interface ActionResult {
  proposalId: number;
  taskType: string;
  riskLevel: 'low' | 'medium' | 'high';
  status: 'auto_queued' | 'pending_review' | 'requires_approval';
  rationale: string;
}

const SYSTEM_PROMPT = `You translate a user's instruction into a single admin task call.

Reply ONLY with JSON:
{"taskType": "<one of the listed types>",
 "payload": {<task-specific fields>},
 "rationale": "<one short sentence>"}

If the request cannot be safely mapped to a known task, reply with:
{"taskType": "none", "payload": {}, "rationale": "<why>"}`;

export async function executeAction(
  config: ProjectConfig,
  userMessage: string,
  scope: string,
): Promise<ActionResult | null> {
  const handlers = listAdminHandlers();
  const catalog = handlers.map(h => `- ${h.type} (risk: ${h.riskLevel})`).join('\n');

  const llm = createLLM('intent-router', config.llm, config.agents);
  let proposal;
  try {
    const response = await llm.callJSON<{ taskType: string; payload: Record<string, unknown>; rationale: string }>(
      `Available admin tasks:\n${catalog}\n\nUser instruction: ${LLM.wrapUntrusted(userMessage, 'user-message')}`,
      SYSTEM_PROMPT,
    );
    proposal = ProposalSchema.parse(response.data);
  } catch (e) {
    log.warn(`proposal extraction failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  if (proposal.taskType === 'none') {
    return null;
  }

  const handler = getAdminHandler(proposal.taskType);
  if (!handler) {
    log.warn(`unknown task type from intent: ${proposal.taskType}`);
    return null;
  }

  const parsed = handler.payloadSchema.safeParse(proposal.payload);
  if (!parsed.success) {
    log.warn(`payload invalid for ${proposal.taskType}: ${parsed.error.message}`);
    return null;
  }

  // Queue the task. For low risk, status='pending' lets the admin processor
  // pick it up immediately. For medium/high, we mark with a 'review' metadata
  // tag so the proposal queue UI (#89) surfaces it before letting it run.
  // High-risk additionally starts as status='blocked' to prevent execution
  // until explicit approval.
  const db = getDb();
  const status = handler.riskLevel === 'high' ? 'blocked' : 'pending';
  const [task] = await db.insert(agentTasks).values({
    agentType: `admin:${proposal.taskType}`,
    status,
    priority: handler.riskLevel === 'high' ? 10 : 5,
    payload: {
      ...(parsed.data as Record<string, unknown>),
      _proposal: {
        scope,
        rationale: proposal.rationale,
        autoApproved: handler.riskLevel === 'low',
      },
    },
  }).returning({ id: agentTasks.id });

  const result: ActionResult = {
    proposalId: task.id,
    taskType: proposal.taskType,
    riskLevel: handler.riskLevel,
    status: handler.riskLevel === 'low' ? 'auto_queued' :
            handler.riskLevel === 'medium' ? 'pending_review' : 'requires_approval',
    rationale: proposal.rationale,
  };

  log.info(`brief: ${proposal.taskType} (${handler.riskLevel}) → ${result.status} (task ${task.id})`);
  return result;
}

/**
 * Approve a previously-proposed high-risk task: flip 'blocked' → 'pending'
 * so the admin processor picks it up. Called by the proposal queue UI/CLI.
 */
export async function approveProposal(taskId: number): Promise<boolean> {
  const db = getDb();
  const { eq } = await import('drizzle-orm');
  const result = await db.update(agentTasks)
    .set({ status: 'pending' })
    .where(eq(agentTasks.id, taskId))
    .returning({ id: agentTasks.id });
  return result.length > 0;
}

export async function rejectProposal(taskId: number, reason?: string): Promise<boolean> {
  const db = getDb();
  const { eq } = await import('drizzle-orm');
  const result = await db.update(agentTasks)
    .set({ status: 'failed', error: reason ?? 'rejected by user' })
    .where(eq(agentTasks.id, taskId))
    .returning({ id: agentTasks.id });
  return result.length > 0;
}
