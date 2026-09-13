/** Reorder existing objects without changing session identity or label numbers. */
export function reorderTabs<T extends { id: string }>(tabs: T[], sourceId: string, targetId: string, after: boolean): T[] {
  if (sourceId === targetId) return tabs;
  const source = tabs.find((tab) => tab.id === sourceId);
  if (!source || !tabs.some((tab) => tab.id === targetId)) return tabs;
  const next = tabs.filter((tab) => tab.id !== sourceId);
  next.splice(next.findIndex((tab) => tab.id === targetId) + Number(after), 0, source);
  return next.every((tab, index) => tab === tabs[index]) ? tabs : next;
}
