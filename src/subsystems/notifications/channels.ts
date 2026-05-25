import { Logger } from '../../core/logger';
import type { TriggerDecision } from './trigger-evaluator';
import { safeFetch } from '../../core/safe-fetch';

/**
 * Channel adapters for proactive notifications (Fase 3 #94-#97).
 *
 * Each channel takes a TriggerDecision + its config and best-effort delivers
 * the notification. Failures are logged but don't bubble — one bad channel
 * shouldn't block the others. SafeFetch is reused for webhooks so a typo'd
 * Telegram URL can't SSRF into the admin API.
 */

const log = new Logger('channels');

export interface Channel {
  readonly kind: string;
  send(decision: TriggerDecision, config: Record<string, unknown>): Promise<void>;
}

// ─── Desktop (#97) ───────────────────────────────────────────────────────────

const desktopChannel: Channel = {
  kind: 'desktop',
  async send(d, _config) {
    // macOS osascript / Linux notify-send. Best-effort, silent if neither
    // is present. The dashboard already shows everything via SSE/polling;
    // desktop is opt-in convenience.
    const { spawnSync } = await import('node:child_process');
    const platform = process.platform;
    try {
      if (platform === 'darwin') {
        spawnSync('osascript', ['-e', `display notification "${escapeAS(d.body)}" with title "${escapeAS(d.headline)}"`]);
      } else if (platform === 'linux') {
        spawnSync('notify-send', [d.headline, d.body]);
      }
    } catch (e) {
      log.warn(`desktop notification failed: ${e instanceof Error ? e.message : e}`);
    }
  },
};

function escapeAS(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

// ─── Email (SMTP) (#95) ──────────────────────────────────────────────────────

const emailChannel: Channel = {
  kind: 'email',
  async send(d, config) {
    const to = config.to as string | undefined;
    const from = config.from as string | undefined;
    const smtpUrl = config.smtpUrl as string | undefined ?? process.env.SMTP_URL;
    if (!to || !from || !smtpUrl) {
      log.warn(`email channel missing config (to/from/smtpUrl)`);
      return;
    }
    // Lazy import nodemailer to avoid a hard dep for users who don't need email.
    // The dynamic import string is opaque to TypeScript's module resolver so
    // the build doesn't require the package to be installed.
    try {
      const dyn = (s: string): Promise<unknown> => import(s);
      const nodemailer = await dyn('nodemailer').catch(() => null);
      if (!nodemailer) {
        log.warn(`email channel: nodemailer not installed; \`bun add nodemailer\` to enable`);
        return;
      }
      const transport = (nodemailer as { createTransport: (url: string) => unknown }).createTransport(smtpUrl);
      await (transport as { sendMail: (opts: object) => Promise<unknown> }).sendMail({
        from, to,
        subject: d.headline,
        text: d.body,
      });
    } catch (e) {
      log.warn(`email send failed: ${e instanceof Error ? e.message : e}`);
    }
  },
};

// ─── Telegram (#96) ──────────────────────────────────────────────────────────

const telegramChannel: Channel = {
  kind: 'telegram',
  async send(d, config) {
    const botToken = (config.botToken as string | undefined) ?? process.env.TELEGRAM_BOT_TOKEN;
    const chatId = config.chatId as string | undefined;
    if (!botToken || !chatId) {
      log.warn(`telegram channel missing config (botToken/chatId)`);
      return;
    }
    try {
      await safeFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        maxBytes: 64 * 1024,
        timeoutMs: 10_000,
        headers: { 'Content-Type': 'application/json' },
      });
      // safeFetch is GET-only; use raw fetch for POST. The URL is fixed; no SSRF.
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `*${d.headline}*\n\n${d.body}`,
          parse_mode: 'Markdown',
        }),
      });
    } catch (e) {
      log.warn(`telegram send failed: ${e instanceof Error ? e.message : e}`);
    }
  },
};

// ─── Web Push (#94) ──────────────────────────────────────────────────────────

const webPushChannel: Channel = {
  kind: 'web_push',
  async send(d, config) {
    const endpoint = config.endpoint as string | undefined;
    const keys = config.keys as { p256dh?: string; auth?: string } | undefined;
    const vapidPublic = (config.vapidPublic as string | undefined) ?? process.env.VAPID_PUBLIC_KEY;
    const vapidPrivate = (config.vapidPrivate as string | undefined) ?? process.env.VAPID_PRIVATE_KEY;

    if (!endpoint || !keys?.p256dh || !keys?.auth || !vapidPublic || !vapidPrivate) {
      log.warn(`web_push channel missing config (endpoint/keys/vapid*)`);
      return;
    }
    try {
      // Lazy import web-push so users not using this channel don't need it.
      const dyn = (s: string): Promise<unknown> => import(s);
      const webpush = await dyn('web-push').catch(() => null);
      if (!webpush) {
        log.warn(`web_push channel: web-push not installed; \`bun add web-push\` to enable`);
        return;
      }
      const wp = webpush as {
        setVapidDetails: (s: string, pub: string, priv: string) => void;
        sendNotification: (sub: object, payload: string) => Promise<unknown>;
      };
      wp.setVapidDetails('mailto:researcher@local', vapidPublic, vapidPrivate);
      await wp.sendNotification(
        { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
        JSON.stringify({ title: d.headline, body: d.body, urgency: d.urgency }),
      );
    } catch (e) {
      log.warn(`web_push send failed: ${e instanceof Error ? e.message : e}`);
    }
  },
};

const REGISTRY: Record<string, Channel> = {
  desktop: desktopChannel,
  email: emailChannel,
  telegram: telegramChannel,
  web_push: webPushChannel,
};

export function getChannel(kind: string): Channel | undefined {
  return REGISTRY[kind];
}
