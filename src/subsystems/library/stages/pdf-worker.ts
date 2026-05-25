/**
 * Subprocess entry-point for PDF text extraction (#46).
 *
 * pdf-parse runs synchronously and CPU-bound; on the main Bun process it
 * blocks the event loop, which also serves Next.js admin polling. Run it
 * here in a forked process via `bun src/subsystems/library/stages/pdf-worker.ts`
 * — the parent feeds base64 PDF on stdin and reads extracted text on stdout.
 *
 * The protocol is intentionally minimal: stdin is base64; stdout is the
 * extracted text (or empty on failure); exit code 0 success / 1 failure.
 */
async function main(): Promise<void> {
  const stdin = await new Response(Bun.stdin.stream()).text();
  const base64 = stdin.trim();
  if (!base64) {
    process.exit(1);
  }

  try {
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = Buffer.from(base64, 'base64');
    const result = await pdfParse(buffer);
    const text = result.text?.trim() ?? '';
    process.stdout.write(text);
    process.exit(0);
  } catch (e) {
    process.stderr.write(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

main();
