import { apiFetch } from '../../api/client';

export interface WheelDebugEvent {
  client_t: number; delta_x: number; delta_y: number; delta_mode: number; dt_ms: number;
  shift: boolean; ctrl: boolean; alt: boolean; meta: boolean; trusted: boolean;
  alternate: boolean; term_mode: string; route: string; gate: string; emit_path: string;
  terminal_id: string; workspace: number; panel: number; platform: string;
}

export interface WheelDebugRecorder {
  begin(event: WheelEvent, context: { alternate: boolean; termMode: string }): void;
  finish(route: string): void;
  emitted(path: string): void;
  dispose(): void;
}

export function createWheelDebugRecorder(terminalID: string, workspace: number, panel: number): WheelDebugRecorder {
  let pending: WheelDebugEvent | null = null;
  let previousTime: number | null = null;
  let queue: WheelDebugEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let disposed = false;
  let sending = false;
  const flush = () => {
    if (disposed || sending || queue.length === 0) return;
    const batch = queue;
    queue = [];
    sending = true;
    void apiFetch('/api/diag/wheel', { method: 'POST', body: JSON.stringify(batch), keepalive: true }).then((response) => {
      sending = false;
      if (!response.ok && ++failures >= 3) disposed = true;
    }).catch(() => {
      sending = false;
      if (++failures >= 3) disposed = true;
    });
  };
  const schedule = () => {
    if (timer !== null || disposed) return;
    timer = setTimeout(() => { timer = null; flush(); }, 1500);
  };
  return {
    begin(event, context) {
      if (disposed) return;
      const time = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
      pending = {
        client_t: time, delta_x: event.deltaX, delta_y: event.deltaY, delta_mode: event.deltaMode,
        dt_ms: previousTime === null ? 0 : time - previousTime,
        shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey,
        trusted: event.isTrusted, alternate: context.alternate, term_mode: context.termMode,
        route: '', gate: 'unknown', emit_path: '', terminal_id: terminalID,
        workspace, panel, platform: navigator.platform || 'unknown',
      };
      previousTime = time;
    },
    finish(route) {
      if (!pending || disposed) return;
      pending.route = route;
      if (pending.gate !== 'emitted') {
        pending.gate = route === 'intercepted' ? 'suppressed' : 'passthrough';
      }
      queue.push(pending);
      if (queue.length >= 20) flush(); else schedule();
      pending = null;
    },
    emitted(path) {
      if (pending) { pending.gate = 'emitted'; pending.emit_path = path; }
    },
    dispose() {
      if (disposed) return;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      flush();
      disposed = true;
    },
  };
}
