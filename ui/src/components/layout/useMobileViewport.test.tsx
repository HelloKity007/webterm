// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useMobileViewport } from './useMobileViewport';

function Fixture() {
  const ref = useMobileViewport();
  return <div ref={ref} data-testid="shell"><div data-testid="history" /></div>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('restores height and document offset after keyboard close without scrolling history', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android Mobile');
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const { unmount } = render(<Fixture />);
  const shell = screen.getByTestId('shell'), history = screen.getByTestId('history');
  history.scrollTop = 123;
  expect(shell.style.getPropertyValue('--mobile-viewport-height')).toBe('844px');
  viewport.height = 410;
  viewport.offsetTop = 120;
  viewport.dispatchEvent(new Event('resize'));
  await waitFor(() => expect(shell.style.getPropertyValue('--mobile-viewport-height')).toBe('410px'));
  expect(shell.style.getPropertyValue('--mobile-viewport-top')).toBe('120px');
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(120);
  viewport.height = 844;
  viewport.offsetTop = 0;
  viewport.dispatchEvent(new Event('resize'));
  document.dispatchEvent(new Event('focusout'));
  await waitFor(() => expect(shell.style.getPropertyValue('--mobile-viewport-height')).toBe('844px'));
  expect(shell.style.getPropertyValue('--mobile-viewport-top')).toBe('0px');
  expect(scroll).toHaveBeenCalledWith(0, 0);
  expect(history.scrollTop).toBe(123);
  unmount();
  expect(shell.dataset.mobileViewport).toBeUndefined();
});

it('leaves desktop layout unchanged', () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Desktop Chrome');
  render(<Fixture />);
  expect(screen.getByTestId('shell').dataset.mobileViewport).toBeUndefined();
});

it('does not reset deliberate pinch zoom', () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android Mobile');
  vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 422, offsetTop: 50, scale: 2 }));
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(<Fixture />);
  expect(scroll).not.toHaveBeenCalled();
  expect(screen.getByTestId('shell').style.getPropertyValue('--mobile-viewport-height')).toBe('');
});
