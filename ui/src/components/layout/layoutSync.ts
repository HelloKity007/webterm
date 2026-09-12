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
