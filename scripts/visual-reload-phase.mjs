export async function visualReloadPhase(page) {
  const phase = process.env.WEBTERM_QA_RELOAD || 'fresh';
  if (phase === 'fresh') return;
  if (!['normal', 'hard'].includes(phase)) throw new Error(`Unknown reload phase: ${phase}`);
  if (phase === 'hard') {
    const session = await page.context().newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.reload({ waitUntil: 'networkidle' });
    await session.detach();
  } else await page.reload({ waitUntil: 'networkidle' });
}

export function terminalVisibleBounds(element) {
  const screen = element.querySelector('.xterm-screen').getBoundingClientRect();
  const surface = element.getBoundingClientRect();
  const nativeBar = element.querySelector('.scrollbar.vertical').getBoundingClientRect();
  const edge = element.classList.contains('desktop-local-viewport') ? surface.left + element.clientWidth : nativeBar.left;
  return { rightGap: edge - screen.right, bottomGap: surface.top + element.clientHeight - screen.bottom };
}
