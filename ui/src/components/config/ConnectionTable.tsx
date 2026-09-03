import { t } from '../../i18n';
import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiDelete } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import ConnectionForm from './ConnectionForm';
import DbConnectionForm from './DbConnectionForm';
import { colors, font } from '../../theme/tokens';
import type { Connection, DbConnection, Group } from '../../store/connections';

type TableItem = (Connection | DbConnection) & Record<string, unknown>;

interface Column {
  key: string;
  label: string;
  width: string;
  render?: (value: unknown) => string;
}

interface Props {
  type: 'ssh' | 'db';
  title: string;
  apiPrefix: string;
  groupType: string;
  columns: Column[];
}

export default function ConnectionTable({ type, title, apiPrefix, groupType, columns }: Props) {
  const [items, setItems] = useState<TableItem[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<TableItem | null>(null);

  const token = useAuthStore((s) => s.token);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [data, groupData] = await Promise.all([
        apiGet(apiPrefix),
        apiGet(`/api/groups?type=${groupType}`),
      ]);
      setItems(Array.isArray(data) ? data as TableItem[] : []);
      setGroups(Array.isArray(groupData) ? groupData as Group[] : []);
    } catch {
      setError(t('config_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [apiPrefix, groupType]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => { void fetchData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchData, token]);

  const handleDelete = async (id: number) => {
    if (!confirm(t('config_confirm_delete_conn'))) return;
    try {
      await apiDelete(`${apiPrefix}/${id}`);
      fetchData();
    } catch {
      setError(t('config_delete_failed'));
    }
  };

  const groupMap: Record<number, string> = {};
  groups.forEach((group) => { groupMap[group.id] = group.name; });

  if (loading) return <div style={{ padding: 24, color: colors.textMuted }}>{t("file_loading")}</div>;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ color: colors.textLight, margin: 0, fontSize: font.xl2 }}>{title} <span style={{ color: colors.textMuted, fontSize: font.md, fontWeight: 400 }}>{t("config_total")} {items.length} {t("config_items")}</span></h3>
        <button onClick={() => { setEditingItem(null); setShowForm(true); }}
          style={{ padding: '6px 16px', background: colors.accent, border: 'none', color: colors.bg, borderRadius: 4, cursor: 'pointer', fontSize: font.md }}>
          {t("config_create")}{type === 'ssh' ? 'SSH' : t("config_database")}{t("config_conn")}
        </button>
      </div>

      {error && <div style={{ color: colors.danger, fontSize: font.md, padding: '6px 10px', background: colors.bgError, borderRadius: 4, marginBottom: 12 }}>{error}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: font.md }}>
        <thead>
          <tr style={{ background: colors.bg }}>
            {columns.map((col) => (
              <th key={col.key} style={{ padding: '8px 12px', textAlign: 'left', color: colors.accent, borderBottom: '1px solid var(--c-border)', width: col.width, whiteSpace: 'nowrap' }}>{col.label}</th>
            ))}
            <th style={{ padding: '8px 12px', textAlign: 'center', color: colors.accent, borderBottom: '1px solid var(--c-border)', width: '120px', whiteSpace: 'nowrap' }}>{t("config_actions")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id} style={{ background: i % 2 === 0 ? colors.bg : colors.bgInput }}
              onDoubleClick={() => { setEditingItem(item); setShowForm(true); }}>
              {columns.map((col) => (
                <td key={col.key} style={{ padding: '6px 12px', color: colors.textLight, borderBottom: '1px solid var(--c-border)', whiteSpace: 'nowrap' }}>
                  {col.render ? col.render(item[col.key]) : String(item[col.key] ?? '')}
                </td>
              ))}
              <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--c-border)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                <button onClick={() => { setEditingItem(item); setShowForm(true); }}
                  style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', fontSize: font.sm, marginRight: 8 }}>{t("menu_edit")}</button>
                <button onClick={() => handleDelete(item.id)}
                  style={{ background: 'none', border: 'none', color: colors.danger, cursor: 'pointer', fontSize: font.sm }}>{t("menu_delete")}</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={columns.length + 1} style={{ padding: 24, textAlign: 'center', color: colors.textMuted }}>{t("config_no_data")}</td></tr>
          )}
        </tbody>
      </table>

      {showForm && type === 'ssh' && (
        <ConnectionForm connection={editingItem || undefined} onClose={() => { setShowForm(false); setEditingItem(null); }} onSaved={fetchData} />
      )}
      {showForm && type === 'db' && (
        <DbConnectionForm connection={editingItem || undefined} onClose={() => { setShowForm(false); setEditingItem(null); }} onSaved={fetchData} />
      )}
    </div>
  );
}
