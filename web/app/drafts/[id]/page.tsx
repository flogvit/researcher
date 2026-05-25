'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface Proposal {
  id: number;
  kind: string;
  replacement: string;
  rationale: string | null;
  source: string | null;
  status: string;
  createdAt: string;
}

interface Draft {
  id: number;
  title: string;
  bodyMd: string;
  skill: string | null;
  template: string | null;
  proposals: Proposal[];
}

export default function DraftEditorPage() {
  const params = useParams<{ id: string }>();
  const draftId = parseInt(params.id, 10);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [body, setBody] = useState('');
  const [proposalRequest, setProposalRequest] = useState('');

  const load = async () => {
    const r = await fetch(`/api/drafts/${draftId}`);
    if (r.ok) {
      const d = await r.json();
      setDraft(d);
      setBody(d.bodyMd);
    }
  };

  useEffect(() => { void load(); }, [draftId]);

  // SSE stream for live proposals (#106)
  useEffect(() => {
    const evt = new EventSource(`/api/drafts/${draftId}/events`);
    evt.addEventListener('draft', () => { void load(); });
    return () => evt.close();
  }, [draftId]);

  const saveBody = async () => {
    await fetch(`/api/drafts/${draftId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyMd: body }),
    });
    await load();
  };

  const generate = async () => {
    if (!confirm('Generate v1 from template + relevant findings? This overwrites the current body.')) return;
    await fetch(`/api/drafts/${draftId}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await load();
  };

  const askProposal = async () => {
    if (!proposalRequest.trim()) return;
    await fetch(`/api/drafts/${draftId}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: proposalRequest }),
    });
    setProposalRequest('');
    await load();
  };

  const decide = async (pid: number, action: 'accept' | 'reject') => {
    await fetch(`/api/drafts/proposals/${pid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    await load();
  };

  if (!draft) return <p style={{ padding: '24px' }}>Loading…</p>;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)' }}>
      <main style={{ flex: 2, display: 'flex', flexDirection: 'column', borderRight: '1px solid #222' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '18px' }}>{draft.title}</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={generate} style={btn}>Generate v1</button>
            <button onClick={saveBody} style={primary}>Save</button>
          </div>
        </div>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          style={{
            flex: 1, padding: '16px', background: '#0a0a0a', border: 'none',
            color: '#e0e0e0', fontFamily: 'monospace', fontSize: '14px', resize: 'none',
          }}
        />
      </main>

      <aside style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        <h2 style={{ fontSize: '14px', color: '#aaa', textTransform: 'uppercase' }}>Ask for an edit</h2>
        <textarea
          value={proposalRequest}
          onChange={e => setProposalRequest(e.target.value)}
          placeholder="e.g. 'tighten section 2'"
          rows={3}
          style={{ width: '100%', padding: '8px', background: '#161616', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', boxSizing: 'border-box' }}
        />
        <button onClick={askProposal} style={{ ...primary, marginTop: '8px' }}>Propose edit</button>

        <h2 style={{ fontSize: '14px', color: '#aaa', textTransform: 'uppercase', marginTop: '24px' }}>Pending proposals</h2>
        {draft.proposals.length === 0 && <p style={{ color: '#666' }}>No pending proposals.</p>}
        {draft.proposals.map(p => (
          <div key={p.id} style={{ padding: '8px', background: '#161616', border: '1px solid #222', borderRadius: '6px', marginBottom: '8px' }}>
            <div style={{ color: '#888', fontSize: '11px' }}>{p.source ?? 'manual'} · {p.kind}</div>
            <div style={{ color: '#aaa', fontSize: '12px', fontStyle: 'italic', margin: '4px 0' }}>
              &ldquo;{p.rationale}&rdquo;
            </div>
            <pre style={{ background: '#0a0a0a', padding: '8px', borderRadius: '4px', fontSize: '11px', color: '#bbb', overflow: 'auto', maxHeight: '120px' }}>
{p.replacement.slice(0, 400)}
            </pre>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={() => decide(p.id, 'accept')} style={accept}>Accept</button>
              <button onClick={() => decide(p.id, 'reject')} style={reject}>Reject</button>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}

const btn: React.CSSProperties = { padding: '6px 12px', background: 'transparent', border: '1px solid #444', borderRadius: '4px', color: '#aaa', cursor: 'pointer' };
const primary: React.CSSProperties = { padding: '6px 12px', background: '#338', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' };
const accept: React.CSSProperties = { padding: '4px 8px', background: '#384', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '11px' };
const reject: React.CSSProperties = { padding: '4px 8px', background: 'transparent', border: '1px solid #844', borderRadius: '4px', color: '#f88', cursor: 'pointer', fontSize: '11px' };
