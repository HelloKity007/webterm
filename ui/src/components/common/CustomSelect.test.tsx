// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CustomSelect from './CustomSelect';
afterEach(cleanup);
it('exposes named combobox, selected options and keyboard activation with restored focus', () => {
  const change = vi.fn();
  render(<CustomSelect value="a" onChange={change}><option value="a">Alpha</option><option value="b">Beta</option></CustomSelect>);
  const control = screen.getByRole('combobox', { name: 'Alpha' });
  control.focus();
  expect(control.getAttribute('aria-expanded')).toBe('false');
  fireEvent.keyDown(control, { key: 'Enter' });
  expect(control.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('option', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(control, { key: 'ArrowDown' });
  expect(control.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Beta' }).id);
  fireEvent.keyDown(control, { key: ' ' });
  expect(change).toHaveBeenCalledWith('b');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(document.activeElement).toBe(control);
  fireEvent.keyDown(control, { key: 'ArrowUp' });
  expect(screen.getByRole('listbox')).toBeTruthy();
  fireEvent.keyDown(control, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(change).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(control);
});
it('closes on Tab or outside focus and keeps the next control reachable', () => {
  render(<><CustomSelect value="a" onChange={() => {}}><option value="a">Alpha</option></CustomSelect><button>Next</button></>);
  const control = screen.getByRole('combobox');
  fireEvent.keyDown(control, { key: ' ' });
  fireEvent.keyDown(control, { key: 'Tab' });
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.click(control);
  fireEvent.blur(control, { relatedTarget: screen.getByRole('button') });
  expect(screen.queryByRole('listbox')).toBeNull();
});
