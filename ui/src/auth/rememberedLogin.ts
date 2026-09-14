const rememberedUsernameKey = 'webterm-rm-user';
const legacyRememberedPasswordKey = 'webterm-rm-pwd';

export function clearLegacyRememberedPassword(storage: Storage = localStorage): void {
  storage.removeItem(legacyRememberedPasswordKey);
}

export function loadRememberedUsername(storage: Storage = localStorage): string {
  clearLegacyRememberedPassword(storage);
  return storage.getItem(rememberedUsernameKey) || '';
}

export function saveRememberedUsername(
  username: string,
  remember: boolean,
  storage: Storage = localStorage,
): void {
  clearLegacyRememberedPassword(storage);
  if (remember) {
    storage.setItem(rememberedUsernameKey, username);
  } else {
    storage.removeItem(rememberedUsernameKey);
  }
}
