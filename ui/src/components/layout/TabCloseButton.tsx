import Icon from '../common/Icon';
import { colors } from '../../theme/tokens';

export default function TabCloseButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); onClick(); }}
    style={{ color: colors.textMuted, cursor: disabled ? 'wait' : 'pointer', border: 0, padding: 0, background: 'transparent', borderRadius: '50%', width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onMouseEnter={event => { event.currentTarget.style.background = colors.border; event.currentTarget.style.color = colors.bg; }}
    onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; event.currentTarget.style.color = colors.textMuted; }}><Icon name="x" size={11} /></button>;
}
