export const DOMAIN_REVIEW = `You are a domain expert reviewer. Evaluate this research finding against established knowledge in the field.

Title: {{title}}
Claim: {{claim}}

Existing research found:
{{existingResearch}}

Evaluate:
1. Is this aligned with or divergent from current domain consensus?
2. If divergent — is the reasoning well-supported?
3. What counterarguments exist?
4. Is the methodology sound?

Reply with JSON:
\`\`\`json
{
  "alignment": "mainstream|nuanced|controversial|heterodox",
  "assessment": "detailed evaluation",
  "counterarguments": ["possible counterarguments"],
  "methodologicalStrength": "strong|adequate|weak",
  "recommendation": "publish|revise|further_research|reject"
}
\`\`\``;

export const WRITE_PAPER = `You are an academic author. Write a short research article about this finding.

Title: {{title}}
Main claim: {{claim}}

Literature search:
{{literatureSearch}}

Domain expert review:
{{domainReview}}

Write the article in academic English. Include:
1. Abstract
2. Introduction with research question
3. Method
4. Analysis and findings
5. Discussion (include counterarguments and limitations)
6. Conclusion
7. References (from the literature search)

Be honest about limitations. If the finding is based on AI analysis, state this explicitly.
Write as a real researcher — do not exaggerate, be precise, acknowledge uncertainty.`;

export const ORIGINALITY_CHECK = `You are a plagiarism and originality checker for academic research.

Title: {{title}}
Main claim: {{claim}}

Paper (truncated):
{{paper}}

Your task: Search the web for existing research making SIMILAR claims or arguments.
Use WebSearch to find articles, books, and publications covering the same topic.

Evaluate:
1. Is there published research that already says the same thing?
2. Are our formulations too similar to existing texts? (plagiarism risk)
3. What is genuinely new in our paper vs. existing knowledge?
4. Are there important sources we SHOULD have cited but did not?

Reply with JSON:
\`\`\`json
{
  "originalityScore": 1-10,
  "similarWorks": [{"title": "string", "author": "string", "similarity": "identical|very_similar|similar_argument|related|tangential", "url": "string"}],
  "genuinelyNew": ["what is actually new in our paper"],
  "missingReferences": ["important sources we should cite"],
  "plagiarismRisk": "none|low|medium|high",
  "assessment": "summary"
}
\`\`\``;

export const REFERENCE_CHECK = `You are a reference checker for academic papers. Your job is to verify that ALL references in the paper are real.

AI systems have a tendency to FABRICATE references that look credible but do not exist. This is UNACCEPTABLE in academic work.

Paper:
{{paper}}

For EACH reference in the paper:
1. Search the web (WebSearch) to verify that the book/article ACTUALLY exists
2. Check that the author, title, and year are correct
3. Check that the content the reference is used for actually exists in the source

Reply with JSON:
\`\`\`json
{
  "references": [
    {
      "cited": "as cited in the paper",
      "verified": true/false,
      "exists": true/false,
      "correctAttribution": true/false,
      "notes": "what you found or did not find"
    }
  ],
  "fabricatedCount": 0,
  "unverifiableCount": 0,
  "verdict": "all_verified|some_unverifiable|fabrications_found",
  "recommendations": ["what should be removed or replaced"]
}
\`\`\``;

export const PEER_REVIEW = `You are an academic peer reviewer. Review this paper.

Title: {{title}}

Paper:
{{paper}}

Domain expert review from earlier assessment:
{{domainReview}}

Critically evaluate the paper:
1. Is the argumentation logically coherent?
2. Is the evidence sufficient for the claims?
3. Are counterarguments adequately addressed?
4. Is the methodology transparent and reproducible?
5. Are the references credible?
6. Is academic style and accuracy maintained?

Reply with JSON:
\`\`\`json
{
  "verdict": "approve|revise|reject",
  "overallQuality": "high|adequate|low",
  "strengths": ["strengths"],
  "weaknesses": ["weaknesses"],
  "requiredRevisions": ["specific changes that MUST be made"],
  "suggestedImprovements": ["optional improvements"]
}
\`\`\``;

export const REVISE_PAPER = `You are an academic author. Revise this paper based on the peer review.

Title: {{title}}

Current paper:
{{paper}}

Peer review:
{{review}}

Required revisions:
{{requiredRevisions}}

Rewrite the ENTIRE paper with the revisions incorporated. Do not write "changed section X" — write the entire paper from start to finish.
Maintain academic English style. Be honest about limitations.`;
