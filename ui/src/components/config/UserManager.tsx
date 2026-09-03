import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import Modal from '../common/Modal';
import CustomSelect from '../common/CustomSelect';
import Icon from '../common/Icon';
import { colors, font } from '../../theme/tokens';

interface User {
  id: number;
  username: string;
  role: string;
  disabled: boolean;
  created_at: string;
  updated_at: string;
}

export default function UserManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ username: '', password: '', role: 'user', disabled: false });

  const token = useAuthStore((s) => s.token);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await apiGet('/api/users');
      setUsers(data || []);
    } catch {
      setError(t('config_load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => { void fetchUsers(); }, 0);
    return () => window.clearTimeout(timer);
  }, [token]);

  const handleCreate = async () => {
    try {
      await apiPost('/api/users', formData);
      setShowForm(false);
      resetForm();
      fetchUsers();
    } catch { setError(t('config_create_failed')); }
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    try {
      await apiPut(`/api/users/${editingUser.id}`, formData);
      setShowForm(false);
      setEditingUser(null);
      resetForm();
      fetchUsers();
    } catch { setError(t('config_update_failed')); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('config_confirm_delete'))) return;
    try {
      await apiDelete(`/api/users/${id}`);
      fetchUsers();
    } catch { setError(t('config_delete_failed')); }
  };

  const resetForm = () => {
    setFormData({ username: '', password: '', role: 'user', disabled: false });
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setFormData({ username: user.username, password: '', role: user.role, disabled: user.disabled });
    setShowForm(true);
  };

  return (
    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ color: colors.textLight, margin: 0, fontSize: font.xl2 }}>{t("config_users")}</h3>
        <button onClick={() => { resetForm(); setEditingUser(null); setShowForm(true); }}
          style={{
            background: colors.accent, border: 'none', color: colors.bg, padding: '6px 16px',
            borderRadius: 4, cursor: 'pointer', fontSize: font.md,
          }}>{t("config_new_user")}</button>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', color: colors.danger, background: colors.bgError, borderRadius: 4, marginBottom: 12, fontSize: font.md }}>
          {error}
          <button onClick={() => setError('')} style={{ marginLeft: 8, background: 'none', border: 'none', color: colors.danger, cursor: 'pointer', display: 'flex', alignItems: 'center' }}><Icon name="x" size={14} /></button>
        </div>
      )}

      {loading ? (
        <div style={{ color: colors.textMuted }}>{t("file_loading")}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: font.md }}>
          <thead>
            <tr style={{ background: colors.bg }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: colors.accent, borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }}>ID</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: colors.accent, borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }}>{t("config_user")}</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: colors.accent, borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }}>{t("config_role")}</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: colors.accent, borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }}>{t("config_status")}</th>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: colors.accent, borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }}>{t("config_created")}</th>
              <th style={{ padding: '8px 12px', textAlign: 'center', color: colors.accent, borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }}>{t("config_actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ background: u.id % 2 === 0 ? colors.bg : colors.bgInput }}>
                <td style={{ padding: '6px 12px', color: colors.textLight, borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }}>{u.id}</td>
                <td style={{ padding: '6px 12px', color: colors.textLight, borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }}>{u.username}</td>
                <td style={{ padding: '6px 12px', color: u.role === 'admin' ? colors.accent : colors.textLight, borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }}>{u.role}</td>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }}>
                  <span style={{ color: u.disabled ? colors.danger : colors.successText }}>{u.disabled ? t('config_disabled') : t('config_active')}</span>
                </td>
                <td style={{ padding: '6px 12px', color: colors.textDim, borderBottom: '1px solid var(--c-border)', fontSize: font.sm, whiteSpace: 'nowrap' }}>{u.created_at}</td>
                <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--c-border)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button onClick={() => openEdit(u)}
                    style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontSize: font.sm, marginRight: 8 }}>{t("menu_edit")}</button>
                  <button onClick={() => handleDelete(u.id)}
                    style={{ background: 'none', border: 'none', color: colors.danger, cursor: 'pointer', fontSize: font.sm }}>{t("menu_delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm && (
        <Modal title={editingUser ? t('config_edit_user') : t('config_new_user')} onClose={() => { setShowForm(false); setEditingUser(null); }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
            <div>
              <label style={{ color: colors.textLight, fontSize: font.md, display: 'block', marginBottom: 4 }}>{t("config_user")}</label>
              <input value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                style={{
                  width: '100%', padding: '6px 10px', background: colors.bgInput, border: '1px solid var(--c-border)',
                  borderRadius: 4, color: colors.textLight, fontSize: font.md, boxSizing: 'border-box',
                }} />
            </div>
            <div>
              <label style={{ color: colors.textLight, fontSize: font.md, display: 'block', marginBottom: 4 }}>
                {t("conn_password")}{editingUser ? t('config_keep_pwd') : ''}
              </label>
              <input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                style={{
                  width: '100%', padding: '6px 10px', background: colors.bgInput, border: '1px solid var(--c-border)',
                  borderRadius: 4, color: colors.textLight, fontSize: font.md, boxSizing: 'border-box',
                }} />
            </div>
            <div>
              <label style={{ color: colors.textLight, fontSize: font.md, display: 'block', marginBottom: 4 }}>{t("config_role")}</label>
              <CustomSelect value={formData.role} onChange={(v) => setFormData({ ...formData, role: v })}
                style={{
                  width: '100%', padding: '6px 10px', background: colors.bgInput, border: '1px solid var(--c-border)',
                  borderRadius: 4, color: colors.textLight, fontSize: font.md,
                }}>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </CustomSelect>
            </div>
            {editingUser && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={formData.disabled} onChange={(e) => setFormData({ ...formData, disabled: e.target.checked })}
                  id="user-disabled" />
                <label htmlFor="user-disabled" style={{ color: colors.textLight, fontSize: font.md }}>{t("config_disable")}</label>
              </div>
            )}
            <button onClick={editingUser ? handleUpdate : handleCreate}
              style={{
                padding: '8px 16px', background: colors.accent, border: 'none', color: colors.bg,
                borderRadius: 4, cursor: 'pointer', fontSize: font.md, alignSelf: 'flex-end',
              }}>
              {editingUser ? t('conn_save') : t('config_create')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
