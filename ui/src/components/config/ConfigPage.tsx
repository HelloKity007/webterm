import CustomSelect from "../common/CustomSelect";
import { t } from '../../i18n';
import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/auth';
import UserManager from './UserManager';
import ConnectionTable from './ConnectionTable';
import { apiGet, apiPost, apiDelete } from '../../api/client';
import { colors, font } from '../../theme/tokens';

interface Group { id: number; name: string; type: string; }

const tabs = [
  { key: 'users', label: t('config_users') },
  { key: 'ssh', label: t('config_ssh') },
  { key: 'database', label: t('config_database') },
  { key: 'groups', label: t('config_groups') },
];

export default function ConfigPage() {
  const [activeTab, setActiveTab] = useState('users');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', background: colors.bg, borderBottom: '1px solid var(--c-border)', flexShrink: 0, height: 36, alignItems: 'center', padding: '0 6px' }}>
        {tabs.map((tab, idx) => (
          <React.Fragment key={tab.key}>
            {idx > 0 && (
              <span style={{
                width: 1, height: 16, flexShrink: 0, alignSelf: 'center',
                background: (activeTab !== tab.key && activeTab !== tabs[idx-1].key) ? colors.border : 'transparent',
              }} />
            )}
            <div onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '4px 14px', cursor: 'pointer', fontSize: font.md, borderRadius: 5,
                color: activeTab === tab.key ? colors.bg : colors.textMuted2,
                background: activeTab === tab.key ? colors.accent : 'transparent',
                height: 28, display: 'flex', alignItems: 'center',
              }}>
              {tab.label}
            </div>
          </React.Fragment>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'users' && <UserManager />}
        {activeTab === 'ssh' && (
          <ConnectionTable
            type="ssh"
            title={t('config_ssh')}
            apiPrefix="/api/connections"
            groupType="ssh"
            columns={[
              { key: 'name', label: t('conn_name'), width: '2fr' },
              { key: 'host', label: t('conn_host'), width: '2fr' },
              { key: 'port', label: t('conn_port'), width: '1fr' },
              { key: 'username', label: t('config_user'), width: '1fr' },
              { key: 'shared', label: t('conn_shared'), width: '1fr', render: (value) => value === true ? t('config_yes') : t('config_no') },
            ]}
          />
        )}
        {activeTab === 'database' && (
          <ConnectionTable
            type="db"
            title={t('config_database')}
            apiPrefix="/api/db_connections"
            groupType="database"
            columns={[
              { key: 'name', label: t('conn_name'), width: '2fr' },
              { key: 'host', label: t('conn_host'), width: '2fr' },
              { key: 'port', label: t('conn_port'), width: '1fr' },
              { key: 'username', label: t('config_user'), width: '1fr' },
              { key: 'database_name', label: t('db_name'), width: '1fr' },
              { key: 'shared', label: t('conn_shared'), width: '1fr', render: (value) => value === true ? t('config_yes') : t('config_no') },
            ]}
          />
        )}
        {activeTab === 'groups' && <GroupManager />}
      </div>
    </div>
  );
}

function GroupManager() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('ssh');
  const [error, setError] = useState('');
  const token = useAuthStore((s) => s.token);

  const fetchGroups = async () => {
    try {
      const all: Group[] = [];
      for (const groupType of ['ssh', 'database', 'sftp_bookmark']) {
        const data = await apiGet(`/api/groups?type=${groupType}`);
        const typedGroups = Array.isArray(data) ? data as Group[] : [];
        all.push(...typedGroups.map((group) => ({ ...group, type: groupType })));
      }
      setGroups(all);
    } catch { setError(t('config_load_failed')); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => { void fetchGroups(); }, 0);
    return () => window.clearTimeout(timer);
  }, [token]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await apiPost('/api/groups', { name: newName.trim(), type: newType, parent_id: 0 });
      setNewName('');
      fetchGroups();
    } catch { setError(t('config_create_failed')); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('config_confirm_delete_group'))) return;
    try { await apiDelete(`/api/groups/${id}`); fetchGroups(); }
    catch { setError(t('config_delete_failed')); }
  };

  if (loading) return <div style={{ padding: 16, color: colors.textMuted }}>{t("file_loading")}</div>;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ color: colors.textLight, margin: 0, fontSize: font.xl2 }}>{t("config_groups")}</h3>
      </div>
      {error && <div style={{ color: colors.danger, fontSize: font.md, padding: '6px 10px', background: colors.bgError, borderRadius: 4, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'nowrap' }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder={t("sidebar_group_name")} style={{ padding: '6px 10px', background: colors.bgInput, border: '1px solid var(--c-border)', borderRadius: 4, color: colors.textLight, fontSize: font.md, flex: 1, minWidth: 100, maxWidth: 240 }} />
        <CustomSelect value={newType} onChange={(v) => setNewType(v)}
          style={{ padding: '6px 10px', background: colors.bgInput, border: '1px solid var(--c-border)', borderRadius: 4, color: colors.textLight, fontSize: font.md, flexShrink: 0 }}>
          <option value="ssh">SSH</option>
          <option value="database">{t("config_database")}</option>
          <option value="sftp_bookmark">{t("config_sftp_bookmark")}</option>
        </CustomSelect>
        <button onClick={handleCreate} style={{ padding: '6px 16px', background: colors.accent, border: 'none', color: colors.bg, borderRadius: 4, cursor: 'pointer', fontSize: font.md, flexShrink: 0, whiteSpace: 'nowrap' }}>{t("config_create")}</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: font.md }}>
        <thead>
          <tr style={{ background: colors.bg }}>
            <th style={thStyle}>ID</th>
            <th style={thStyle}>{t("conn_name")}</th>
            <th style={thStyle}>{t("config_type")}</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>{t("config_actions")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={g.id} style={{ background: i % 2 === 0 ? colors.bg : colors.bgInput }}>
              <td style={tdStyle}>{g.id}</td>
              <td style={tdStyle}>{g.name}</td>
              <td style={tdStyle}>{g.type}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>
                <button onClick={() => handleDelete(g.id)} style={{ background: 'none', border: 'none', color: colors.danger, cursor: 'pointer', fontSize: font.sm }}>{t("menu_delete")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', color: colors.accent, borderBottom: '1px solid var(--c-border)' };
const tdStyle: React.CSSProperties = { padding: '6px 12px', color: colors.textLight, borderBottom: '1px solid var(--c-border)' };
