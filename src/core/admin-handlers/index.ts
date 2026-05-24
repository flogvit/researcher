import type { AdminHandler, RiskLevel } from './types';
import { createAgent } from './create-agent';
import { modifyConfig } from './modify-config';
import { modifyResearcherConfig } from './modify-researcher-config';
import { modifyPrompt } from './modify-prompt';
import { deleteAgent } from './delete-agent';
import { runLearner } from './run-learner';
import { bootstrapProjectHandler } from './bootstrap-project';

const all: AdminHandler[] = [
  createAgent,
  modifyConfig,
  modifyResearcherConfig,
  modifyPrompt,
  deleteAgent,
  runLearner,
  bootstrapProjectHandler,
];

const byType = new Map<string, AdminHandler>(all.map(h => [h.type, h]));

export function getAdminHandler(type: string): AdminHandler | undefined {
  return byType.get(type);
}

export function listAdminHandlers(): Array<{ type: string; riskLevel: RiskLevel }> {
  return all.map(h => ({ type: h.type, riskLevel: h.riskLevel }));
}

export type { AdminHandler, RiskLevel, AdminHandlerContext } from './types';
