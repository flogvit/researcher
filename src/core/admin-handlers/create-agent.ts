import { z } from 'zod';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLLM } from '../../llm/llm';
import { atomicWrite } from '../upgrade';
import type { AdminHandler } from './types';

const schema = z.object({
  name: z.string().min(1),
  description: z.string(),
  domain: z.string(),
  language: z.string(),
});

export const createAgent: AdminHandler<typeof schema> = {
  type: 'create_agent',
  riskLevel: 'medium',
  payloadSchema: schema,
  async handle(payload, ctx) {
    const promptsDir = resolve(ctx.projectDir, 'research', 'prompts');
    mkdirSync(promptsDir, { recursive: true });

    const promptPath = resolve(promptsDir, `${payload.name}.md`);
    if (existsSync(promptPath)) {
      return { status: 'skipped', reason: 'Agent prompt already exists' };
    }

    const llm = createLLM('bootstrap', ctx.config.llm, ctx.config.agents);
    const response = await llm.call(`Create a detailed markdown prompt for a research agent named "${payload.name}".
Domain: ${payload.domain}
Language: ${payload.language}
Description: ${payload.description}

Include: role description, methods, rules for analysis, evidence strength guidelines, output format.
Write ONLY the markdown content.`);

    await atomicWrite(promptPath, response.text);

    return { status: 'created', path: promptPath, length: response.text.length };
  },
};
