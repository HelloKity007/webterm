import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserSmokeStatus } from './browser-smoke-result.mjs';
test('all required engines must pass', () => {
  const passing = ['chromium', 'firefox', 'webkit'].map(browser => ({ browser, status: 'PASS' }));
  assert.equal(browserSmokeStatus(passing), 'PASS');
  assert.equal(browserSmokeStatus(passing.slice(0, 1)), 'INCOMPLETE');
  assert.equal(browserSmokeStatus([...passing.slice(0, 2), { browser: 'webkit', status: 'NOT_RUN' }]), 'INCOMPLETE');
  assert.equal(browserSmokeStatus([...passing.slice(0, 2), { browser: 'webkit', status: 'FAIL' }]), 'FAIL');
  assert.equal(browserSmokeStatus([]), 'INCOMPLETE');
});
