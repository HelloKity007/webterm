import { useCallback, useState } from 'react';

function readIntent(key: string): boolean {
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}

// This is a per-browser-tab reading intent, not terminal output or server state.
export function useCliHistoryResume(terminalKey: string) {
  const key = `webterm-cli-history-reading:v1:${terminalKey}`;
  const [state, setState] = useState(() => ({ key, active: readIntent(key) }));
  const active = state.key === key ? state.active : readIntent(key);
  const setActive = useCallback((next: boolean) => {
    // Persist synchronously so a reload before React's next effect cannot lose
    // the wheel-up or resurrect a hint that was already dismissed.
    try {
      if (next) sessionStorage.setItem(key, '1');
      else sessionStorage.removeItem(key);
    } catch { /* Keep the current browser usable when storage is unavailable. */ }
    setState(previous => previous.key === key && previous.active === next ? previous : { key, active: next });
  }, [key]);
  return [active, setActive] as const;
}
