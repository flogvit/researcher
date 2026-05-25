import { getDb } from '../../db/connection';
import { notificationSubscriptions } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { Logger } from '../../core/logger';
import type { ProjectConfig } from '../../config';
import { getEventBus, type BusEvent } from './event-bus';
import { evaluate } from './trigger-evaluator';
import { getChannel } from './channels';

/**
 * Wire the event bus to enabled subscriptions (Fase 3).
 *
 * On each emitted event:
 *   1. Trigger evaluator decides notify/urgency/headline/body
 *   2. For each enabled subscription, optional filter check
 *   3. Channel adapter delivers the notification
 *
 * Best-effort throughout: one bad subscription can't block the others.
 */

const log = new Logger('notifications');

export function startNotificationListener(config: ProjectConfig): void {
  const bus = getEventBus();
  bus.on('event', async (event: BusEvent) => {
    try {
      const decision = await evaluate(config, event);
      if (!decision.notify) return;

      const db = getDb();
      const subs = await db.select()
        .from(notificationSubscriptions)
        .where(eq(notificationSubscriptions.enabled, true));

      for (const sub of subs) {
        if (!passesFilter(sub.filters as Record<string, unknown> | null, event, decision)) continue;
        const channel = getChannel(sub.channel);
        if (!channel) {
          log.warn(`unknown channel: ${sub.channel}`);
          continue;
        }
        try {
          await channel.send(decision, sub.config as Record<string, unknown>);
        } catch (e) {
          log.warn(`channel ${sub.channel} failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      log.error(`event handling failed: ${e instanceof Error ? e.message : e}`);
    }
  });
  log.info('notification listener started');
}

function passesFilter(
  filter: Record<string, unknown> | null,
  event: BusEvent,
  decision: { urgency: string },
): boolean {
  if (!filter) return true;
  const minUrgency = filter.minUrgency as string | undefined;
  if (minUrgency) {
    const order = { low: 0, medium: 1, high: 2 };
    if (order[decision.urgency as keyof typeof order] < order[minUrgency as keyof typeof order]) return false;
  }
  const types = filter.eventTypes as string[] | undefined;
  if (types && !types.includes(event.type)) return false;
  const scopes = filter.scopes as string[] | undefined;
  if (scopes && event.scope && !scopes.includes(event.scope)) return false;
  return true;
}
