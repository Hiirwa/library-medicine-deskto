import { useEffect, useMemo, useState } from 'react';
import { Icon } from './ui';
import { plural } from '../lib/format';
import type { Me } from '../lib/types';

export const STEP_COLORS = ['var(--rh-brand)', 'var(--rh-teal)', '#d97706', '#7c3aed'];

/** Three nodes — this computer, the token, the website — joined by a line that lights up as the steps are done. */
export function Journey({ done, valid }: { done: number; valid: boolean }) {
  const nodes: [string, string, string][] = [['laptop', 'This computer', STEP_COLORS[0]], ['key-fill', 'Your token', STEP_COLORS[2]], ['cloud-check-fill', 'librarymedicine.online', STEP_COLORS[1]]];
  const lit = valid ? 3 : done >= 4 ? 3 : done >= 2 ? 2 : 1;
  return (
    <div className="cn-journey" aria-hidden="true">
      {nodes.map(([ic, label, c], i) => (
        <div key={label} className="cn-jn-wrap">
          <div className={`cn-node ${i < lit ? 'on' : ''}`} style={{ ['--sc' as string]: c }}><Icon name={ic} /></div>
          <small>{label}</small>
          {i < nodes.length - 1 && <span className={`cn-link ${i < lit - 1 ? 'on' : ''}`}><i /></span>}
        </div>
      ))}
    </div>
  );
}

/** Four coloured segments, one per step; click one to jump to that step. */
export function SegProgress({ done, active, onPick, valid }: { done: boolean[]; active: number; onPick: (i: number) => void; valid: boolean }) {
  const labels = ['Open account', 'Create token', 'Read & write', 'Copy it'];
  const n = valid ? 4 : done.filter(Boolean).length;
  return (
    <div>
      <div className="cn-seg" role="tablist" aria-label="Steps">
        {labels.map((l, i) => (
          <button key={l} role="tab" aria-selected={active === i} className={`${done[i] || valid ? 'full' : ''} ${active === i ? 'on' : ''}`} style={{ ['--sc' as string]: STEP_COLORS[i] }} onClick={() => onPick(i)} title={l}><i /></button>
        ))}
      </div>
      <div className="cn-seg-l">{labels.map((l, i) => <span key={l} className={active === i ? 'on' : ''} style={{ ['--sc' as string]: STEP_COLORS[i] }}>{l}</span>)}<b>{n} of 4 done</b></div>
    </div>
  );
}

/** A small picture of the website for the current step, so you know exactly what to click. */
export function WebMock({ step, onStep }: { step: number; onStep: (i: number) => void }) {
  const tabs = ['Account', 'Create', 'Scope', 'Copy'];
  const [typed, setTyped] = useState('');
  useEffect(() => {
    setTyped('');
    if (step !== 1) return;
    const word = 'Desktop app'; let i = 0;
    const id = window.setInterval(() => { i++; setTyped(word.slice(0, i)); if (i >= word.length) window.clearInterval(id); }, 90);
    return () => window.clearInterval(id);
  }, [step]);
  return (
    <section className="card cn-card anim-in">
      <div className="flex items-center gap-3"><span className="pk-ic" style={{ background: 'linear-gradient(135deg,#6366f1,#2d4bd8)' }}><Icon name="window-sidebar" /></span><div className="min-w-0 flex-1"><h3 className="text-lg">What you will see on the website</h3><p className="muted text-sm">Follow the highlighted button</p></div></div>
      <div className="seg w-full">{tabs.map((t, i) => <button key={t} className={`flex-1 ${step === i ? 'on' : ''}`} onClick={() => onStep(i)}>{i + 1}. {t}</button>)}</div>
      <div className="wm" key={step}>
        <div className="wm-bar"><i /><i /><i /><span><Icon name="lock-fill" /> librarymedicine.online/account{step > 0 ? '#tokens' : ''}</span></div>
        <div className="wm-body">
          <div className="wm-side">
            <span className="wm-it"><Icon name="grid" />Projects</span><span className="wm-it"><Icon name="gem" />Plans</span><span className="wm-it"><Icon name="bell" />Alerts</span><span className="flex-1" />
            <span className={`wm-user ${step === 0 ? 'hot' : ''}`}><b>EH</b><span>You</span><Icon name="chevron-up" /></span>
          </div>
          <div className="wm-main">
            {step === 0 && <>
              <div className="wm-menu"><span>Profile</span><span className="hot">Account &amp; security</span><span>Sign out</span></div>
              <p className="wm-hint"><Icon name="cursor-fill" />Click your name, then <b>Account &amp; security</b></p>
            </>}
            {step === 1 && <>
              <div className="wm-card"><div className="flex items-center gap-2"><b>API tokens</b><span className="wm-btn hot"><Icon name="plus-lg" />Create token</span></div>
                <div className="wm-field"><small>Name</small><div>{typed}<em /></div></div></div>
              <p className="wm-hint"><Icon name="cursor-fill" />Press <b>Create token</b> and name it <b>Desktop app</b></p>
            </>}
            {step === 2 && <>
              <div className="wm-card"><b>Scope</b>
                <div className="wm-radio off"><i />Read only</div><div className="wm-radio on hot"><i />Read &amp; write</div>
                <div className="wm-field"><small>Project</small><div>All projects</div></div></div>
              <p className="wm-hint"><Icon name="cursor-fill" />Choose <b>Read &amp; write</b> so offline records can be sent</p>
            </>}
            {step === 3 && <>
              <div className="wm-card"><div className="wm-warn"><Icon name="exclamation-triangle-fill" />Shown only once</div>
                <div className="wm-token"><code>rdp_<span>7f3a9c0e1b84</span>••••••••</code><span className="wm-btn hot"><Icon name="clipboard" />Copy</span></div></div>
              <p className="wm-hint"><Icon name="cursor-fill" />Press <b>Copy</b>, then paste it into the box on this page</p>
            </>}
          </div>
        </div>
      </div>
    </section>
  );
}

