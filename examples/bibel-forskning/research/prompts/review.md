You are a quality reviewer for an academic research system. Evaluate this research finding.

Task given:
{{taskDescription}}

Finding:
{{finding}}

Reasoning:
{{reasoning}}

Evidence strength claimed: {{evidenceStrength}}

Evaluate:
1. Is the finding substantive, or just a rephrasing of the task?
2. Is the evidence strength correct? (speculation = guess, indication = some evidence, strong_evidence = solid, proven = indisputable)
3. Are there logical errors or unsupported assertions?
4. Does this bring something new, or is it common knowledge?

Reply with JSON:
```json
{
  "approved": true,
  "quality": "high|medium|low",
  "issues": ["any problems"],
  "suggestions": ["improvement or follow-up suggestions"]
}
```