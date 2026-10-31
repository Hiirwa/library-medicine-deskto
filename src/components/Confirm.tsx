import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from './ui';
import * as store from '../lib/db';
import { bytes, plural } from '../lib/format';
import { useSession } from '../providers/AppProvider';

export type Kind = 'info' | 'warning' | 'danger' | 'success';
export interface Btn { id: string; label: string; tone?: 'primary' | 'danger' | 'plain'; icon?: string }
export interface Check { id: string; label: string; hint?: string; checked?: boolean }
export interface ChooseOpts { title: string; message: ReactNode; kind?: Kind; icon?: string; details?: ReactNode; checks?: Check[]; buttons: Btn[] }
export interface Choice { id: string; checks: Record<string, boolean> }
interface AskOpts { title?: string; kind?: 'info' | 'warning' | 'error'; okLabel?: string; cancelLabel?: string; icon?: string; details?: ReactNode }

interface Api { choose: (o: ChooseOpts) => Promise<Choice>; ask: (message: ReactNode, o?: AskOpts) => Promise<boolean> }
const Ctx = createContext<Api | null>(null);
export function useConfirm(): Api { const c = useContext(Ctx); if (!c) throw new Error('useConfirm outside ConfirmProvider'); return c; }
/** Drop-in replacement for the native Windows question box: `if (await ask('Delete?', { title, okLabel }))`. */
export const useAsk = () => useConfirm().ask;

