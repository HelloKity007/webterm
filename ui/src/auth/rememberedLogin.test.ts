// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLegacyRememberedPassword,
  loadRememberedUsername,
  saveRememberedUsername,
} from './rememberedLogin';

describe('remembered login', () => {
  beforeEach(() => localStorage.clear());

  it('removes a legacy plaintext password while loading the username', () => {
    localStorage.setItem('webterm-rm-user', 'admin');
    localStorage.setItem('webterm-rm-pwd', 'plaintext-secret');

    expect(loadRememberedUsername()).toBe('admin');
    expect(localStorage.getItem('webterm-rm-pwd')).toBeNull();
  });

  it('remembers only the username', () => {
    localStorage.setItem('webterm-rm-pwd', 'plaintext-secret');

    saveRememberedUsername('operator', true);

    expect(localStorage.getItem('webterm-rm-user')).toBe('operator');
    expect(localStorage.getItem('webterm-rm-pwd')).toBeNull();
  });

  it('clears remembered login data without retaining the password', () => {
    localStorage.setItem('webterm-rm-user', 'operator');
    localStorage.setItem('webterm-rm-pwd', 'plaintext-secret');

    saveRememberedUsername('operator', false);
    clearLegacyRememberedPassword();

    expect(localStorage.getItem('webterm-rm-user')).toBeNull();
    expect(localStorage.getItem('webterm-rm-pwd')).toBeNull();
  });
});
