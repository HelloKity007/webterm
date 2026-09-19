import { useAuthStore } from '../store/auth';

const BASE = '';

function getToken(): string | null {
  return localStorage.getItem('token');
}

function clearAuth() {
  useAuthStore.getState().logout();
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function responseError(resp: Response): Promise<ApiError> {
  const text = await resp.text();
  try {
    const body = JSON.parse(text) as { error?: string; code?: string };
    return new ApiError(body.error || text || `request failed (${resp.status})`, resp.status, body.code);
  } catch {
    return new ApiError(text || `request failed (${resp.status})`, resp.status);
  }
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const resp = await fetch(`${BASE}${path}`, { ...options, headers });
  if (resp.status === 401 && token) {
    clearAuth();
  }
  return resp;
}

export async function apiGet(path: string) {
  const resp = await apiFetch(path);
  if (!resp.ok) throw await responseError(resp);
  return resp.json();
}

export async function apiPost(path: string, body: unknown) {
  const resp = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw await responseError(resp);
  return resp.json();
}

export async function apiPut(path: string, body: unknown, options: RequestInit = {}) {
  const resp = await apiFetch(path, {
    ...options,
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw await responseError(resp);
  return resp.json();
}

export async function apiDelete(path: string) {
  const resp = await apiFetch(path, { method: 'DELETE' });
  if (!resp.ok) throw await responseError(resp);
  return resp.json();
}