const ICON: Record<Kind, string> = { info: 'info-circle-fill', warning: 'exclamation-triangle-fill', danger: 'trash3-fill', success: 'check-circle-fill' };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ o: ChooseOpts; done: (c: Choice) => void } | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const box = useRef<HTMLDivElement>(null);

  const choose = useCallback((o: ChooseOpts) => new Promise<Choice>((resolve) => {
    setChecks(Object.fromEntries((o.checks ?? []).map((c) => [c.id, !!c.checked])));
    setState({ o, done: resolve });
  }), []);
  const ask = useCallback<Api['ask']>(async (message, o = {}) => {
    const destructive = /delete|discard|sign out|remove|replace/i.test(`${o.okLabel ?? ''}`);
    const kind: Kind = o.kind === 'error' ? 'danger' : o.kind === 'warning' ? (destructive ? 'danger' : 'warning') : 'info';
    const r = await choose({ title: o.title ?? 'Please confirm', message, kind, icon: o.icon, details: o.details,
      buttons: [{ id: 'cancel', label: o.cancelLabel ?? 'Cancel' }, { id: 'ok', label: o.okLabel ?? 'OK', tone: destructive ? 'danger' : 'primary' }] });
    return r.id === 'ok';
  }, [choose]);

  const close = useCallback((id: string) => { setState((s) => { s?.done({ id, checks }); return null; }); }, [checks]);

  // Esc cancels; Tab stays inside the dialog
  useEffect(() => {
    if (!state) return;
    const prev = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('cancel'); }
      if (e.key === 'Tab' && box.current) {
        const f = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled), input')]; if (!f.length) return;
        const first = f[0]; const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', k, true);
    return () => { window.removeEventListener('keydown', k, true); prev?.focus?.(); };
  }, [state, close]);

  const api = useMemo(() => ({ choose, ask }), [choose, ask]);
  const o = state?.o; const kind = o?.kind ?? 'info';
  // keyboard default: the safest button (Cancel) when something is destructive, otherwise the primary one
  const dflt = o ? (o.buttons.some((b) => b.tone === 'danger') ? o.buttons.find((b) => b.id === 'cancel') ?? o.buttons[0] : o.buttons.find((b) => b.tone === 'primary') ?? o.buttons[0]) : null;

  return (
    <Ctx.Provider value={api}>
      {children}
      {o && (
        <div className="overlay" style={{ zIndex: 80 }} onMouseDown={(e) => { if (e.target === e.currentTarget) close('cancel'); }}>
          <div ref={box} className="dialog confirm" role="alertdialog" aria-modal="true" aria-labelledby="cf-t" aria-describedby="cf-d">
            <div className="cf-head"><span className={`cf-ic ${kind}`}><Icon name={o.icon ?? ICON[kind]} /></span>
              <div className="min-w-0"><h2 id="cf-t">{o.title}</h2><div id="cf-d" className="cf-msg">{o.message}</div></div></div>
            {o.details && <div className="cf-details">{o.details}</div>}
            {(o.checks ?? []).map((c) => (
              <label key={c.id} className="cf-check"><input type="checkbox" className="accent-[var(--rh-brand)]" checked={!!checks[c.id]} onChange={(e) => setChecks({ ...checks, [c.id]: e.target.checked })} />
                <span><b className="ink block">{c.label}</b>{c.hint && <small className="muted">{c.hint}</small>}</span></label>
            ))}
            <div className="cf-actions">
              {o.buttons.map((b) => (
                <button key={b.id} type="button" autoFocus={b.id === dflt?.id} className={`btn ${b.tone === 'primary' ? 'btn-primary' : b.tone === 'danger' ? 'btn-danger-solid' : ''}`} onClick={() => close(b.id)}>
                  {b.icon && <Icon name={b.icon} />}{b.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** What signing out removes from this computer, with live numbers. */
export function SignOutDetails() {
  const s = useQuery({ queryKey: ['storage'], queryFn: store.storageStats });
  const pending = useQuery({ queryKey: ['pending'], queryFn: store.outboxCount });
  const d = s.data; const n = pending.data ?? 0;
  const rows: [string, string, string][] = [
    ['key', 'Access token', 'Removed from the Windows Credential Manager'],
    ['database', d ? plural(d.records, 'record') : 'Records', d ? `in ${plural(d.projects, 'project')} — removed from this computer` : 'removed from this computer'],
    ['paperclip', d ? plural(d.files, 'attachment') : 'Attachments', d ? `${bytes(d.offlineBytes)} offline — removed from this computer` : 'removed from this computer'],
  ];
  return (
    <div className="space-y-2">
      {rows.map(([ic, t, sub]) => <div key={t} className="cf-row"><span className="ic-sm"><Icon name={ic} /></span><span className="min-w-0"><b className="ink block">{t}</b><small className="muted">{sub}</small></span></div>)}
      {n > 0 && <div className="notice warn"><Icon name="send-exclamation" /><span><b>{plural(n, 'record')}</b> not sent to the server yet. They are lost if you sign out without keeping your offline data.</span></div>}
      <p className="help"><Icon name="cloud-check" className="mr-1" />Your data on librarymedicine.online is not affected.</p>
    </div>
  );
}

/** One sign-out flow for the menu and Settings: warns about unsent records, offers “Sync first” and “Keep my offline data”. */
export function useSignOut() {
  const { choose } = useConfirm();
  const { signOut, sync } = useSession();
  return useCallback(async () => {
    const n = await store.outboxCount();
    const keepCheck: Check = { id: 'keep', label: 'Keep my offline data on this computer', hint: 'Only your access is removed. Signing in again will not download everything again.' };
    if (n > 0) {
      const r = await choose({ title: 'Some changes are not sent yet', kind: 'warning', icon: 'send-exclamation', message: `${plural(n, 'record')} ${n === 1 ? 'has' : 'have'} not reached the server. Sync first so nothing is lost.`, details: <SignOutDetails />, checks: [keepCheck],
        buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'out', label: 'Sign out anyway', tone: 'danger' }, { id: 'sync', label: 'Sync first', tone: 'primary', icon: 'arrow-repeat' }] });
      if (r.id === 'sync') { await sync(); return; }
      if (r.id !== 'out') return;
      await signOut({ keepData: r.checks.keep });
      return;
    }
    const r = await choose({ title: 'Sign out of Library Medicine?', kind: 'warning', icon: 'box-arrow-right', message: 'You will need your account and an internet connection to sign in again.', details: <SignOutDetails />, checks: [keepCheck],
      buttons: [{ id: 'cancel', label: 'Stay signed in' }, { id: 'out', label: 'Sign out', tone: 'danger', icon: 'box-arrow-right' }] });
    if (r.id === 'out') await signOut({ keepData: r.checks.keep });
  }, [choose, signOut, sync]);
}
