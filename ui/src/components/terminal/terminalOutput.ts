export interface TerminalWriter {
  write: (data: Uint8Array) => void;
}

export interface ZmodemSentry {
  consume: (data: Uint8Array) => void;
}

// The SSH backend can emit tmux's initial redraw immediately after the socket
// opens.  That must still be rendered while the optional ZMODEM layer starts.
export function deliverTerminalBytes(
  terminal: TerminalWriter,
  sentry: ZmodemSentry | null,
  bytes: Uint8Array,
) {
  if (sentry) {
    sentry.consume(bytes);
    return;
  }
  terminal.write(bytes);
}
