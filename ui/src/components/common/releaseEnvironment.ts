interface HealthInfo {
  environment?: string;
  version?: string;
}

export function releaseBadgeDetails(health: HealthInfo | null): { visible: boolean; version: string } {
  if (health?.environment !== 'release-test') return { visible: false, version: '' };
  return { visible: true, version: (health.version || '').slice(0, 8) };
}

let releaseTestProbe: Promise<boolean> | null = null;

// One shared answer per page load: automatic terminal recovery must never run
// outside release-test, so callers await this before touching any identity.
export function isReleaseTestEnvironment(): Promise<boolean> {
  if (!releaseTestProbe) {
    releaseTestProbe = fetch('/api/health')
      .then((response) => (response.ok ? response.json() : null))
      .then((health: HealthInfo | null) => health?.environment === 'release-test')
      .catch(() => false);
  }
  return releaseTestProbe;
}
