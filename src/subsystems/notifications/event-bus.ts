import { EventEmitter } from 'node:events';

/**
 * Event bus for proactive notifications (Fase 3 #91).
 *
 * Subsystems emit structured events; the notification trigger evaluator
 * decides whether each event is worth interrupting the user with, and the
 * channel plugins (#94-#97) dispatch the resulting notifications.
 */

export type EventType =
  | 'finding.strong'        // an evidence_strength=strong_evidence finding landed
  | 'discovery.created'     // novelty-checker created a new discovery
  | 'paper.draft.ready'     // paper pipeline finished a draft
  | 'paper.approved'        // peer review approved
  | 'paper.rejected'
  | 'subsystem.failed'      // a subsystem crashed
  | 'rate_limit.hit'        // any provider hit a rate limit
  | 'draft.proposal.ready'; // Fase 4 — an auto-research proposal is queued

export interface BusEvent {
  type: EventType;
  timestamp: number;
  details: Record<string, unknown>;
  /** Optional scope (project name) for filtering. */
  scope?: string;
}

class NotificationBus extends EventEmitter {
  emitEvent(event: BusEvent): void {
    this.emit('event', event);
    this.emit(event.type, event);
  }
}

let bus: NotificationBus | null = null;

export function getEventBus(): NotificationBus {
  if (!bus) bus = new NotificationBus();
  return bus;
}

export function emitEvent(type: EventType, details: Record<string, unknown>, scope?: string): void {
  getEventBus().emitEvent({ type, timestamp: Date.now(), details, scope });
}
