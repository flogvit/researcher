'use client';
import { useState, useEffect } from 'react';

interface Session {
  id: number;
  scope: string;
  title: string | null;
  lastTurnAt: string;
}

interface Message {
  id: number;
  role: string;
  content: string;
  createdAt: string;
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [scope, setScope] = useState('global');

  const loadSessions = async () => {
    const r = await fetch('/api/chat/sessions');
    if (r.ok) setSessions(await r.json());
  };

  const loadMessages = async (id: number) => {
    const r = await fetch(`/api/chat/sessions/${id}`);
    if (r.ok) {
      const data = await r.json();
      setMessages(data.messages);
    }
  };

  useEffect(() => { void loadSessions(); }, []);

  useEffect(() => {
    if (currentSession !== null) void loadMessages(currentSession);
  }, [currentSession]);

  const newSession = async () => {
    const r = await fetch('/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    });
    if (r.ok) {
      const session = await r.json();
      await loadSessions();
      setCurrentSession(session.id);
      setMessages([]);
    }
  };

  const send = async () => {
    if (!input.trim() || currentSession === null || sending) return;
    const userMsg = input;
    setInput('');
    setSending(true);
    setMessages(prev => [...prev, {
      id: Date.now(),
      role: 'user',
      content: userMsg,
      createdAt: new Date().toISOString(),
    }]);

    try {
      const r = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSession, message: userMsg }),
      });
      if (r.ok) {
        const data = await r.json();
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          role: 'assistant',
          content: data.assistant,
          createdAt: new Date().toISOString(),
        }]);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)' }}>
      <aside style={{ width: '280px', borderRight: '1px solid #222', padding: '16px', overflow: 'auto' }}>
        <div style={{ marginBottom: '12px' }}>
          <select value={scope} onChange={e => setScope(e.target.value)} style={selectStyle}>
            <option value="global">Global</option>
          </select>
        </div>
        <button onClick={newSession} style={primaryBtnStyle}>+ New chat</button>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '16px' }}>
          {sessions.map(s => (
            <li
              key={s.id}
              onClick={() => setCurrentSession(s.id)}
              style={{
                padding: '8px',
                borderRadius: '4px',
                cursor: 'pointer',
                background: currentSession === s.id ? '#1a1a2a' : 'transparent',
                marginBottom: '4px',
              }}
            >
              <div style={{ color: '#e0e0e0' }}>{s.title ?? `Chat #${s.id}`}</div>
              <div style={{ color: '#666', fontSize: '11px' }}>{s.scope}</div>
            </li>
          ))}
          {sessions.length === 0 && (
            <li style={{ color: '#666', padding: '8px' }}>No sessions yet</li>
          )}
        </ul>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          {currentSession === null ? (
            <p style={{ color: '#666' }}>Select or create a session.</p>
          ) : messages.length === 0 ? (
            <p style={{ color: '#666' }}>Empty session — say something.</p>
          ) : (
            messages.map(m => (
              <div key={m.id} style={{ marginBottom: '16px' }}>
                <div style={{ color: m.role === 'user' ? '#88f' : '#4f4', fontSize: '12px', marginBottom: '4px' }}>
                  {m.role}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', color: '#e0e0e0' }}>{m.content}</div>
              </div>
            ))
          )}
        </div>

        <div style={{ borderTop: '1px solid #222', padding: '16px', display: 'flex', gap: '8px' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(); }}
            placeholder={currentSession === null ? 'Start a session first…' : 'Cmd-Enter to send'}
            disabled={currentSession === null || sending}
            rows={3}
            style={{
              flex: 1, padding: '8px', background: '#161616', border: '1px solid #333',
              borderRadius: '6px', color: '#e0e0e0', resize: 'vertical', fontFamily: 'inherit',
            }}
          />
          <button onClick={send} disabled={currentSession === null || sending || !input.trim()} style={primaryBtnStyle}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </main>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '6px', background: '#161616', border: '1px solid #333',
  borderRadius: '4px', color: '#e0e0e0',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 12px', background: '#338', border: 'none', borderRadius: '4px',
  color: '#fff', cursor: 'pointer',
};
