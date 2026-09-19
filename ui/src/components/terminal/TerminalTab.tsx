import ThemedTerminal from './ThemedTerminal';

interface MenuItem {
  label: string;
  action: () => void;
}

interface Props {
  connId: number;
  extraMenuItems?: MenuItem[];
  myTabId?: string;
  workspaceIndex?: number;
  panelNumber?: number;
  onDismissUnverified?: () => void;
  onCreateSafeTerminal?: () => Promise<void>;
  onIdentityGuardChange?: (guarded: boolean) => void;
}

export default function TerminalTab({ connId, extraMenuItems, myTabId, workspaceIndex, panelNumber, onDismissUnverified, onCreateSafeTerminal, onIdentityGuardChange }: Props) {
  return (
    <div className="terminal-tab-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      <ThemedTerminal connId={connId} extraMenuItems={extraMenuItems} myTabId={myTabId} workspaceIndex={workspaceIndex} panelNumber={panelNumber} onDismissUnverified={onDismissUnverified} onCreateSafeTerminal={onCreateSafeTerminal} onIdentityGuardChange={onIdentityGuardChange} />
    </div>
  );
}
