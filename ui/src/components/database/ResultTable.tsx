import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { colors, font } from '../../theme/tokens';

interface Props {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected?: number;
  onExportCSV: () => void;
}

const PAGE_SIZE = 100;

export default function ResultTable({ columns, rows, rowsAffected, onExportCSV }: Props) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const sortedRows = useMemo(() => {
    if (!sortCol) return rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sortedRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
    setPage(0);
  };

  if (columns.length === 0 && rowsAffected !== undefined) {
    return (
      <div style={{ padding: 12, color: colors.textLight, fontSize: font.md }}>
        查询成功:{t("db_affected")} {rowsAffected}
      </div>
    );
  }

  const btnStyle = { background: colors.border, border: 'none', color: colors.white, padding: '2px 10px', borderRadius: 3, cursor: 'pointer', fontSize: font.xs };
  const btnDisabled = { ...btnStyle, opacity: 0.4, cursor: 'default' };

  return (
    <div style={{ fontSize: font.sm, overflow: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: colors.bgBar, alignItems: 'center' }}>
        <span style={{ color: colors.textLight }}>{rows.length} {t("db_rows")} {columns.length} {t("db_cols")}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}
            style={safePage === 0 ? btnDisabled : btnStyle}>{t("db_prev")}</button>
          <span style={{ color: colors.textLight, fontSize: font.sm }}>{safePage + 1}/{totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
            style={safePage >= totalPages - 1 ? btnDisabled : btnStyle}>{t("db_next")}</button>
          <button onClick={onExportCSV} style={{
            background: colors.info, border: 'none', color: colors.white, padding: '2px 10px', borderRadius: 3, cursor: 'pointer', fontSize: font.xs,
          }}>{t("db_export")}</button>
        </span>
      </div>
      <div style={{ overflow: 'auto', maxHeight: '300px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: font.sm }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col} onClick={() => toggleSort(col)} style={{
                  padding: '4px 8px', background: colors.bgHeader, color: colors.accent,
                  borderBottom: '1px solid var(--c-border)', textAlign: 'left', whiteSpace: 'nowrap',
                  position: 'sticky', top: 0, zIndex: 1, cursor: 'pointer', userSelect: 'none',
                }}>{col}{sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? colors.bgDeep : colors.bgRaised }}>
                {columns.map((col) => (
                  <td key={col} style={{
                    padding: '2px 8px', color: colors.textLight, borderBottom: '1px solid var(--c-bg-bar)',
                    whiteSpace: 'nowrap', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {row[col] === null ? <span style={{ color: colors.textDim }}>NULL</span> : String(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
