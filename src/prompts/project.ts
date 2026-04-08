export const LITERATURE_REVIEW = `You are a research assistant. Write a literature review for the project "{{title}}".

Available materials ({{count}} sources):
{{materials}}

Write a structured literature review that:
1. Summarizes existing research on this topic
2. Identifies main positions and debates
3. Mentions key researchers and their contributions
4. Points out disagreements and open questions

Write in academic style, max 2000 words.`;

export const IDENTIFY_GAPS = `You are a research advisor. Based on this literature review, identify research gaps.

Project: {{title}}

Literature review:
{{literatureReview}}

Identify:
1. What has NOT been researched within this topic?
2. What questions are unanswered?
3. Where is there disagreement that could be clarified with new analysis?
4. What can AI-driven analysis contribute that traditional research hasn't done?

For each gap, suggest concrete research tasks.

Reply with JSON:
\`\`\`json
{
  "gaps": [
    {"title": "short title", "description": "what is missing", "significance": "high|medium|low"}
  ],
  "suggestedTasks": [
    {"agentType": "string", "description": "specific task", "priority": 0}
  ]
}
\`\`\``;

export const PROJECT_GENERATE_TASKS = `Project: {{title}}

Identified research gaps:
{{gaps}}

Existing findings ({{findingCount}}):
{{findings}}

Generate 2-3 new research tasks that fill the gaps. Focus on what we have NOT found yet.

Reply with JSON:
\`\`\`json
{"tasks": [{"agentType": "string", "description": "specific task", "priority": 0}]}
\`\`\``;

export const WRITE_PROJECT_PAPER = `You are an academic author. Write a research article based on the project's findings.

Project: {{title}}

Literature review:
{{literatureReview}}

Identified gaps:
{{gaps}}

Our findings ({{findingCount}}):
{{findings}}

Write an academic article that includes:
1. Abstract
2. Introduction with research question
3. Literature review (brief, reference what we found)
4. Method (AI-assisted analysis)
5. Findings and analysis
6. Discussion — what is new vs. known? Limitations?
7. Conclusion
8. References (ONLY verified, do not fabricate any)

Be honest about limitations. If findings are based on AI analysis, state this explicitly.
Highlight only what are genuinely new contributions.`;
