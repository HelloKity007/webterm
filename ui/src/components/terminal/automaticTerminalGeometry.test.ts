import { describe, expect, it, vi } from 'vitest';
import { createAutomaticTerminalGeometry } from './automaticTerminalGeometry';

describe('automatic terminal geometry', () => {
  const setup = () => {
    const send = vi.fn();
    let foreground = true;
    let visible = true;
    const geometry = createAutomaticTerminalGeometry(send, () => foreground && visible);
    return { send, geometry, foreground: (value: boolean) => { foreground = value; }, visible: (value: boolean) => { visible = value; } };
  };
  it('automatically fits a foreground connection, in resize-before-takeover order', () => {
    const { send, geometry } = setup();
    geometry.update({ cols: 150, rows: 40 });
    geometry.connect();
    expect(send.mock.calls.slice(-2).map(call => JSON.parse(call[0]))).toEqual([
      { cols: 150, rows: 40 }, { action: 'take_size_control' },
    ]);
  });
  it('keeps background and hidden clients passive until foreground activation', () => {
    const { send, geometry, foreground, visible } = setup();
    foreground(false);
    geometry.update({ cols: 150, rows: 40 });
    geometry.connect();
    geometry.activate();
    expect(send.mock.calls.some(call => call[0].includes('take_size_control'))).toBe(false);
    foreground(true); visible(false);
    geometry.activate();
    expect(send.mock.calls.some(call => call[0].includes('take_size_control'))).toBe(false);
    visible(true); geometry.activate();
    expect(JSON.parse(send.mock.lastCall![0])).toEqual({ action: 'take_size_control' });
  });
  it('does not fight remote updates; subsequent user activation can reclaim', () => {
    const { send, geometry } = setup();
    geometry.update({ cols: 150, rows: 40 }); geometry.connect();
    send.mockClear();
    geometry.observe({ cols: 100, rows: 30 });
    geometry.update({ cols: 150, rows: 40 });
    expect(send).not.toHaveBeenCalled();
    geometry.activate();
    expect(JSON.parse(send.mock.lastCall![0])).toEqual({ action: 'take_size_control' });
    send.mockClear();
    geometry.activate(); geometry.update({ cols: 150, rows: 40 });
    expect(send).not.toHaveBeenCalled();
  });
  it('fits changed local capacity and reconnects without a button', () => {
    const { send, geometry } = setup();
    geometry.update({ cols: 100, rows: 30 }); geometry.connect();
    send.mockClear();
    geometry.update({ cols: 180, rows: 50 });
    expect(send.mock.calls.map(call => JSON.parse(call[0]))).toEqual([
      { cols: 180, rows: 50 }, { action: 'take_size_control' },
    ]);
    geometry.disconnect(); send.mockClear(); geometry.activate();
    expect(send).not.toHaveBeenCalled();
    geometry.connect();
    expect(JSON.parse(send.mock.lastCall![0])).toEqual({ action: 'take_size_control' });
  });
});
