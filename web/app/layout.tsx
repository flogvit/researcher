import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Researcher Admin',
  description: 'Autonomous AI Research System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0a0a0a', color: '#e0e0e0' }}>
        <nav style={{ background: '#111', padding: '12px 24px', borderBottom: '1px solid #222', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '18px' }}>Researcher</strong>
          <a href="/" style={{ color: '#88f', textDecoration: 'none' }}>Dashboard</a>
          <a href="/drafts" style={{ color: '#88f', textDecoration: 'none' }}>Drafts</a>
          <a href="/chat" style={{ color: '#88f', textDecoration: 'none' }}>Chat</a>
          <a href="/proposals" style={{ color: '#88f', textDecoration: 'none' }}>Proposals</a>
          <a href="/notifications" style={{ color: '#88f', textDecoration: 'none' }}>Notifications</a>
          <a href="/me" style={{ color: '#88f', textDecoration: 'none' }}>Me</a>
          <span style={{ color: '#333' }}>|</span>
          <a href="/projects" style={{ color: '#666', textDecoration: 'none' }}>Projects</a>
          <a href="/sources" style={{ color: '#666', textDecoration: 'none' }}>Sources</a>
          <a href="/agents" style={{ color: '#666', textDecoration: 'none' }}>Agents</a>
          <a href="/config" style={{ color: '#666', textDecoration: 'none' }}>Config</a>
          <a href="/pipeline" style={{ color: '#666', textDecoration: 'none' }}>Pipeline</a>
          <a href="/queue" style={{ color: '#666', textDecoration: 'none' }}>Queue</a>
        </nav>
        <main style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
