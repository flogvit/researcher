import { getServerContext } from '@/lib/server-context';
import { getEventBus, type BusEvent } from '@researcher/subsystems/notifications/event-bus';

/**
 * SSE stream of live draft events (Fase 4 #106).
 *
 * Emits 'event: draft\ndata: <json>' for any BusEvent of type
 * 'draft.proposal.ready' whose details.draftId matches the route param.
 * The editor opens this and reacts to new proposals without polling.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await getServerContext();
  const { id } = await params;
  const draftId = parseInt(id, 10);

  const bus = getEventBus();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: BusEvent) => {
        if (event.details.draftId !== draftId) return;
        const payload = `event: draft\ndata: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(new TextEncoder().encode(payload));
      };

      bus.on('draft.proposal.ready', send);
      // Heartbeat keeps connection alive through proxies.
      const interval = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
      }, 30_000);

      // Cleanup on close
      // @ts-expect-error — controller.signal is supported in Node-style streams
      const signal: AbortSignal | undefined = controller.signal;
      signal?.addEventListener('abort', () => {
        bus.off('draft.proposal.ready', send);
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
