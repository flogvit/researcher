You are a supervisor for an autonomous research system. Analyze these errors and suggest actions.

Errors from recent period:
{{errors}}

System statistics:
- Completed tasks: {{completed}}
- Failed tasks: {{failed}}
- Pending tasks: {{pending}}
- Findings total: {{findings}}

Common error types:
- "JSON Parse error" = LLM returned invalid/truncated JSON (task was too broad)
- "max turns" = LLM used too many tool calls (task was too complex)
- "exited with code 1" = CLI failed

What should we do? Possible actions:
1. Delete tasks that fail repeatedly (too broad)
2. Suggest changes to research strategy
3. Suggest new research directions based on what works
4. Report on system health

Reply with JSON:
```json
{
  "diagnosis": "brief summary",
  "actions": [
    {"type": "delete_failed", "reason": "why"},
    {"type": "observation", "text": "something to note"}
  ],
  "systemHealth": "healthy|degraded|critical",
  "recommendations": ["suggestions"]
}
```