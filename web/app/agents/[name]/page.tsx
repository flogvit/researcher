'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

export default function AgentEditPage() {
  const params = useParams();
  const name = params.name as string;
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    fetch('/api/rules').then(r => r.json()).then(data => {
      const file = data.files?.find((f: Record<string, unknown>) => f.path === `research/prompts/${name}.md`);
      if (file) {
        setContent(file.content);
        setOriginal(file.content);
      }
    });
  }, [name]);

  const save = async () => {
    setSaving(true);
    await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'modify_prompt',
        payload: { name, content },
      }),
    });
    setSaving(false);
    setOriginal(content);
    alert('Prompt update queued.');
  };

  const hasChanges = content !== original;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1>Edit: {name}</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setPreview(!preview)}
            style={{ padding: '8px 16px', background: '#222', border: '1px solid #333', borderRadius: '4px', color: '#e0e0e0', cursor: 'pointer' }}
          >
            {preview ? 'Edit' : 'Preview'}
          </button>
          <button
            onClick={save}
            disabled={saving || !hasChanges}
            style={{ padding: '8px 16px', background: hasChanges ? '#383' : '#222', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', opacity: hasChanges ? 1 : 0.5 }}
          >
            {saving ? 'Saving...' : 'Save (queued)'}
          </button>
        </div>
      </div>

      {preview ? (
        <pre style={{
          background: '#111',
          border: '1px solid #222',
          borderRadius: '8px',
          padding: '16px',
          whiteSpace: 'pre-wrap',
          fontSize: '13px',
          lineHeight: '1.6',
          minHeight: '500px',
        }}>
          {content}
        </pre>
      ) : (
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          style={{
            width: '100%',
            minHeight: '500px',
            padding: '16px',
            background: '#111',
            border: '1px solid #222',
            borderRadius: '8px',
            color: '#e0e0e0',
            fontSize: '13px',
            lineHeight: '1.6',
            fontFamily: 'monospace',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );
}
