import { useCallback, useState } from 'react';

export function readJson<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
}
export function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/** useState that remembers its value on this computer. */
export function useLocal<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => readJson(key, initial));
  const set = useCallback((n: T | ((p: T) => T)) => {
    setV((prev) => {
      const next = typeof n === 'function' ? (n as (p: T) => T)(prev) : n;
      writeJson(key, next);
      return next;
    });
  }, [key]);
  return [v, set] as const;
}
