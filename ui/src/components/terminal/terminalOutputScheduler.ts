type OutputJob = () => void;

const jobs = new Set<OutputJob>();
let scheduled = false;
let frame: number | null = null;

function requestFrame(callback: FrameRequestCallback): number {
  const root = globalThis as typeof globalThis & { requestAnimationFrame?: typeof requestAnimationFrame };
  if (typeof root.requestAnimationFrame === 'function') return root.requestAnimationFrame(callback);
  return globalThis.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(id: number) {
  const root = globalThis as typeof globalThis & { cancelAnimationFrame?: typeof cancelAnimationFrame };
  if (typeof root.cancelAnimationFrame === 'function') root.cancelAnimationFrame(id);
  else globalThis.clearTimeout(id);
}

function runNext() {
  scheduled = false;
  frame = null;
  const next = jobs.values().next().value as OutputJob | undefined;
  if (!next) return;
  jobs.delete(next);
  // A job may re-enqueue itself after its xterm write callback. Keeping only
  // one job per frame provides fair service across panels and protects the
  // browser from a burst of simultaneous xterm parses.
  next();
  if (jobs.size > 0) scheduleNext();
}

function scheduleNext() {
  if (scheduled || jobs.size === 0) return;
  scheduled = true;
  frame = requestFrame(runNext);
}

export function scheduleTerminalOutput(job: OutputJob) {
  jobs.add(job);
  scheduleNext();
}

export function cancelTerminalOutput(job: OutputJob) {
  jobs.delete(job);
  if (jobs.size === 0 && frame !== null) {
    cancelFrame(frame);
    frame = null;
    scheduled = false;
  }
}
