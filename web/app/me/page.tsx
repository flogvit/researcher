'use client';
import { useEffect, useState } from 'react';

interface Conclusion {
  id: number;
  scope: string;
  topic: string;
  claim: string;
  confidence: number;
  createdAt: string;
}

export default function MePage() {
  const [byTopic, setByTopic] = useState<Record<string, Conclusion[]>>({});
  const [scope, setScope] = useState('global');

  const load = async () => {
    const r = await fetch(`/api/me?scope=${encodeURIComponent(scope)}`);
    if (r.ok) {
      const data = await r.json();
      setByTopic(data.byTopic ?? {});
    }
  };

  useEffect(() => { void load(); }, [scope]);

  const forget = async (id: number) => {
    if (!confirm('Forget this conclusion? It will be marked inactive.')) return;
    const r = await fetch('/api/me/forget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (r.ok) await load();
  };

  const topics = Object.keys(byTopic).sort();

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <h1>Om meg</h1>
      <p style={{ color: '#888' }}>What the assistant has learned about you across conversations.</p>

      <select value={scope} onChange={e => setScope(e.target.value)} style={{
        marginBottom: '16px', padding: '6px', background: '#161616', border: '1px solid #333',
        borderRadius: '4px', color: '#e0e0e0',
      }}>
        <option value="global">Global</option>
      </select>

      {topics.length === 0 && (
        <p style={{ color: '#666' }}>No conclusions yet — chat with the assistant to build a profile.</p>
      )}

      {topics.map(topic => (
        <section key={topic} style={{ marginBottom: '32px' }}>
          <h2 style={{ color: '#88f', fontSize: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {topic}
          </h2>
          {byTopic[topic].map(c => (
            <div key={c.id} style={{
              padding: '12px',
              background: '#161616',
              border: '1px solid #222',
              borderRadius: '6px',
              marginBottom: '8px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e0e0e0' }}>{c.claim}</div>
                <div style={{ color: '#666', fontSize: '11px', marginTop: '4px' }}>
                  confidence {c.confidence}/100 · {new Date(c.createdAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => forget(c.id)}
                style={{
                  padding: '4px 8px', background: 'transparent', border: '1px solid #444',
                  borderRadius: '4px', color: '#888', cursor: 'pointer', fontSize: '11px',
                }}
              >
                forget
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
