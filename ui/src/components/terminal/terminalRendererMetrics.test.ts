// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { observeTerminalRenderer, terminalRendererMetrics } from './terminalRendererMetrics';

describe('terminal renderer observation', () => {
  it('records WebGL fallback and balanced disposal', () => {
    const before = terminalRendererMetrics();
    const element = document.createElement('div');
    const observation = observeTerminalRenderer(element);
    expect(element.dataset.renderer).toBe('dom');
    observation.webgl();
    expect(element.dataset.renderer).toBe('webgl');
    observation.contextLost();
    expect(element.dataset.renderer).toBe('dom');
    expect(element.dataset.contextLosses).toBe('1');
    observation.dispose();
    const after = terminalRendererMetrics();
    expect(after.mounts - before.mounts).toBe(1);
    expect(after.disposes - before.disposes).toBe(1);
    expect(after.contextLosses - before.contextLosses).toBe(1);
    expect(after.webglActive).toBe(before.webglActive);
    expect(after.domActive).toBe(before.domActive);
  });
});
