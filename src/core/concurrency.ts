/**
 * Run `fn` across `items` with at most `limit` in flight at a time (#44).
 *
 * The source plugins iterate searchTerms sequentially — for 50 terms each
 * paginating 10 pages that's hours of API time serialized when the upstream
 * APIs are independent. With limit=2-3 we cut latency to ~1/3 while staying
 * inside documented rate limits (Semantic Scholar 100 req/5min etc.).
 *
 * Returns results in input order.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit <= 1 || items.length <= 1) {
    const out: R[] = [];
    for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i));
    return out;
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}
