import ThemedTerminal from './ThemedTerminal';

interface MenuItem {
  label: string;
  action: () => void;
}

interface Props {
  connId: number;
  extraMenuItems?: MenuItem[];
  paneTabs?: import('../../store/layout').Tab[];
  myTabId?: string;
}

export default function TerminalTab({ connId, extraMenuItems, paneTabs, myTabId }: Props) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <ThemedTerminal connId={connId} extraMenuItems={extraMenuItems} tabs={paneTabs} myTabId={myTabId} />
    </div>
  );
}
