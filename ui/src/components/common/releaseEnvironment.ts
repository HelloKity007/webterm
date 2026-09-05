interface HealthInfo {
  environment?: string;
  version?: string;
}

export function releaseBadgeDetails(health: HealthInfo | null): { visible: boolean; version: string } {
  if (health?.environment !== 'release-test') return { visible: false, version: '' };
  return { visible: true, version: (health.version || '').slice(0, 8) };
}
