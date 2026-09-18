export interface ZmodemDownloadOffer {
  accept: () => Promise<Uint8Array[]>;
  get_details: () => { name: string };
}

// zmodem.js Offer.accept resolves its spooled payloads; there is no public
// get_payloads method. Leave failures rejected so the caller can show them.
export async function receiveZmodemDownload(
  offer: ZmodemDownloadOffer,
  save: (payloads: Uint8Array[], name: string) => void,
) {
  const payloads = await offer.accept();
  save(payloads, offer.get_details().name);
}

// lrzsz's sz may send ordinary shell output immediately after the peer ZFIN,
// without the optional final "OO" bytes that zmodem.js waits for. At that
// exact point the protocol has already completed; keeping its sentry active
// would consume the next shell prompt forever. Do not use this for transfer or
// checksum errors: only the library's documented post-ZFIN parser failure is
// safe to hand back to the terminal.
export function isRecoverableZmodemCloseError(error: unknown) {
  return String(error).includes('PROTOCOL: Only thing after ZFIN should be');
}
