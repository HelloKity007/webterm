export function takeTerminalOutput(queue: Uint8Array[], budget: number): Uint8Array {
  if (budget < 1 || queue.length === 0) return new Uint8Array();
  const selected: Uint8Array[] = [];
  let total = 0;
  while (queue.length > 0 && total < budget) {
    const chunk = queue.shift()!;
    const remaining = budget - total;
    if (chunk.byteLength > remaining) {
      selected.push(chunk.subarray(0, remaining));
      queue.unshift(chunk.subarray(remaining));
      total += remaining;
      break;
    }
    selected.push(chunk);
    total += chunk.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of selected) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
