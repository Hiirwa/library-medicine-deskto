import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as store from '../lib/db';
import { native } from '../lib/native';
import { checkRemote, DeviceRevokedError, syncNow, type SyncProgress, type SyncScope, type SyncSummary } from '../lib/sync';
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
  /** live sync: 'live' = watching the website, 'paused' = offline/off, 'unsupported' = older server (timer only) */
  live: 'live' | 'paused' | 'unsupported';
  lastCheck: string | null;
  /** set when the website disconnected this computer (Account → Devices) */
  revoked: string | null;
  retryConnection: () => Promise<void>;
}

export interface Settings {
  /** minutes between automatic syncs while online; 0 = off */
  autoSyncMin: number;
  /** sync as soon as the app starts (and when the connection comes back) */
  syncOnStart: boolean;
  /** download attachments for offline use during sync */
  downloadFiles: boolean;
  /** watch the website every few seconds and send local changes straight away */
  liveSync: boolean;
  /** 'team': every record of projects where the role sees all data; 'own': only records I submitted */
  syncScope: SyncScope;
  /** seconds between two checks of the website while live sync is on */
  liveEverySec: number;
  /** record editor: 'website' = the website's own form, 'classic' = the compact desktop editor */
  formStyle: 'website' | 'classic';
}
const DEFAULT_SETTINGS: Settings = { autoSyncMin: 5, syncOnStart: true, downloadFiles: true, liveSync: true, syncScope: 'team', liveEverySec: 15, formStyle: 'website' };

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
  const [live, setLive] = useState<Session['live']>('paused');
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<string | null>(null);

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
      const summary = await syncNow(setProgress, { downloadFiles: settings.downloadFiles, scope: settings.syncScope });
      setRevoked(null);
      setLastResult({ ok: summary.rejected === 0, summary });
      setLastSync(new Date().toISOString());
      setLastCheck(new Date().toISOString());
      if (summary.serverWins) toast(`${summary.serverWins} record${summary.serverWins === 1 ? ' was' : 's were'} changed more recently on the website. Your version is kept under Sync centre → Conflicts.`, 'error');
      if (summary.rejected) toast(`Synced, but ${summary.rejected} change${summary.rejected === 1 ? ' was' : 's were'} refused — see the marked records.`, 'error');
      else if (opts.quiet && !summary.pushed && summary.pulled) toast(`${summary.pulled} update${summary.pulled === 1 ? '' : 's'} arrived from ${new URL(server).host}.`);
      else if (!opts.quiet || summary.pushed || summary.pulled || summary.purged) toast(`Synced: ${summary.pushed} sent, ${summary.pulled} received${summary.purged ? `, ${summary.purged} removed` : ''}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastResult({ ok: false, error: msg });
      if (e instanceof DeviceRevokedError) { setRevoked(msg); setLive('paused'); }
      else if (/401|token|authori/i.test(msg)) toast('Your API token was refused. Add a new token in Settings.', 'error');
      else if (!opts.quiet) toast(`Sync failed: ${msg}. Your changes stay saved on this computer.`, 'error');
    } finally {
      setSyncing(false);
      setProgress(null);
      await queryClient.invalidateQueries();
    }
  }, [syncing, toast, settings.downloadFiles, settings.syncScope, server]);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const syncingRef = useRef(syncing);
  syncingRef.current = syncing;

  // back online → sync straight away; then every 5 minutes while online
  useEffect(() => {
    if (stage !== 'app') return;
    if (net.online && wasOnline.current === false && settings.syncOnStart) syncRef.current({ quiet: true });
    if (net.online && wasOnline.current === null && settings.syncOnStart) syncRef.current({ quiet: true });
    wasOnline.current = net.online;
  }, [net.online, stage, settings.syncOnStart]);
  useEffect(() => {
    if (stage !== 'app' || !settings.autoSyncMin || revoked) return;
    const t = setInterval(() => { if (net.online) syncRef.current({ quiet: true }); }, settings.autoSyncMin * 60 * 1000);
    return () => clearInterval(t);
  }, [net.online, stage, settings.autoSyncMin, revoked]);

  // live sync, part 1: ask the website every few seconds whether anything changed (one tiny request), sync when it did
  useEffect(() => {
    if (stage !== 'app' || !settings.liveSync || !net.online || revoked) { setLive((l) => (l === 'unsupported' ? l : 'paused')); return; }
    let stop = false;
    let busy = false;
    setLive((l) => (l === 'unsupported' ? l : 'live'));
    const check = async () => {
      if (stop || busy || syncingRef.current || document.hidden) return;
      busy = true;
      try {
        const r = await checkRemote(settings.syncScope);
        setLastCheck(new Date().toISOString());
        if (r === 'unsupported') { setLive('unsupported'); stop = true; return; }
        if (r === 'changed') await syncRef.current({ quiet: true });
      } catch (e) {
        if (e instanceof DeviceRevokedError) { setRevoked(e.message); stop = true; }
      } finally { busy = false; }
    };
    const t = setInterval(check, Math.max(5, settings.liveEverySec) * 1000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { stop = true; clearInterval(t); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [stage, settings.liveSync, settings.liveEverySec, settings.syncScope, net.online, revoked]);

  // live sync, part 2: what is saved on this computer is sent a few seconds later (several quick saves → one sync)
  useEffect(() => {
    if (stage !== 'app' || !settings.liveSync || revoked) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(t);
      t = setTimeout(() => { if (net.online) syncRef.current({ quiet: true }); }, 3000);
    };
    window.addEventListener('lm-local-change', onChange);
    return () => { clearTimeout(t); window.removeEventListener('lm-local-change', onChange); };
  }, [stage, settings.liveSync, net.online, revoked]);

  const retryConnection = useCallback(async () => {
    setRevoked(null);
    await syncRef.current();
  }, []);

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

  const value = useMemo<Session>(() => ({ stage, server, user, online: net.online, syncing, progress, lastSync, lastResult, setLoggedIn, setTokenSaved, sync, signOut, toast, toasts, dismissToast, settings, setSetting, live, lastCheck, revoked, retryConnection }),
    [stage, server, user, net.online, syncing, progress, lastSync, lastResult, setLoggedIn, setTokenSaved, sync, signOut, toast, toasts, dismissToast, settings, setSetting, live, lastCheck, revoked, retryConnection]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Inner>{children}</Inner>
    </QueryClientProvider>
  );
}
