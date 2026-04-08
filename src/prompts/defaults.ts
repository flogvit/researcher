export const CLASSIFY_DOCUMENT = `You are a librarian/cataloguer for an academic research system. Classify this material.

Title: {{title}}
Type: {{contentType}}
Content (truncated):
{{content}}

Catalogue the material:
1. Write a brief summary (2-3 sentences)
2. Set tags (keywords for search)
3. Identify relevant topics (key concepts, people, places)
4. What research approaches is this relevant for?
5. Assess quality (1-5): Is this reliable academic material?
6. Is this peer-reviewed? (yes/no/unknown)
7. Source credibility: academic (university/journal), encyclopedia (reference work), popular (popular science), blog, unknown
8. Author and publication year (if identifiable)

Reply with JSON:
\`\`\`json
{
  "summary": "brief summary",
  "tags": ["tag1", "tag2"],
  "topics": ["topic1", "topic2"],
  "relevantApproaches": ["approach1", "approach2"],
  "qualityScore": 4,
  "language": "en",
  "peerReviewed": "yes|no|unknown",
  "sourceCredibility": "academic|encyclopedia|popular|blog|unknown",
  "author": "author or null",
  "publicationYear": 2020
}
\`\`\``;
