'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Draft {
  id: number;
  title: string;
  status: string;
  skill: string | null;
  template: string | null;
  updatedAt: string;
}

export default function DraftsListPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [title, setTitle] = useState('');

  const load = async () => {
    const r = await fetch('/api/drafts');
    if (r.ok) setDrafts(await r.json());
  };

  useEffect(() => { void load(); }, []);

  const create = async () => {
    if (!title.trim()) return;
    await fetch('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    setTitle('');
    await load();
  };

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h1>Drafts</h1>
      <p style={{ color: '#888' }}>Living research targets. Each draft has chat, edit proposals, and an autonomous research scope.</p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="New draft title…"
          style={{ flex: 1, padding: '8px', background: '#161616', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0' }} />
        <button onClick={create} style={{ padding: '8px 16px', background: '#338', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}>
          Create
        </button>
      </div>

      {drafts.map(d => (
        <Link key={d.id} href={`/drafts/${d.id}`} style={{ textDecoration: 'none' }}>
          <div style={{ padding: '12px', background: '#161616', border: '1px solid #222', borderRadius: '6px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong style={{ color: '#e0e0e0' }}>{d.title}</strong>
              <span style={{ color: '#666', fontSize: '11px' }}>{d.status}</span>
            </div>
            <div style={{ color: '#666', fontSize: '11px', marginTop: '4px' }}>
              {d.skill && d.template ? `${d.skill}/${d.template} · ` : ''}{new Date(d.updatedAt).toLocaleString()}
            </div>
          </div>
        </Link>
      ))}
      {drafts.length === 0 && <p style={{ color: '#666' }}>No drafts yet. Create one above.</p>}
    </div>
  );
}
