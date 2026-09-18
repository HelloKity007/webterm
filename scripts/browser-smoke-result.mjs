export function browserSmokeStatus(results, required = ['chromium', 'firefox', 'webkit']) {
  if (results.some(result => result.status === 'FAIL')) return 'FAIL';
  return required.every(browser => results.some(result => result.browser === browser && result.status === 'PASS'))
    ? 'PASS' : 'INCOMPLETE';
}
