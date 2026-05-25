'use client';
import { useEffect, useState } from 'react';

interface Sub {
  id: number;
  channel: string;
  config: Record<string, unknown>;
  filters: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: string;
}

export default function NotificationsPage() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [channel, setChannel] = useState('desktop');
  const [configJson, setConfigJson] = useState('{}');

  const load = async () => {
    const r = await fetch('/api/notifications');
    if (r.ok) setSubs(await r.json());
  };

  useEffect(() => { void load(); }, []);

  const create = async () => {
    let config;
    try { config = JSON.parse(configJson); } catch { alert('Invalid JSON'); return; }
    const r = await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, config, enabled: true }),
    });
    if (r.ok) { setConfigJson('{}'); await load(); }
  };

  const toggle = async (id: number, enabled: boolean) => {
    await fetch(`/api/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    await load();
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this subscription?')) return;
    await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <h1>Notifications</h1>
      <p style={{ color: '#888' }}>Channels the assistant uses to reach you when something significant happens.</p>

      <section style={{ background: '#161616', padding: '16px', borderRadius: '6px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '14px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add subscription</h2>
        <select value={channel} onChange={e => setChannel(e.target.value)} style={inputStyle}>
          <option value="desktop">desktop (macOS/Linux)</option>
          <option value="email">email (SMTP)</option>
          <option value="telegram">telegram (bot)</option>
          <option value="web_push">web push (browser)</option>
        </select>
        <textarea
          value={configJson}
          onChange={e => setConfigJson(e.target.value)}
          placeholder={hintFor(channel)}
          rows={4}
          style={{ ...inputStyle, fontFamily: 'monospace' }}
        />
        <button onClick={create} style={primaryBtn}>Create</button>
      </section>

      <h2 style={{ fontSize: '14px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subscriptions</h2>
      {subs.length === 0 && <p style={{ color: '#666' }}>No subscriptions configured.</p>}
      {subs.map(s => (
        <div key={s.id} style={{ padding: '12px', background: '#161616', border: '1px solid #222', borderRadius: '6px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <strong style={{ color: '#e0e0e0' }}>{s.channel}</strong>
              <span style={{ marginLeft: '8px', color: s.enabled ? '#4f4' : '#666', fontSize: '11px' }}>
                {s.enabled ? 'ENABLED' : 'disabled'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={() => toggle(s.id, !s.enabled)} style={smallBtn}>{s.enabled ? 'Disable' : 'Enable'}</button>
              <button onClick={() => remove(s.id)} style={smallBtn}>Delete</button>
            </div>
          </div>
          <pre style={{ background: '#0a0a0a', padding: '8px', marginTop: '8px', borderRadius: '4px', fontSize: '11px', color: '#888', overflow: 'auto' }}>
{JSON.stringify(s.config, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function hintFor(channel: string): string {
  switch (channel) {
    case 'email': return '{"to":"you@example.com","from":"researcher@local","smtpUrl":"smtp://..."}';
    case 'telegram': return '{"botToken":"...","chatId":"..."}';
    case 'web_push': return '{"endpoint":"...","keys":{"p256dh":"...","auth":"..."}}';
    default: return '{}';
  }
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px', background: '#0a0a0a', border: '1px solid #333',
  borderRadius: '4px', color: '#e0e0e0', marginBottom: '8px', boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = { padding: '8px 16px', background: '#338', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' };
const smallBtn: React.CSSProperties = { padding: '4px 8px', background: 'transparent', border: '1px solid #444', borderRadius: '4px', color: '#888', cursor: 'pointer', fontSize: '11px' };
