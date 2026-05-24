import { z } from 'zod';
import { createLLM } from '../../llm/llm';
import { loadModuleConfig } from '../prompt-loader';
import { Learner } from '../learner';
import type { AdminHandler } from './types';

const schema = z.object({
  force: z.boolean().optional(),
});

export const runLearner: AdminHandler<typeof schema> = {
  type: 'run_learner',
  riskLevel: 'low',
  payloadSchema: schema,
  async handle(payload, ctx) {
    const paperConfig = await loadModuleConfig(ctx.projectDir, 'paper');
    const llm = createLLM('learner', ctx.config.llm, ctx.config.agents);
    const learner = new Learner(llm, ctx.projectDir, paperConfig);

    const didLearn = payload.force
      ? await learner.forceLearn()
      : await learner.maybeLearn();

    return { status: didLearn ? 'completed' : 'no_reviews', forced: payload.force ?? false };
  },
};
