'use client';
import { useEffect, useState } from 'react';

interface AdminTask {
  id: number;
  agentType: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export default function QueuePage() {
  const [tasks, setTasks] = useState<AdminTask[]>([]);

  useEffect(() => {
    const load = () => fetch('/api/admin/tasks').then(r => r.json()).then(setTasks);
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h1>Admin Task Queue</h1>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>ID</th>
            <th style={{ padding: '8px' }}>Type</th>
            <th style={{ padding: '8px' }}>Status</th>
            <th style={{ padding: '8px' }}>Payload</th>
            <th style={{ padding: '8px' }}>Result</th>
            <th style={{ padding: '8px' }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(t => (
            <tr key={t.id} style={{ borderBottom: '1px solid #222' }}>
              <td style={{ padding: '8px' }}>{t.id}</td>
              <td style={{ padding: '8px', color: '#88f' }}>{t.agentType.replace('admin:', '')}</td>
              <td style={{ padding: '8px' }}>
                <span style={{ color: taskStatusColor(t.status) }}>{t.status}</span>
              </td>
              <td style={{ padding: '8px', color: '#888', fontSize: '12px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {JSON.stringify(t.payload)}
              </td>
              <td style={{ padding: '8px', color: '#888', fontSize: '12px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.error ? <span style={{ color: '#f44' }}>{t.error}</span> : t.result ? JSON.stringify(t.result) : '—'}
              </td>
              <td style={{ padding: '8px', color: '#888' }}>{new Date(t.createdAt).toLocaleString()}</td>
            </tr>
          ))}
          {tasks.length === 0 && (
            <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#666' }}>No admin tasks</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function taskStatusColor(s: string): string {
  switch (s) {
    case 'completed': return '#4f4';
    case 'in_progress': return '#ff8';
    case 'pending': return '#888';
    case 'failed': return '#f44';
    default: return '#888';
  }
}
