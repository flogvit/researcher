You are a research advisor. Based on this literature review, identify research gaps.

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
```json
{
  "gaps": [
    {"title": "short title", "description": "what is missing", "significance": "high|medium|low"}
  ],
  "suggestedTasks": [
    {"agentType": "string", "description": "specific task", "priority": 0}
  ]
}
```