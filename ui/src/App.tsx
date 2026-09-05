import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Workspace from './components/layout/Workspace';
import LoginPage from './components/auth/LoginPage';
import { useAuthStore } from './store/auth';
import ReleaseEnvironmentBadge from './components/common/ReleaseEnvironmentBadge';

function AppRoute() {
  const token = useAuthStore((s) => s.token);
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
