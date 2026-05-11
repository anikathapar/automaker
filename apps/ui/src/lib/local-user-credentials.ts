/**
 * Browser-local storage for the last successful web login identity.
 * Intended for convenience and future sync (e.g. AWS); not a secure secret store.
 * Password is stored in plaintext in localStorage — acceptable only for local/dev use.
 */
const STORAGE_KEY = 'automaker-local-user-credentials';

export type LocalUserCredentials = {
  username: string;
  password: string;
};

export function getLocalUserCredentials(): LocalUserCredentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalUserCredentials>;
    if (typeof parsed.username === 'string' && parsed.username.length > 0) {
      const password = typeof parsed.password === 'string' ? parsed.password : '';
      return { username: parsed.username, password };
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

export function setLocalUserCredentials(credentials: LocalUserCredentials): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        username: credentials.username.trim(),
        password: credentials.password,
      })
    );
  } catch {
    // quota / private mode
  }
}

export function clearLocalUserCredentials(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
