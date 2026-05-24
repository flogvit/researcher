/**
 * Escape the SQL LIKE / ILIKE metacharacters (% _ \) so user/LLM-derived
 * strings can't bend the pattern's semantics (#28).
 *
 * The result is the literal text you wanted; wrap it in '%' if you want
 * substring match. Postgres ILIKE uses '\' as the default escape character.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, ch => '\\' + ch);
}
