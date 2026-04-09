import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { ReplayDashboard } from './components/ReplayDashboard';
import { PopupTower } from './components/PopupTower';
import { PopupMap } from './components/PopupMap';
import { PopupTelemetry } from './components/PopupTelemetry';

function Root() {
  const [hash, setHash] = useState(location.hash);

  useEffect(() => {
    const handler = () => setHash(location.hash);
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const replayMatch = hash.match(/^#\/replay\/(\d+)$/);
  if (replayMatch) return <ReplayDashboard sessionKey={Number(replayMatch[1])} />;

  const towerMatch = hash.match(/^#\/popup\/tower\/(\d+)$/);
  if (towerMatch) return <PopupTower sessionKey={Number(towerMatch[1])} />;

  const mapMatch = hash.match(/^#\/popup\/map\/(\d+)$/);
  if (mapMatch) return <PopupMap sessionKey={Number(mapMatch[1])} />;

  const telemMatch = hash.match(/^#\/popup\/telem\/(\d+)$/);
  if (telemMatch) return <PopupTelemetry sessionKey={Number(telemMatch[1])} />;

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
