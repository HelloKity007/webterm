import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { colors, font } from '../../theme/tokens';
import { releaseBadgeDetails } from './releaseEnvironment';

interface HealthInfo {
  environment?: string;
  version?: string;
}

export default function ReleaseEnvironmentBadge() {
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => setHealth(value))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const badge = releaseBadgeDetails(health);
  if (!badge.visible) return null;

  return (
    <div role="status" aria-label={t('release_test_badge')} style={{
      position: 'fixed', top: 5, left: '50%', transform: 'translateX(-50%)', zIndex: 3000,
      padding: '3px 10px', borderRadius: 999, pointerEvents: 'none',
      border: `1px solid ${colors.warning}`, background: colors.bgRaised,
      color: colors.warning, fontSize: font.sm, fontWeight: 700,
      boxShadow: '0 3px 14px rgba(0,0,0,0.35)', whiteSpace: 'nowrap',
    }}>
      {t('release_test_badge')}{badge.version ? ` · ${badge.version}` : ''}
    </div>
  );
}
