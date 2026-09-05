import { t } from '../../i18n';
import { colors, font } from '../../theme/tokens';

interface Props {
  onClose: () => void;
  onLaunchCodexScrollable: () => void;
}

const keyStyle = {
  padding: '1px 4px',
  border: '1px solid var(--c-border)',
  borderRadius: 3,
  background: colors.bgDeep,
  color: colors.text,
  fontFamily: 'inherit',
  fontSize: font.xs,
} as const;

function Key({ children }: { children: string }) {
  return <kbd style={keyStyle}>{children}</kbd>;
}

export default function TerminalHistoryHelp({ onClose, onLaunchCodexScrollable }: Props) {
  return (
    <section aria-label={t('term_history_title')} style={{
      position: 'absolute', top: 30, right: 8, zIndex: 20,
      width: 'min(420px, calc(100% - 16px))', maxHeight: 'calc(100% - 38px)', overflowY: 'auto',
      padding: 12, border: '1px solid var(--c-border)', borderRadius: 6,
      background: colors.bgInput, color: colors.text, fontSize: font.sm,
      lineHeight: 1.6, boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <strong style={{ color: colors.accent, fontSize: font.md }}>{t('term_history_title')}</strong>
        <button type="button" aria-label={t('term_history_close')} onClick={onClose} style={{
          border: 0, background: 'transparent', color: colors.textMuted, cursor: 'pointer', fontSize: font.lg,
        }}>×</button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <strong>{t('term_history_tmux')}</strong>
        <div>{t('term_history_tmux_hint')}</div>
        <div><Key>Shift</Key> + {t('term_history_wheel')} · <Key>q</Key> / <Key>Esc</Key> {t('term_history_exit')}</div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <strong>Claude Code</strong>
        <div>{t('term_history_claude_mode')} <Key>/tui fullscreen</Key></div>
        <div>{t('term_history_claude_keys')} <Key>PgUp/PgDn</Key> · <Key>Ctrl+Home/End</Key></div>
        <div>{t('term_history_claude_transcript')} <Key>Ctrl+O</Key> · <Key>[</Key></div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <strong>Codex CLI</strong>
        <div>{t('term_history_codex_hint')} <Key>Ctrl+T</Key></div>
        <button type="button" onClick={onLaunchCodexScrollable} style={{
          marginTop: 6, padding: '5px 9px', border: '1px solid var(--c-accent)', borderRadius: 4,
          background: colors.accentDim, color: colors.text, cursor: 'pointer', fontSize: font.sm,
        }}>{t('term_history_codex_launch')}</button>
      </div>

      <div style={{ color: colors.warning }}>{t('term_history_shared')}</div>
    </section>
  );
}
