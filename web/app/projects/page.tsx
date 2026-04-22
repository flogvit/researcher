'use client';
import { useEffect, useState } from 'react';

interface Project {
  id: number;
  title: string;
  description: string | null;
  status: string;
  phase: string | null;
  findingsCount: number | null;
  paperStatus: string | null;
  createdAt: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(setProjects);
  }, []);

  const createProject = async () => {
    if (!newTitle.trim()) return;
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle, description: newDesc || undefined }),
    });
    setNewTitle('');
    setNewDesc('');
    const updated = await fetch('/api/projects').then(r => r.json());
    setProjects(updated);
  };

  return (
    <div>
      <h1>Research Projects</h1>

      <div style={{ background: '#161616', border: '1px solid #222', borderRadius: '8px', padding: '16px', marginBottom: '24px', display: 'flex', gap: '12px', alignItems: 'end' }}>
        <div style={{ flex: 1 }}>
          <input
            placeholder="Project title"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', marginBottom: '8px', boxSizing: 'border-box' }}
          />
          <input
            placeholder="Description (optional)"
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            style={{ width: '100%', padding: '8px', background: '#111', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', boxSizing: 'border-box' }}
          />
        </div>
        <button
          onClick={createProject}
          disabled={!newTitle.trim()}
          style={{ padding: '10px 16px', background: '#338', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          Create Project
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #333', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>ID</th>
            <th style={{ padding: '8px' }}>Title</th>
            <th style={{ padding: '8px' }}>Status</th>
            <th style={{ padding: '8px' }}>Phase</th>
            <th style={{ padding: '8px' }}>Findings</th>
            <th style={{ padding: '8px' }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {projects.map(p => (
            <tr key={p.id} style={{ borderBottom: '1px solid #222' }}>
              <td style={{ padding: '8px' }}>{p.id}</td>
              <td style={{ padding: '8px' }}>
                <a href={`/projects/${p.id}`} style={{ color: '#88f', textDecoration: 'none' }}>{p.title}</a>
              </td>
              <td style={{ padding: '8px' }}>
                <span style={{ color: p.status === 'active' ? '#4f4' : '#888' }}>{p.status}</span>
              </td>
              <td style={{ padding: '8px', color: '#888' }}>{p.phase ?? '—'}</td>
              <td style={{ padding: '8px' }}>{p.findingsCount ?? 0}</td>
              <td style={{ padding: '8px', color: '#888' }}>{new Date(p.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
