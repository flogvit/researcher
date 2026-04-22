'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Status {
  rateLimited: boolean;
  rateLimitWaitMs: number;
  tasks: { pending: number; inProgress: number; completed: number; failed: number };
  findings: number;
}

interface Finding {
  id: number;
  agentType: string;
  finding: string;
  evidenceStrength: string;
  createdAt: string;
}

interface SubsystemStatus {
  name: string;
  state: string;
  ready: boolean;
  stats: Record<string, number | string>;
}

export default function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [subsystems, setSubsystems] = useState<SubsystemStatus[]>([]);
  const router = useRouter();

  useEffect(() => {
    // Check if project is initialized
    fetch('/api/setup/status').then(r => r.json()).then(data => {
      if (!data.initialized) router.push('/setup');
    });

    const load = async () => {
      const [s, f, ss] = await Promise.all([
        fetch('/api/status').then(r => r.json()).catch(() => null),
        fetch('/api/findings').then(r => r.json()).catch(() => []),
        fetch('/api/subsystems').then(r => r.json()).catch(() => []),
      ]);
      if (s) setStatus(s);
      setFindings(f);
      setSubsystems(ss);
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [router]);

  if (!status) return <p>Loading...</p>;

  return (
    <div>
      <h1>Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <Card title="Findings" value={String(status.findings)} />
        <Card title="Tasks Pending" value={String(status.tasks.pending)} />
        <Card title="Tasks Completed" value={String(status.tasks.completed)} />
        <Card title="Tasks Failed" value={String(status.tasks.failed)} color={status.tasks.failed > 0 ? '#f84' : undefined} />
        {status.rateLimited && <Card title="Rate Limited" value={`${Math.ceil(status.rateLimitWaitMs / 60000)} min`} color="#f44" />}
      </div>

      <h2>Subsystems</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '12px', marginBottom: '32px' }}>
        {subsystems.map(ss => (
          <div key={ss.name} style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong>{ss.name}</strong>
              <span style={{ color: ss.state === 'running' ? '#4f4' : ss.state === 'error' ? '#f44' : '#888', fontSize: '12px' }}>
                {ss.state}
              </span>
            </div>
            {ss.state === 'stopped' ? (
              <button
                onClick={async () => {
                  await fetch(`/api/subsystems/${ss.name}/start`, { method: 'POST' });
                  const res = await fetch('/api/subsystems').then(r => r.json());
                  setSubsystems(res);
                }}
                style={{ padding: '6px 16px', background: '#383', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' }}
              >
                Start
              </button>
            ) : (
              <button
                onClick={async () => {
                  await fetch(`/api/subsystems/${ss.name}/stop`, { method: 'POST' });
                  const res = await fetch('/api/subsystems').then(r => r.json());
                  setSubsystems(res);
                }}
                style={{ padding: '6px 16px', background: '#833', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' }}
              >
                Stop
              </button>
            )}
          </div>
        ))}
      </div>

      <h2>Recent Findings</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Agent</th>
            <th style={{ padding: '8px' }}>Finding</th>
            <th style={{ padding: '8px' }}>Strength</th>
            <th style={{ padding: '8px' }}>Date</th>
          </tr>
        </thead>
        <tbody>
          {findings.slice(0, 20).map(f => (
            <tr key={f.id} style={{ borderBottom: '1px solid #222' }}>
              <td style={{ padding: '8px', color: '#88f' }}>{f.agentType}</td>
              <td style={{ padding: '8px', maxWidth: '500px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.finding}</td>
              <td style={{ padding: '8px' }}>
                <span style={{ color: strengthColor(f.evidenceStrength) }}>{f.evidenceStrength}</span>
              </td>
              <td style={{ padding: '8px', color: '#888' }}>{new Date(f.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, value, color }: { title: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '16px' }}>
      <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>{title}</div>
      <div style={{ fontSize: '24px', fontWeight: 'bold', color: color ?? '#fff' }}>{value}</div>
    </div>
  );
}

function strengthColor(s: string): string {
  switch (s) {
    case 'proven': return '#4f4';
    case 'strong_evidence': return '#8f8';
    case 'indication': return '#ff8';
    case 'speculation': return '#f84';
    default: return '#888';
  }
}
