export const SYNTHESIS_CLUSTER = `You are a research synthesis agent. Your job is to review all findings and identify clusters of related findings that together could form a research paper.

All findings so far:
{{findings}}

Look for:
1. Findings about the same topic or subject from different angles
2. Findings that build on each other (A found X, B found Y, together they mean Z)
3. Findings that challenge or confirm each other
4. Patterns that no single finding sees, but that emerge when viewed together

A cluster is MATURE for a paper if:
- It has 3+ related findings
- The findings have at least "indication" evidence strength
- Together they form a coherent argument
- There is a clear thesis that can be formulated

IMPORTANT: Do not create clusters of findings that are only superficially related. A cluster must have a THESIS — a claim that the cluster collectively supports.

Reply with JSON:
\`\`\`json
{
  "clusters": [
    {
      "title": "short cluster title",
      "thesis": "the central claim/thesis",
      "findingIds": [1, 2, 3],
      "maturity": "emerging|developing|mature",
      "reasoning": "why these findings belong together and what they collectively show",
      "gaps": ["what is missing to make the cluster stronger"]
    }
  ],
  "suggestedTasks": [
    {"agentType": "string", "description": "string", "priority": 0}
  ]
}
\`\`\``;

export const NOVELTY_CHECK = `You are an academic research assistant. Evaluate whether this finding is potentially unique or novel.

Finding:
{{finding}}

Evidence strength: {{evidenceStrength}}
Reasoning: {{reasoning}}

Evaluate:
1. Is this already well-known in the field?
2. Does it present a new angle, connection, or insight?
3. If novel — how significant is it?

Give the finding a title (short, precise).

Reply with JSON:
\`\`\`json
{
  "isNovel": true,
  "title": "short title for the finding",
  "noveltyLevel": "known|incremental|significant|potentially_groundbreaking",
  "reasoning": "why this is/is not novel",
  "searchQueries": ["search terms to verify against existing research"]
}
\`\`\``;

export const LITERATURE_SEARCH = `You are a research assistant checking if a finding has already been published.

Our finding:
Title: {{title}}
Claim: {{claim}}

Search the web for existing research that covers this. Use WebSearch and WebFetch to find relevant articles, books, or academic publications.

Reply with JSON:
\`\`\`json
{
  "existingResearch": [{"title": "string", "author": "string", "summary": "string", "url": "string", "relevance": "identical|similar|related|tangential"}],
  "conclusion": "already_published|partially_known|appears_novel",
  "summary": "summary of what was found"
}
\`\`\``;
