'use client';
import { useState } from 'react';
import { usePolling } from '@/lib/usePolling';

interface Proposal {
  id: number;
  agentType: string;
  status: string;
  payload: Record<string, unknown> & { _proposal?: { rationale: string; scope: string; autoApproved?: boolean } };
  createdAt: string;
}

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);

  const load = async () => {
    const r = await fetch('/api/proposals');
    if (r.ok) setProposals(await r.json());
  };

  usePolling(load, 4000);

  const act = async (id: number, action: 'approve' | 'reject', reason?: string) => {
    await fetch(`/api/proposals/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    });
    await load();
  };

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h1>Pending proposals</h1>
      <p style={{ color: '#888' }}>Brief-mode actions waiting for review. High-risk tasks are blocked until approved.</p>

      {proposals.length === 0 && (
        <p style={{ color: '#666' }}>No pending proposals.</p>
      )}

      {proposals.map(p => {
        const taskType = p.agentType.replace(/^admin:/, '');
        const proposal = p.payload._proposal;
        const blocked = p.status === 'blocked';
        return (
          <div key={p.id} style={{
            padding: '16px',
            background: '#161616',
            border: `1px solid ${blocked ? '#a44' : '#333'}`,
            borderRadius: '6px',
            marginBottom: '12px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div>
                <strong style={{ color: '#e0e0e0' }}>{taskType}</strong>
                <span style={{ marginLeft: '8px', color: blocked ? '#f88' : '#ff8', fontSize: '11px' }}>
                  {blocked ? 'BLOCKED — needs approval' : 'AUTO-QUEUED — awaiting review'}
                </span>
              </div>
              <div style={{ color: '#666', fontSize: '11px' }}>{new Date(p.createdAt).toLocaleString()}</div>
            </div>
            {proposal?.rationale && (
              <div style={{ color: '#aaa', fontSize: '13px', marginBottom: '8px', fontStyle: 'italic' }}>
                &ldquo;{proposal.rationale}&rdquo;
              </div>
            )}
            <pre style={{
              background: '#0a0a0a', padding: '8px', borderRadius: '4px', fontSize: '11px',
              color: '#888', overflow: 'auto', margin: '8px 0',
            }}>{JSON.stringify(p.payload, null, 2)}</pre>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => act(p.id, 'approve')} style={approveBtn}>Approve</button>
              <button onClick={() => act(p.id, 'reject', 'rejected via UI')} style={rejectBtn}>Reject</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const approveBtn: React.CSSProperties = { padding: '6px 12px', background: '#384', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' };
const rejectBtn: React.CSSProperties = { padding: '6px 12px', background: 'transparent', border: '1px solid #844', borderRadius: '4px', color: '#f88', cursor: 'pointer' };
