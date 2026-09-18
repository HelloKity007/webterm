import { describe, expect, it, vi } from 'vitest';
import Protocol from 'zmodem.js/src/zsession.js';
import source from '../../../node_modules/zmodem.js/src/zsession.js?raw';
import { isRecoverableZmodemCloseError, receiveZmodemDownload, type ZmodemDownloadOffer } from './zmodemDownload';

interface TestSession {
  set_sender: (send: (bytes: number[]) => void) => void;
  consume: (bytes: number[]) => void;
  on: (event: string, callback: (offer: ZmodemDownloadOffer) => void) => void;
  start: () => void;
  send_offer: (details: { name: string; size: number }) => Promise<{ end: (bytes: number[]) => Promise<void> }>;
  close: () => Promise<void>;
  abort: () => void;
}

describe('ZMODEM installed offer contract', () => {
  it('receives binary bytes through the actual installed Send/Receive protocol sessions', async () => {
    const { Session } = Protocol as { Session: { Receive: new () => TestSession; parse: (bytes: number[]) => TestSession } };
    const receiver = new Session.Receive();
    const sender = Session.parse(Array.from('**\x18B0100000023be50\r\n\x11', c => c.charCodeAt(0)));
    sender.set_sender(bytes => { queueMicrotask(() => receiver.consume(bytes)); });
    // The sender was created from ZRINIT already; start() emits that same first
    // header, so discard only that initialization duplicate.
    let first = true;
    receiver.set_sender(bytes => { if (first) { first = false; return; } queueMicrotask(() => sender.consume(bytes)); });
    const save = vi.fn();
    let receiving: Promise<void> | undefined;
    receiver.on('offer', offer => { receiving = receiveZmodemDownload(offer, save); });
    receiver.start();
      const transfer = await sender.send_offer({ name: 'real-library.bin', size: 4 });
      await transfer.end([0, 24, 128, 255]);
      await receiving;
      expect(save).toHaveBeenCalledWith([new Uint8Array([0, 24, 128, 255])], 'real-library.bin');
      await sender.close();
  });
  it('saves the payload array resolved by accept, without a nonexistent get_payloads method', async () => {
    expect(source).toContain('return this._accept_func(this._file_offset).then( this._get_spool.bind(this) );');
    expect(source).not.toContain('get_payloads(');
    const payloads = [new Uint8Array([0, 24, 128, 255])];
    const save = vi.fn();
    await receiveZmodemDownload({ accept: () => Promise.resolve(payloads), get_details: () => ({ name: 'binary.bin' }) }, save);
    expect(save).toHaveBeenCalledWith(payloads, 'binary.bin');
  });
  it('propagates receiving and saving failures for the terminal to display', async () => {
    await expect(receiveZmodemDownload({ accept: () => Promise.reject(new Error('receive failed')), get_details: () => ({ name: 'x' }) }, vi.fn())).rejects.toThrow('receive failed');
    await expect(receiveZmodemDownload({ accept: () => Promise.resolve([]), get_details: () => ({ name: 'x' }) }, () => { throw new Error('save failed'); })).rejects.toThrow('save failed');
  });
  it('recovers only the known post-ZFIN lrzsz interoperability close error', () => {
    expect(isRecoverableZmodemCloseError('PROTOCOL: Only thing after ZFIN should be “OO” (79,79), not: 81')).toBe(true);
    expect(isRecoverableZmodemCloseError(new Error('ZEOF offset mismatch'))).toBe(false);
    expect(isRecoverableZmodemCloseError(undefined)).toBe(false);
  });
});
