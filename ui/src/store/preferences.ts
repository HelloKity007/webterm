import { create } from 'zustand';

export interface OneKeyEntry { k: string; u: string; v: string; }

export interface HighlightRule {
  keyword: string;
  color: string;
  regex: boolean;
}

function parseOnekey(raw: string): OneKeyEntry[] {
  try { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; } catch { /* use legacy parser */ }
  // Legacy format: key=username:password per line
  return raw.split('\n').filter(Boolean).map((line) => {
    const eq = line.indexOf('=');
    const k = eq >= 0 ? line.substring(0, eq).trim() : '';
    const v = eq >= 0 ? line.substring(eq + 1).trim() : line.trim();
    const colon = v.indexOf(':');
    return { k, u: colon >= 0 ? v.substring(0, colon).trim() : '', v: colon >= 0 ? v.substring(colon + 1).trim() : v };
  });
}

function formatOnekey(list: OneKeyEntry[]): string {
  return JSON.stringify(list);
}

const DEFAULT_HIGHLIGHT_RULES: HighlightRule[] = [
  { keyword: 'ERROR', color: '#f44747', regex: false },
  { keyword: 'WARN', color: '#cca700', regex: false },
  { keyword: 'DEBUG', color: '#808080', regex: false },
  { keyword: 'INFO', color: '#6a9955', regex: false },
];

function loadHighlightRules(): HighlightRule[] {
  try {
    const raw = localStorage.getItem('webterm-highlight-rules');
    if (!raw) return DEFAULT_HIGHLIGHT_RULES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((r) => r && typeof r.keyword === 'string' && typeof r.color === 'string');
      return valid.length ? valid : DEFAULT_HIGHLIGHT_RULES;
    }
  } catch { /* use defaults */ }
  return DEFAULT_HIGHLIGHT_RULES;
}

function persistHighlightRules(rules: HighlightRule[]) {
  localStorage.setItem('webterm-highlight-rules', JSON.stringify(rules));
}

interface PreferencesState {
  themeName: string;
  fontSize: number;
  onekeyPwd: string;
  highlightRules: HighlightRule[];
  setThemeName: (name: string) => void;
  setFontSize: (size: number) => void;
  setOnekeyPwd: (pwd: string) => void;
  setHighlightRules: (rules: HighlightRule[]) => void;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  themeName: localStorage.getItem('webterm-theme') || 'Dracula',
  fontSize: Number(localStorage.getItem('webterm-fontSize')) || 16,
  onekeyPwd: localStorage.getItem('webterm-onekey') || '[]',
  highlightRules: loadHighlightRules(),
  setThemeName: (name) => {
    localStorage.setItem('webterm-theme', name);
    set({ themeName: name });
  },
  setFontSize: (size) => {
    localStorage.setItem('webterm-fontSize', String(size));
    set({ fontSize: size });
  },
  setOnekeyPwd: (pwd) => {
    localStorage.setItem('webterm-onekey', pwd);
    set({ onekeyPwd: pwd });
  },
  setHighlightRules: (rules) => {
    persistHighlightRules(rules);
    set({ highlightRules: rules });
  },
}));

export { parseOnekey, formatOnekey };
