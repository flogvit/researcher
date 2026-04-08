You have received {{count}} paper peer reviews from an autonomous research system. Analyze them for patterns.

Reviews:
{{reviews}}

Current prompts being used: {{currentPrompts}}

Look for:
1. Recurring weaknesses across papers (same issues appearing multiple times)
2. Patterns in what reviewers praise
3. Gaps in methodology or analysis that agents consistently miss
4. Whether any agent type consistently produces lower quality

For each pattern, propose a specific change:
- Which prompt file to modify (by name)
- What to change (be specific — add a rule, remove a rule, adjust criteria)
- Why this should help

You can also propose:
- A new agent to add to a step (type: add_agent)
- Changes to module config (type: modify_config)

Reply with JSON:
```json
{
  "patterns": ["pattern1", "pattern2"],
  "proposals": [
    {
      "type": "modify_prompt",
      "target": "prompt-name",
      "description": "what to change",
      "reasoning": "why this should help",
      "newContent": "the complete new prompt content"
    }
  ]
}
```
