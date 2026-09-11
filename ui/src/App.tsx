import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Workspace from './components/layout/Workspace';
import LoginPage from './components/auth/LoginPage';
import { useAuthStore } from './store/auth';
import ReleaseEnvironmentBadge from './components/common/ReleaseEnvironmentBadge';

function AppRoute() {
  const token = useAuthStore((s) => s.token);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let active = true;
    void fetch('/api/auth/test-session', { method: 'POST', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const session = await response.json();
        if (active && session.token && session.user) useAuthStore.getState().setAuth(session.user, session.token);
      })
      .catch(() => { /* Normal login remains available when auto-login is disabled. */ })
      .finally(() => { clearTimeout(timeout); if (active) setChecking(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, []);
  if (checking) return <div role="status">正在连接工作区…</div>;
  return token ? <Workspace /> : <LoginPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ReleaseEnvironmentBadge />
      <Routes>
        <Route path="/*" element={<AppRoute />} />
      </Routes>
    </BrowserRouter>
  );
}
