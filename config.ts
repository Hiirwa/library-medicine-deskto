/** The server the app talks to until the person chooses another one on the sign-in screen. */
export const DEFAULT_SERVER = 'https://librarymedicine.online';

/** Tidy what was typed: trim, add https:// when missing, drop trailing slashes. Empty input means the default. */
export function normaliseServer(input: string): string {
  let s = input.trim();
  if (!s) return DEFAULT_SERVER;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  return s.replace(/\/+$/, '');
}
