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
  workspaceIndex?: number;
  panelNumber?: number;
}

export default function TerminalTab({ connId, extraMenuItems, paneTabs, myTabId, workspaceIndex, panelNumber }: Props) {
  return (
    <div className="terminal-tab-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <ThemedTerminal connId={connId} extraMenuItems={extraMenuItems} tabs={paneTabs} myTabId={myTabId} workspaceIndex={workspaceIndex} panelNumber={panelNumber} />
    </div>
  );
}
