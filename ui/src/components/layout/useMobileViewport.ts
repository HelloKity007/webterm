import { useEffect, useRef } from 'react';
import { isMobileBrowserEnvironment } from './mobileLayout';

/** Keep the app inside the visible viewport when a keyboard pans/resizes it.
 * Scroll only the document back, never the terminal's history container. */
export function useMobileViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !isMobileBrowserEnvironment()) return;
    const viewport = window.visualViewport;
    let frame = 0;
    let timers: number[] = [];
    const update = () => {
      frame = 0;
      // Preserve intentional pinch zoom and its pan position.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
      element.style.setProperty('--mobile-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      element.style.setProperty('--mobile-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const settle = () => {
      timers.forEach(clearTimeout);
      schedule();
      // Some mobile browsers finish keyboard panning after focusout.
      timers = [100, 350, 700].map(delay => window.setTimeout(schedule, delay));
    };
    element.dataset.mobileViewport = 'true';
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule);
    document.addEventListener('focusin', settle);
    document.addEventListener('focusout', settle);
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(clearTimeout);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
      document.removeEventListener('focusin', settle);
      document.removeEventListener('focusout', settle);
      delete element.dataset.mobileViewport;
      element.style.removeProperty('--mobile-viewport-height');
      element.style.removeProperty('--mobile-viewport-top');
    };
  }, []);
  return ref;
}
