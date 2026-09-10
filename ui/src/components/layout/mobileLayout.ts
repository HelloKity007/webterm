const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

/** Browser-identity detection keeps a narrow desktop window from becoming
 * mobile accidentally; the mobile layout is intended for phone/tablet UAs. */
export function isMobileBrowser(userAgent: string): boolean {
  return mobileUserAgent.test(userAgent);
}

export function isMobileBrowserEnvironment(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ can identify itself as Macintosh while still exposing touch.
  const ipadDesktopUA = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isMobileBrowser(navigator.userAgent) || ipadDesktopUA;
}
