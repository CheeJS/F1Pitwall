import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { ReplayDashboard } from './components/ReplayDashboard';

function Root() {
  const [hash, setHash] = useState(location.hash);

  useEffect(() => {
    const handler = () => setHash(location.hash);
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const replayMatch = hash.match(/^#\/replay\/(\d+)$/);
  if (replayMatch) {
    return <ReplayDashboard sessionKey={Number(replayMatch[1])} />;
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
