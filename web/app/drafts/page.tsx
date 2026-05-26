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

interface SkillTemplate {
  name: string;
  description: string | null;
  parameters: Array<{ name: string; label?: string; required?: boolean; default?: string }>;
  hasFilter: boolean;
}

interface Skill {
  skill: string;
  templates: SkillTemplate[];
}

export default function DraftsListPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [title, setTitle] = useState('');
  const [skill, setSkill] = useState<string>('');
  const [template, setTemplate] = useState<string>('');

  const load = async () => {
    const r = await fetch('/api/drafts');
    if (r.ok) setDrafts(await r.json());
  };

  useEffect(() => {
    void load();
    void (async () => {
      const r = await fetch('/api/skills');
      if (r.ok) {
        const data = await r.json() as { skills: Skill[] };
        setSkills(data.skills);
      }
    })();
  }, []);

  const currentSkill = skills.find(s => s.skill === skill);
  const currentTemplate = currentSkill?.templates.find(t => t.name === template);

  const create = async () => {
    if (!title.trim()) return;
    const body: Record<string, unknown> = { title };
    if (skill) body.skill = skill;
    if (template) body.template = template;
    await fetch('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setTitle('');
    setSkill('');
    setTemplate('');
    await load();
  };

  const inputStyle: React.CSSProperties = {
    padding: '8px',
    background: '#161616',
    border: '1px solid #333',
    borderRadius: '4px',
    color: '#e0e0e0',
  };

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <h1>Drafts</h1>
      <p style={{ color: '#888' }}>Living research targets. Each draft has chat, edit proposals, and an autonomous research scope.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px', padding: '16px', background: '#0f0f0f', border: '1px solid #222', borderRadius: '6px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <select
            value={skill}
            onChange={e => { setSkill(e.target.value); setTemplate(''); }}
            style={{ ...inputStyle, flex: 1 }}
          >
            <option value="">— no template —</option>
            {skills.map(s => <option key={s.skill} value={s.skill}>{s.skill}</option>)}
          </select>
          <select
            value={template}
            onChange={e => setTemplate(e.target.value)}
            disabled={!currentSkill}
            style={{ ...inputStyle, flex: 1, opacity: currentSkill ? 1 : 0.5 }}
          >
            <option value="">{currentSkill ? '— pick a template —' : ''}</option>
            {currentSkill?.templates.map(t => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        </div>
        {currentTemplate && (
          <div style={{ color: '#888', fontSize: '12px', paddingLeft: '4px' }}>
            {currentTemplate.description}
            {currentTemplate.parameters.length > 0 && (
              <span style={{ color: '#666', marginLeft: '8px' }}>
                · params: {currentTemplate.parameters.map(p => p.name).join(', ')}
              </span>
            )}
            {currentTemplate.hasFilter && (
              <span style={{ color: '#5a5', marginLeft: '8px' }}>· auto-scope</span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Draft title…"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={create}
            style={{ padding: '8px 16px', background: '#338', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}
          >
            Create
          </button>
        </div>
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
