export interface TerminalRendererMetrics {
  mounts: number;
  disposes: number;
  webglActive: number;
  domActive: number;
  contextLosses: number;
}

const metrics: TerminalRendererMetrics = { mounts: 0, disposes: 0, webglActive: 0, domActive: 0, contextLosses: 0 };

function publish() {
  (window as unknown as { __webtermRendererMetrics?: TerminalRendererMetrics }).__webtermRendererMetrics = { ...metrics };
}

export function observeTerminalRenderer(element: HTMLElement) {
  let renderer: 'dom' | 'webgl' = 'dom';
  let disposed = false;
  metrics.mounts++;
  metrics.domActive++;
  element.dataset.renderer = renderer;
  element.dataset.contextLosses = '0';
  publish();

  return {
    webgl() {
      if (disposed || renderer === 'webgl') return;
      metrics.domActive--;
      metrics.webglActive++;
      renderer = 'webgl';
      element.dataset.renderer = renderer;
      publish();
    },
    contextLost() {
      if (disposed) return;
      metrics.contextLosses++;
      element.dataset.contextLosses = String(Number(element.dataset.contextLosses || 0) + 1);
      if (renderer === 'webgl') {
        metrics.webglActive--;
        metrics.domActive++;
        renderer = 'dom';
        element.dataset.renderer = renderer;
      }
      publish();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      metrics.disposes++;
      if (renderer === 'webgl') metrics.webglActive--;
      else metrics.domActive--;
      publish();
    },
  };
}

export function terminalRendererMetrics(): TerminalRendererMetrics {
  return { ...metrics };
}