/** The person's plan and how many API tokens they can still create (reported by the server at sign-in). */
export function AccountCard({ user, onPlans }: { user: Me | null; onPlans: () => void }) {
  const plan = user?.plan && typeof user.plan === 'object' ? user.plan : null;
  const max = plan?.tokens_max; const used = plan?.tokens_used ?? 0;
  const known = typeof max === 'number';
  const left = known ? (max < 0 ? Infinity : Math.max(0, max - used)) : null;
  const pct = known && max > 0 ? Math.min(100, (used / max) * 100) : 0;
  return (
    <section className="card cn-card anim-in">
      <div className="flex items-center gap-3"><span className="avatar">{(user?.name || user?.email || '?').slice(0, 2).toUpperCase()}</span><div className="min-w-0 flex-1"><h3 className="truncate text-lg">{user?.name || 'Your account'}</h3><p className="muted truncate text-sm">{user?.email}</p></div>{plan?.name && <span className="chip chip-brand"><Icon name="gem" />{plan.name}</span>}</div>
      {known ? (
        <div className={left === 0 ? 'k-warn' : 'k-teal'}>
          <div className="mb-1 flex justify-between text-sm"><span className="muted">API tokens on your plan</span><b className="num" style={{ color: 'var(--k)' }}>{max < 0 ? `${used} · unlimited` : `${used} / ${max}`}</b></div>
          {max > 0 && <div className="bar"><i style={{ width: `${pct}%` }} /></div>}
          <p className="help mt-2">{left === 0 ? 'You have reached the limit. Revoke an old token on the website first, or paste one you already created.' : left === Infinity ? 'You can create as many tokens as you need.' : `You can create ${plural(left as number, 'more token')}.`}</p>
        </div>
      ) : <p className="muted text-sm">Create a token named “Desktop app”. One token per computer lets you revoke a lost laptop without affecting the others.</p>}
      <button className="link-btn blue self-start" onClick={onPlans}><Icon name="gem" />Compare plans</button>
    </section>
  );
}

const NEXT: [string, string, string, string][] = [
  ['cloud-arrow-down-fill', 'Your projects download', 'Forms, questions and records come to this computer.', 'var(--rh-brand)'],
  ['wifi-off', 'Work anywhere', 'Enter data in the field with no internet at all.', 'var(--rh-teal)'],
  ['arrow-repeat', 'Sync by itself', 'Changes go up when you are back online.', '#d97706'],
  ['graph-up-arrow', 'Analyse and share', 'Statistics, reports, import, export and sharing.', '#7c3aed'],
];
export function NextCard() {
  return (
    <section className="card cn-card anim-in">
      <div className="flex items-center gap-3"><span className="pk-ic" style={{ background: 'linear-gradient(135deg,#14b8a6,#0d7d72)' }}><Icon name="rocket-takeoff-fill" /></span><div><h3 className="text-lg">After you connect</h3><p className="muted text-sm">What happens in the next minute</p></div></div>
      <ul className="cn-next">{NEXT.map(([ic, t, d, c], i) => <li key={t} style={{ ['--sc' as string]: c, animationDelay: `${i * 70}ms` }}><span><Icon name={ic} /></span><div><b className="ink block">{t}</b><small className="muted">{d}</small></div></li>)}</ul>
    </section>
  );
}

/** A short burst of coloured confetti. */
export function Burst({ show }: { show: boolean }) {
  const bits = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ x: (Math.sin(i * 12.9898) * 43758) % 1, a: (i / 26) * 360, c: ['#2d4bd8', '#14b8a6', '#f59e0b', '#7c3aed', '#ec4899', '#22c55e'][i % 6], d: 380 + (i % 5) * 70, s: 6 + (i % 4) * 2 })), []);
  if (!show) return null;
  return <div className="cn-burst" aria-hidden="true">{bits.map((b, i) => <i key={i} style={{ background: b.c, width: b.s, height: b.s * 1.6, ['--a' as string]: `${b.a}deg`, ['--d' as string]: `${b.d}px`, animationDelay: `${(i % 6) * 20}ms` }} />)}</div>;
}
