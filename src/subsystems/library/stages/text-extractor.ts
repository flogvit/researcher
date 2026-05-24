import { getDb } from '../../../db/connection';
import { documents } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import type { ModuleConfig } from '../../../core/module-config';

const DEFAULT_MIN_CONTENT = 2000;
const DEFAULT_HTML_LIMIT = 15000;
const DEFAULT_EXTRACTOR_MODEL = process.env.OLLAMA_MODEL ?? 'gemma3:27b';

function stripHTML(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractPDF(base64Content: string): Promise<string | null> {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = Buffer.from(base64Content, 'base64');
    const result = await pdfParse(buffer);
    return result.text?.trim() || null;
  } catch {
    return null;
  }
}

async function askOllamaForLink(html: string, originalUrl: string, htmlLimit = DEFAULT_HTML_LIMIT, model = DEFAULT_EXTRACTOR_MODEL): Promise<string | null> {
  const truncatedHtml = html.slice(0, htmlLimit);
  const prompt = `This is an academic article landing page. Find the URL to the full text article (not PDF).
Look for links like "View Full Text", "Read Article", "Full Text HTML", "View Article", or similar.
The page URL is: ${originalUrl}

Return ONLY the full URL to the article text. Nothing else. If you can't find it, return "NONE".

HTML:
${truncatedHtml}`;

  try {
    const { spawnWithTimeout } = await import('../../../llm/llm');
    const { stdout, timedOut } = await spawnWithTimeout(
      ['ollama', 'run', model],
      { stdin: new Response(prompt), timeoutMs: 60_000 },
    );
    if (timedOut) return null;
    const link = stdout.trim().split('\n').pop()?.trim() ?? '';
    if (link === 'NONE' || link.length < 10 || !link.startsWith('http')) return null;
    return link;
  } catch {
    return null;
  }
}

async function fetchUrl(url: string): Promise<{ html: string; contentType: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ResearchBot/1.0 (academic research)',
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
      redirect: 'follow',
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    const html = await response.text();
    return { html, contentType };
  } catch {
    return null;
  }
}

/**
 * Process the next document waiting for text extraction.
 * Returns true if a document was processed, false if nothing to do.
 */
export async function processNext(config?: ModuleConfig): Promise<boolean> {
  const db = getDb();

  const [item] = await db
    .select({
      id: documents.id,
      url: documents.url,
      title: documents.title,
      rawContent: documents.rawContent,
      contentType: documents.contentType,
    })
    .from(documents)
    .where(eq(documents.status, 'downloaded'))
    .limit(1);

  if (!item || !item.rawContent) return false;

  try {
    let text: string | null = null;

    if (item.contentType === 'pdf') {
      text = await extractPDF(item.rawContent);
    } else {
      // HTML or text
      text = stripHTML(item.rawContent);

      // If too short, probably a landing page — try Ollama to find real link
      const minContent = config?.extractorMinContent ?? DEFAULT_MIN_CONTENT;
      if (text.length < minContent && item.url) {
        const htmlLimit = config?.extractorHtmlLimit ?? DEFAULT_HTML_LIMIT;
        const model = config?.extractorModel ?? DEFAULT_EXTRACTOR_MODEL;
        const articleLink = await askOllamaForLink(item.rawContent, item.url, htmlLimit, model);
        if (articleLink) {
          const article = await fetchUrl(articleLink);
          if (article) {
            const extracted = stripHTML(article.html);
            if (extracted.length > text.length) {
              text = extracted;
            }
          }
        }
      }
    }

    if (text && text.length > 100) {
      await db.update(documents)
        .set({
          content: text,
          status: 'extracted',
          extractedAt: new Date(),
        })
        .where(eq(documents.id, item.id));
      console.log(`  Extracted: ${item.title.slice(0, 60)} (${text.length} chars)`);
    } else {
      await db.update(documents)
        .set({ status: 'failed_extract' })
        .where(eq(documents.id, item.id));
    }
  } catch {
    await db.update(documents)
      .set({ status: 'failed_extract' })
      .where(eq(documents.id, item.id));
  }

  return true;
}
