export function shouldPersistLayout(currentSnapshot: string, persistedSnapshot: string): boolean {
  return currentSnapshot !== persistedSnapshot;
}
