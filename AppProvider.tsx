import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { syncNow, type SyncProgress, type SyncSummary } from '../lib/sync';
import type { Me } from '../lib/types';
import { useNetwork } from '../hooks/useNetwork';
import { DEFAULT_SERVER } from '../lib/config';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false, networkMode: 'always' }, mutations: { networkMode: 'always' } },
});

type Stage = 'loading' | 'login' | 'token' | 'app';

interface Session {
  stage: Stage;
  server: string;
  user: Me | null;
  online: boolean;
  syncing: boolean;
  progress: SyncProgress | null;
  lastSync: string | null;
  lastResult: { ok: boolean; summary?: SyncSummary; error?: string } | null;
  setLoggedIn: (server: string, user: Me) => Promise<void>;
  setTokenSaved: () => Promise<void>;
  sync: (opts?: { quiet?: boolean }) => Promise<void>;
  signOut: (opts?: { keepData?: boolean }) => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'error') => void;
  toasts: { id: number; msg: string; kind: 'ok' | 'error' }[];
  dismissToast: (id: number) => void;
  settings: Settings;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
}

export interface Settings {
  /** minutes between automatic syncs while online; 0 = off */
  autoSyncMin: number;
  /** sync as soon as the app starts (and when the connection comes back) */
  syncOnStart: boolean;
  /** download attachments for offline use during sync */
  downloadFiles: boolean;
}
const DEFAULT_SETTINGS: Settings = { autoSyncMin: 5, syncOnStart: true, downloadFiles: true };

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside AppProvider');
  return c;
};


function Inner({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<Stage>('loading');
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [user, setUser] = useState<Me | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<Session['lastResult']>(null);
  const [toasts, setToasts] = useState<Session['toasts']>([]);
  const net = useNetwork();
  const wasOnline = useRef<boolean | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  // start-up: where were we?
  useEffect(() => {
    (async () => {
      await native.workspace().catch(() => null); // creates Documents\Library Medicine on first start
      const s = (await store.kvGet('server')) ?? DEFAULT_SERVER;
      setServer(await native.setServer(s).catch(() => DEFAULT_SERVER));
      const u = await store.kvGet('user');
      setLastSync(await store.kvGet('last_sync_ok'));
      try { setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse((await store.kvGet('settings')) ?? '{}') }); } catch { /* defaults */ }
      if (!u) return setStage('login');
      setUser(JSON.parse(u) as Me);
      setStage((await native.hasToken().catch(() => false)) ? 'app' : 'token');
    })();
  }, []);

  const sync = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (syncing) return;
    setSyncing(true);
    setProgress({ stage: 'pushing', message: 'Starting sync…' });
    try {
      const summary = await syncNow(setProgress, { downloadFiles: settings.downloadFiles });
      setLastResult({ ok: summary.rejected === 0, summary });
      setLastSync(new Date().toISOString());
      if (!opts.quiet || summary.pushed || summary.pulled || summary.rejected) {
        toast(summary.rejected ? `Synced, but ${summary.rejected} change${summary.rejected === 1 ? ' was' : 's were'} refused — see the marked records.` : `Synced: ${summary.pushed} sent, ${summary.pulled} received.`, summary.rejected ? 'error' : 'ok');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResult({ ok: false, error: msg });
      if (/401|token|authori/i.test(msg)) toast('Your API token was refused. Add a new token in Settings.', 'error');
      else if (!opts.quiet) toast(`Sync failed: ${msg}. Your changes stay saved on this computer.`, 'error');
    } finally {
      setSyncing(false);
      setProgress(null);
      await queryClient.invalidateQueries();
    }
  }, [syncing, toast, settings.downloadFiles]);

  // back online → sync straight away; then every 5 minutes while online
  useEffect(() => {
    if (stage !== 'app') return;
    if (net.online && wasOnline.current === false && settings.syncOnStart) sync({ quiet: true });
    if (net.online && wasOnline.current === null && settings.syncOnStart) sync({ quiet: true });
    wasOnline.current = net.online;
  }, [net.online, stage, sync, settings.syncOnStart]);
  useEffect(() => {
    if (stage !== 'app' || !settings.autoSyncMin) return;
    const t = setInterval(() => { if (net.online) sync({ quiet: true }); }, settings.autoSyncMin * 60 * 1000);
    return () => clearInterval(t);
  }, [net.online, stage, sync, settings.autoSyncMin]);

  const setSetting = useCallback(async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((cur) => {
      const next = { ...cur, [key]: value };
      store.kvSet('settings', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const setLoggedIn = useCallback(async (srv: string, u: Me) => {
    await store.kvSet('server', srv);
    await store.kvSet('user', JSON.stringify(u));
    setServer(srv);
    setUser(u);
    setStage((await native.hasToken()) ? 'app' : 'token');
  }, []);

  const setTokenSaved = useCallback(async () => { setStage('app'); }, []);

  const signOut = useCallback(async (opts: { keepData?: boolean } = {}) => {
    await native.secureDelete('api_token');
    if (!opts.keepData) {
      const chosen = await store.kvGet('server'); // a server the person chose themselves survives signing out
      await store.wipe(); await store.kvSet('settings', JSON.stringify(settings));
      if (chosen && chosen !== DEFAULT_SERVER) await store.kvSet('server', chosen);
    }
    else { await store.kvDel('user'); }
    setUser(null);
    setStage('login');
    await queryClient.invalidateQueries();
  }, [settings]);

  const value = useMemo<Session>(() => ({ stage, server, user, online: net.online, syncing, progress, lastSync, lastResult, setLoggedIn, setTokenSaved, sync, signOut, toast, toasts, dismissToast, settings, setSetting }),
    [stage, server, user, net.online, syncing, progress, lastSync, lastResult, setLoggedIn, setTokenSaved, sync, signOut, toast, toasts, dismissToast, settings, setSetting]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Inner>{children}</Inner>
    </QueryClientProvider>
  );
}
