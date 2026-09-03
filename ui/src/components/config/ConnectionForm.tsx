import { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import CustomSelect from '../common/CustomSelect';
import { apiPost, apiPut, apiGet } from '../../api/client';
import { usePreferencesStore, parseOnekey } from '../../store/preferences';
import { t } from '../../i18n';
import Icon from '../common/Icon';
import { colors, font } from '../../theme/tokens';

interface Group {
  id: number;
  name: string;
  type: string;
}

interface Props {
  connection?: EditableConnection;
  onClose: () => void;
  onSaved: () => void;
}

interface EditableConnection {
  id?: number; name?: string; host?: string; port?: number; username?: string; auth_method?: string;
  password?: string; group_id?: number; shared?: boolean; max_sessions?: number; tag?: string; color?: string;
}

interface ConnectionFormState {
  name: string; host: string; port: number; username: string; auth_method: string; password: string;
  private_key: string; passphrase: string; group_id: number; shared: boolean; max_sessions: number; tag: string; color: string;
}

export default function ConnectionForm({ connection, onClose, onSaved }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState<ConnectionFormState>({
    name: connection?.name || '',
    host: connection?.host || '',
    port: connection?.port || 22,
    username: connection?.username || '',
    auth_method: connection?.auth_method || 'password',
    password: connection?.password || '',
    private_key: '',
    passphrase: '',
    group_id: connection?.group_id || 0,
    shared: connection?.shared || false,
    max_sessions: connection?.max_sessions || 10,
    tag: connection?.tag || '',
    color: connection?.color || colors.accent,
  });
  const onekeyPwd = usePreferencesStore((s) => s.onekeyPwd);
  const onekeyKvs = parseOnekey(onekeyPwd || '[]');
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet('/api/groups?type=ssh').then((data) => setGroups(data || [])).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    try {
      if (connection?.id) {
        await apiPut(`/api/connections/${connection.id}`, form);
      } else {
        await apiPost('/api/connections', form);
      }
      onSaved();
      onClose();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : t('conn_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof ConnectionFormState>(key: K, value: ConnectionFormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Modal title={connection ? t('conn_edit') : t('conn_new')} onClose={onClose} width={520} height={form.auth_method === 'private_key' ? 530 : 410} unscaled>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {error && <div style={{ color: colors.danger, fontSize: font.md, padding: '4px 10px', background: colors.bgError, borderRadius: 4, margin: '4px 12px 0' }}>{error}</div>}

        <div style={{ padding: '16px 28px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
          {/* All rows use same 4-column grid for perfect vertical alignment */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
            <div style={{ gridColumn: '1 / 3' }}><FormField label={t("conn_name")} value={form.name} onChange={(v) => update('name', v)} required /></div>
            <div style={{ gridColumn: '3 / 5' }}>
              <label style={labelStyle}>{t("conn_tag")}</label>
              <input value={form.tag || ''} onChange={(e) => update('tag', e.target.value)} style={inputStyle} placeholder={t('conn_optional')} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
            <div style={{ gridColumn: '1 / 3' }}><FormField label={t("conn_host")} value={form.host} onChange={(v) => update('host', v)} placeholder="192.168.1.1" required /></div>
            <div style={{ gridColumn: '3 / 4' }}><FormField label={t("conn_port")} value={String(form.port)} onChange={(v) => update('port', Number(v) || 22)} type="number" /></div>
            <div style={{ gridColumn: '4 / 5' }}>
              <label style={labelStyle}>{t("conn_color")}</label>
              <CustomSelect value={form.color || colors.accent} onChange={(v) => update('color', v)}
                style={{ ...selectStyle, color: form.color || colors.accent }}>
                {[
                  {v:colors.accent,n:t('color_blue')},{v:colors.success,n:t('color_green')},{v:'#f44336',n:t('color_red')},
                  {v:'#ff9800',n:t('color_orange')},{v:'#9c27b0',n:t('color_purple')},{v:'#00bcd4',n:t('color_cyan')},
                  {v:'#e91e63',n:t('color_pink')},{v:'#ffeb3b',n:t('color_yellow')},{v:'#607d8b',n:t('color_gray')},{v:'#795548',n:t('color_brown')},
                ].map(c => (
                  <option key={c.v} value={c.v} style={{ color: c.v }}>● {c.n}</option>
                ))}
              </CustomSelect>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
            <div style={{ gridColumn: '1 / 2' }}>
              <label style={labelStyle}>{t("conn_auth")}</label>
              <CustomSelect value={form.auth_method} onChange={(v) => {
                  setForm((prev) => {
                    const next = { ...prev, auth_method: v };
                    if (v === 'onekey') {
                      next.username = onekeyKvs[0]?.u || '';
                      next.password = onekeyKvs[0]?.v || '';
                    } else if (v === 'password') {
                      next.password = '';
                    }
                    return next;
                  });
                }} style={selectStyle}>
                <option value="password">{t("conn_auth_password")}</option>
                <option value="onekey">OneKey</option>
                <option value="private_key">{t("conn_auth_private_key")}</option>
              </CustomSelect>
            </div>
            {form.auth_method === 'password' && (
              <>
                <div style={{ gridColumn: '2 / 3' }}><FormField label={t("conn_username")} value={form.username} onChange={(v) => update('username', v)} placeholder="root" /></div>
                <div style={{ gridColumn: '3 / 5', position: 'relative' }}>
                  <FormField label={t('conn_auth_password')} value={form.password} onChange={(v) => update('password', v)} type={showPwd ? 'text' : 'password'} />
                  <span onClick={() => setShowPwd(!showPwd)}
                    style={{ position: 'absolute', right: 8, top: '50%', cursor: 'pointer', color: colors.textMuted, userSelect: 'none', display: 'flex', alignItems: 'center' }}>
                    {showPwd ? <Icon name="eye-off" size={14} /> : <Icon name="eye" size={14} />}
                  </span>
                </div>
              </>
            )}
            {form.auth_method === 'onekey' && (
              <>
                <div style={{ gridColumn: '2 / 3' }}>
                  <label style={labelStyle}>OneKey</label>
                  {onekeyKvs.length > 0 ? (
                    <CustomSelect value={onekeyKvs.find((kv) => kv.v === form.password)?.k || ''}
                      onChange={(v) => {
                        const kv = onekeyKvs.find((x) => x.k === v);
                        if (kv) { update('username', kv.u); update('password', kv.v); }
                      }}
                      style={selectStyle}>
                      {onekeyKvs.map((kv) => (<option key={kv.k} value={kv.k}>{kv.k}</option>))}
                    </CustomSelect>
                  ) : (
                    <div style={{ color: colors.textMuted, fontSize: font.sm, padding: '8px 0' }}>{t("sftp_no_key")}</div>
                  )}
                </div>
                <div style={{ gridColumn: '3 / 4' }}><FormField label={t("conn_username")} value={form.username} onChange={(v) => update('username', v)} placeholder="root" readOnly={onekeyKvs.length > 0} /></div>
                <div style={{ gridColumn: '4 / 5', position: 'relative' }}>
                  <FormField label={t('conn_auth_password')} value={form.password} onChange={(v) => update('password', v)} type={showPwd ? 'text' : 'password'} readOnly={onekeyKvs.length > 0} />
                  {onekeyKvs.length > 0 && (
                    <span onClick={() => setShowPwd(!showPwd)}
                      style={{ position: 'absolute', right: 8, top: '50%', cursor: 'pointer', color: colors.textMuted, userSelect: 'none', display: 'flex', alignItems: 'center' }}>
                      {showPwd ? <Icon name="eye-off" size={14} /> : <Icon name="eye" size={14} />}
                    </span>
                  )}
                </div>
              </>
            )}
            {form.auth_method === 'private_key' && (
              <div style={{ gridColumn: '2 / 5' }}><FormField label={t('conn_passphrase')} value={form.passphrase} onChange={(v) => update('passphrase', v)} type="password" /></div>
            )}
            {form.auth_method === 'private_key' && <div style={{ gridColumn: '2 / 5' }} />}
          </div>


          {form.auth_method === 'private_key' && (
            <div>
              <label style={labelStyle}>{t("conn_private_key")}</label>
              <textarea value={form.private_key} onChange={(e) => update('private_key', e.target.value)}
                style={{ ...inputStyle, height: 80, fontFamily: 'Consolas, monospace', fontSize: font.sm, resize: 'none' }}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
            <div style={{ gridColumn: '1 / 3' }}>
              <label style={labelStyle}>{t("conn_group")}</label>
              <CustomSelect value={String(form.group_id)} onChange={(v) => update('group_id', Number(v))} style={selectStyle}>
                <option value="0">{t("conn_ungrouped")}</option>
                {groups.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
              </CustomSelect>
            </div>
            <div style={{ gridColumn: '3 / 4' }}>
              <label style={labelStyle}>{t("conn_visibility")}</label>
              <CustomSelect value={form.shared ? 'shared' : 'private'} onChange={(v) => update('shared', v === 'shared')} style={selectStyle}>
                <option value="private">私有</option>
                <option value="shared">共享</option>
              </CustomSelect>
            </div>
            <div style={{ gridColumn: '4 / 5' }}><FormField label={t("conn_max_sessions")} value={String(form.max_sessions)} onChange={(v) => update('max_sessions', Number(v) || 10)} type="number" /></div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px', flexShrink: 0 }}>
          <button onClick={onClose} style={btnSecondary}>{t("conn_cancel")}</button>
          <button onClick={handleSubmit} disabled={saving || !form.name || !form.host}
            style={saving ? { ...btnPrimary, background: colors.textMuted, cursor: 'default' } : btnPrimary}>
            {saving ? t('conn_saving') : t('conn_save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FormField({ label, value, onChange, type = 'text', placeholder, required, readOnly }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean; readOnly?: boolean;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}{required ? ' *' : ''}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} readOnly={readOnly} style={{ ...inputStyle, opacity: readOnly ? 0.6 : 1 }} />
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', background: 'rgba(31,35,53,0.5)', border: '1px solid var(--c-border)',
  borderRadius: 4, color: colors.text, fontSize: font.xl, boxSizing: 'border-box', outline: 'none',
};
const selectStyle: React.CSSProperties = { ...inputStyle };
const btnSecondary: React.CSSProperties = { padding: '8px 20px', background: 'transparent', border: '1px solid var(--c-border)', color: colors.text, borderRadius: 4, cursor: 'pointer', fontSize: font.xl };
const btnPrimary: React.CSSProperties = { padding: '8px 20px', background: colors.accent, border: 'none', color: colors.bg, borderRadius: 4, cursor: 'pointer', fontSize: font.xl, fontWeight: 600 };
const labelStyle: React.CSSProperties = { color: colors.textMuted, fontSize: font.md, display: 'block', marginBottom: 4 };
