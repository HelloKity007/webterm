declare module 'zmodem.js/src/zsession.js' {
  const Protocol: unknown;
  export default Protocol;
}
declare module 'zmodem.js/src/zmodem_browser.js' {
  const Zmodem: {
    Sentry: new (options: unknown) => unknown;
    Browser: {
      send_files: (session: unknown, files: File[]) => Promise<unknown>;
      save_to_disk: (payloads: unknown, name: string) => void;
    };
    Error: unknown;
  };
  export default Zmodem;
}
