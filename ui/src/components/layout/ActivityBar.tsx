import { t } from '../../i18n';
import { normalizeModuleType, useLayoutStore, useWorkspaceChromeStore } from '../../store/layout';
import { useAuthStore } from '../../store/auth';
import type { ModuleType } from '../../store/layout';
import Icon from '../common/Icon';
import { colors } from '../../theme/tokens';

const modules: { type: ModuleType; label: string; icon: string }[] = [
  { type: 'ssh', label: t('activity_ssh'), icon: 'terminal' },
  { type: 'files', label: t('activity_files'), icon: 'file' },
  { type: 'database', label: t('activity_database'), icon: 'database' },
  { type: 'config', label: t('activity_config'), icon: 'sliders-horizontal' },
];

const btnStyle = (active: boolean): React.CSSProperties => ({
  width: 32, height: 32, display: 'flex', alignItems: 'center',
  justifyContent: 'center', cursor: 'pointer',
  borderRadius: 4, color: active ? colors.bg : colors.textMuted,
  background: active ? colors.accent : 'transparent',
  borderLeft: active ? '2px solid var(--c-bg)' : '2px solid transparent',
});

export default function ActivityBar({ onOpenSettings, sidebarCollapsed, onToggleSidebar }: {
  onOpenSettings: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const activeModule = normalizeModuleType(useLayoutStore((s) => s.activeModule));
  const setActiveModule = useLayoutStore((s) => s.setActiveModule);
  const token = useAuthStore((s) => s.token);
  const expanded = useWorkspaceChromeStore(s => s.expanded);
  const toggleWorkspaceTabs = useWorkspaceChromeStore(s => s.toggle);

  return (
    <div className="activity-rail" style={{
      width: 38, background: colors.bg, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--c-border)',
      alignItems: 'center', paddingTop: 4, gap: 4, flexShrink: 0,
    }}>
      <div className="activity-btn" title={sidebarCollapsed ? t('sidebar_expand') : t('sidebar_collapse')} onClick={() => { if (token) onToggleSidebar(); }}
        style={btnStyle(false)}>
        {sidebarCollapsed ? <Icon name="panel-left-open" size={14} /> : <Icon name="panel-left-close" size={14} />}
      </div>
      <button type="button" className="activity-btn workspace-tabs-toggle"
        aria-label={t(expanded ? 'workspace_tabs_collapse' : 'workspace_tabs_expand')}
        title={t(expanded ? 'workspace_tabs_collapse' : 'workspace_tabs_expand')}
        aria-expanded={expanded} disabled={!token || activeModule !== 'ssh'}
        onClick={toggleWorkspaceTabs}
        style={{ ...btnStyle(expanded), border: 0, padding: 0, flexShrink: 0 }}>
        <Icon name="table" size={16} />
      </button>
      {modules.map(({ type, label, icon }) => (
        <button type="button" key={type} className={`activity-btn activity-${type}`} title={label} aria-label={label}
          aria-pressed={activeModule === type} disabled={!token} onClick={() => { if (token) setActiveModule(type); }}
          style={btnStyle(activeModule === type)}>
          <Icon name={icon} size={16} />
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <div className="activity-btn" title="个人设置" onClick={() => { if (token) onOpenSettings(); }}
        style={{ ...btnStyle(false), marginBottom: 8, flexShrink: 0 }}>
        <Icon name="settings" size={16} />
      </div>
    </div>
  );
}
