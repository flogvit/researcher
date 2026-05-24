import { getDb } from '../../../db/connection';
import { documents } from '../../../db/schema';
import { sql } from 'drizzle-orm';

/**
 * Shared dedupe check for HTTP source plugins (#76).
 *
 * All 6 plugins had near-identical isDuplicate(title, url): a URL match
 * is strong evidence; a title-only match is weaker (two papers can share
 * a title in different journals/years) but still useful to avoid the
 * obvious duplicates that upstream APIs sometimes serve.
 *
 * Once issue #76's composite-key suggestion lands (title + authors + year),
 * the title branch goes away.
 */
export async function isDuplicateByTitleOrUrl(title: string, url: string | null): Promise<boolean> {
  const db = getDb();
  if (url) {
    const [dup] = await db.select({ id: documents.id })
      .from(documents).where(sql`${documents.url} = ${url}`).limit(1);
    if (dup) return true;
  }
  const [dup] = await db.select({ id: documents.id })
    .from(documents).where(sql`${documents.title} = ${title}`).limit(1);
  return !!dup;
}
