interface LocationLike {
  protocol: string;
  host: string;
}

export function layoutSocketURL(token: string, location: LocationLike = window.location): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/layout?token=${encodeURIComponent(token)}`;
}

export function layoutEventRevision(raw: string, currentRevision: number): number | null {
  try {
    const message: unknown = JSON.parse(raw);
    if (typeof message !== 'object' || message === null || !('revision' in message)) return null;
    const revision = (message as { revision: unknown }).revision;
    return typeof revision === 'number' && Number.isSafeInteger(revision) && revision > currentRevision ? revision : null;
  } catch {
    return null;
  }
}
