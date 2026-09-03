import { t } from '../../i18n';
import { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import CustomSelect from '../common/CustomSelect';
import { apiPost, apiPut, apiGet } from '../../api/client';
import { colors, font } from '../../theme/tokens';

interface Group {
  id: number;
  name: string;
  type: string;
}

interface Props {
  connection?: EditableDbConnection;
  onClose: () => void;
  onSaved: () => void;
}

interface EditableDbConnection {
  id?: number; name?: string; host?: string; port?: number; username?: string; database_name?: string; group_id?: number; shared?: boolean;
}

interface DbConnectionFormState {
  name: string; host: string; port: number; username: string; password: string; database_name: string; group_id: number; shared: boolean;
}

export default function DbConnectionForm({ connection, onClose, onSaved }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState<DbConnectionFormState>({
    name: connection?.name || '',
    host: connection?.host || '',
    port: connection?.port || 3306,
    username: connection?.username || '',
    password: '',
    database_name: connection?.database_name || '',
    group_id: connection?.group_id || 0,
    shared: connection?.shared || false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet('/api/groups?type=database').then((data) => setGroups(data || [])).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    setSaving(true);
    setError('');
    try {
      if (connection?.id) {
        await apiPut(`/api/db_connections/${connection.id}`, form);
      } else {
        await apiPost('/api/db_connections', form);
      }
      onSaved();
      onClose();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : t('conn_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof DbConnectionFormState>(key: K, value: DbConnectionFormState[K]) => setForm((previous) => ({ ...previous, [key]: value }));

  return (
    <Modal title={connection ? t('db_conn_edit') : t('db_conn_new')} onClose={onClose} width={550} height={420} unscaled>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {error && <div style={{ color: colors.danger, fontSize: font.md, padding: '6px 10px', background: colors.bgError, borderRadius: 4, margin: '8px 16px 0' }}>{error}</div>}

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FormField label={t("conn_name")} value={form.name} onChange={(v) => update('name', v)} required />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 2 }}><FormField label={t("conn_host")} value={form.host} onChange={(v) => update('host', v)} placeholder="127.0.0.1" required /></div>
            <div style={{ flex: 1 }}><FormField label={t("conn_port")} value={String(form.port)} onChange={(v) => update('port', Number(v) || 3306)} type="number" /></div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}><FormField label={t("conn_username")} value={form.username} onChange={(v) => update('username', v)} placeholder="root" /></div>
            <div style={{ flex: 1 }}><FormField label={t("conn_password")} value={form.password} onChange={(v) => update('password', v)} type="password" placeholder={connection ? t('db_keep') : ''} /></div>
          </div>
          <FormField label={t("db_name")} value={form.database_name} onChange={(v) => update('database_name', v)} placeholder={t("db_optional")} />

          <div>
            <label style={labelStyle}>{t("conn_group")}</label>
            <CustomSelect value={String(form.group_id)} onChange={(v) => update('group_id', Number(v))} style={inputStyle}>
              <option value={0}>{t("conn_ungrouped")}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </CustomSelect>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textLight, fontSize: font.md, paddingBottom: 8 }}>
            <input type="checkbox" checked={form.shared} onChange={(e) => update('shared', e.target.checked)} />
            共享连接
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px', flexShrink: 0 }}>
          <button onClick={onClose} style={btnSecondary}>{t("conn_cancel")}</button>
          <button onClick={handleSubmit} disabled={saving || !form.name || !form.host}
            style={saving ? { ...btnPrimary, background: colors.border, cursor: 'default' } : btnPrimary}>
            {saving ? t('conn_saving') : t('conn_save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FormField({ label, value, onChange, type = 'text', placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}{required ? ' *' : ''}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

const labelStyle: React.CSSProperties = { color: colors.textMuted, fontSize: font.md, display: 'block', marginBottom: 4 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', background: 'rgba(31,35,53,0.5)', border: '1px solid var(--c-border)',
  borderRadius: 4, color: colors.text, fontSize: font.xl, boxSizing: 'border-box',
};
const btnSecondary: React.CSSProperties = { padding: '8px 20px', background: 'transparent', border: '1px solid var(--c-border)', color: colors.text, borderRadius: 4, cursor: 'pointer', fontSize: font.xl };
const btnPrimary: React.CSSProperties = { padding: '8px 20px', background: colors.accent, border: 'none', color: colors.bg, borderRadius: 4, cursor: 'pointer', fontSize: font.xl, fontWeight: 600 };
