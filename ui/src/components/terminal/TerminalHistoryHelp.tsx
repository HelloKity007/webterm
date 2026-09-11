import { t } from '../../i18n';
import { colors, font } from '../../theme/tokens';

interface Props {
  onClose: () => void;
  onLaunchCodexScrollable: () => void;
  onResumeInput: () => void;
  onReplayHistory: () => void;
  onSelectCopy: () => void;
  onCopySelection: () => void;
  onPaste: () => void;
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

const actionStyle = {
  padding: '5px 9px', border: '1px solid var(--c-accent)', borderRadius: 4,
  background: colors.accentDim, color: colors.text, cursor: 'pointer', fontSize: font.sm,
} as const;

export default function TerminalHistoryHelp({ onClose, onLaunchCodexScrollable, onResumeInput, onReplayHistory, onSelectCopy, onCopySelection, onPaste }: Props) {
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
        <button type="button" onClick={onResumeInput} style={{ ...actionStyle, marginTop: 6 }}>
          {t('term_history_resume_input')}
        </button>
        <button type="button" onClick={onReplayHistory} style={{ ...actionStyle, marginTop: 6, marginLeft: 6 }}>
          {t('term_history_replay')}
        </button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <strong>{t('term_history_clipboard')}</strong>
        <div>{t('term_history_clipboard_hint')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          <button type="button" onClick={onSelectCopy} style={actionStyle}>{t('term_select_copy')}</button>
          <button type="button" onClick={onCopySelection} style={actionStyle}>{t('term_copy')}</button>
          <button type="button" onClick={onPaste} style={actionStyle}>{t('term_paste')}</button>
        </div>
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
        <button type="button" onClick={onLaunchCodexScrollable} style={{ ...actionStyle, marginTop: 6 }}>
          {t('term_history_codex_launch')}
        </button>
      </div>

      <div style={{ color: colors.warning }}>{t('term_history_shared')}</div>
    </section>
  );
}
