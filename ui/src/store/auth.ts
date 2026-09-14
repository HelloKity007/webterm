import { create } from 'zustand';
import { clearLegacyRememberedPassword } from '../auth/rememberedLogin';

clearLegacyRememberedPassword();

interface User {
  id: number;
  username: string;
  role: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  logout: () => void;
}

function loadUser(): User | null {
  try {
    const saved = localStorage.getItem('webterm-user');
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: loadUser(),
  token: localStorage.getItem('token'),
  setAuth: (user, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('webterm-user', JSON.stringify(user));
    set({ user, token });
  },
  logout: () => {
    ['token', 'webterm-user', 'webterm-rm-user', 'webterm-rm-pwd'].forEach(k => localStorage.removeItem(k));
    sessionStorage.clear();
    set({ user: null, token: null });
    window.location.replace('/');
  },
}));
