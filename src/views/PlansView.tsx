import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Brand } from '../components/Brand';
import { Icon } from '../components/ui';
import { planName, plansFor } from '../lib/plans';
import { PricingModal } from '../components/PricingModal';
import { useSession } from '../providers/AppProvider';

/** Shown instead of the token instructions when the account's plan has no API tokens. */
export function PlansView({ reason, onBack }: { reason?: string; onBack?: () => void }) {
  const { server, user, signOut, toast, online } = useSession();
  const [busy, setBusy] = useState(false);
  const [pricing, setPricing] = useState<{ plan: string | null } | null>(null);
  const current = (planName(user) ?? 'Free').trim();
  const curKey = ((user?.plan && typeof user.plan === 'object' ? user.plan.key : '') ?? '').toString();
  const isCurrent = (id: string, name: string) => (!!curKey && curKey === id) || current.toLowerCase() === name.toLowerCase() || current.toLowerCase() === id;
  const site = server.replace(/\/$/, '');
  const open = (path: string) => openUrl(`${site}${path}`).catch(() => toast('Could not open the website.', 'error'));
  // the plan is read when you sign in, so an upgrade is picked up by signing in again (your offline data stays)
  const recheck = async () => { setBusy(true); try { await signOut({ keepData: true }); } finally { setBusy(false); } };

  return (
    <div className="auth-bg" tabIndex={-1}>
      <div className="auth-card anim-in" style={{ maxWidth: '68rem' }}>
        <div className="flex items-center justify-between"><Brand />
          <div className="flex items-center gap-3"><ol className="mini-steps" aria-label="Setup progress"><li className="done"><span><Icon name="check-lg" /></span>Sign in</li><li className="on"><span>2</span>Connect</li><li><span>3</span>Work</li></ol>
            <button className="btn btn-ghost btn-sm" onClick={() => signOut()}><Icon name="box-arrow-left" />Sign out</button></div></div>

        <div className="mt-6 flex flex-wrap items-start gap-4">
          <span className="acc-ic" style={{ width: '3.4rem', height: '3.4rem', fontSize: '1.5rem' }}><Icon name="gem" /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl grad-text">Upgrade to connect this computer</h1>
            <p className="muted mt-1 max-w-3xl">The desktop app syncs with a personal API token, and API tokens are part of the Pro and Max plans. {user && <>You are signed in as <b className="ink">{user.name || user.email}</b> on the <b className="ink">{current}</b>{/plan$/i.test(current) ? '.' : ' plan.'}</>}</p>
          </div>
        </div>
        {reason && <div className="notice warn mt-4"><Icon name="exclamation-triangle" /><span>{reason}</span></div>}

        <div className="mt-6 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(17rem, 1fr))' }}>
          {plansFor(user).map((p) => {
            const mine = isCurrent(p.id, p.name);
            return (
              <section key={p.id} className={`plan ${p.recommended ? 'rec' : ''} ${mine ? 'mine' : ''}`}>
                {p.recommended && <span className="plan-flag"><Icon name="star-fill" />Recommended</span>}
                <div className="flex items-center gap-2"><h2 className="text-xl">{p.name}</h2>{mine && <span className="chip chip-ok"><Icon name="check2" />Your plan</span>}</div>
                <p className="muted text-sm">{p.tagline}</p>
                <div className="plan-price">{p.price ? <><b>{p.price}</b>{p.period && <small>{p.period}</small>}</> : <small>See prices on the website</small>}</div>
                <ul className="space-y-2 text-sm">{p.features.map(([ok, t]) => <li key={t} className="flex items-start gap-2"><Icon name={ok ? 'check-circle-fill' : 'x-circle-fill'} className={ok ? 'text-[var(--rh-success)]' : 'text-[var(--rh-danger)]'} /><span className={ok ? '' : 'muted'}>{t}</span></li>)}</ul>
                {p.tokens && !mine && <button className={`btn mt-auto ${p.recommended ? 'btn-primary' : ''}`} disabled={!online} onClick={() => setPricing({ plan: p.id })}><Icon name="tags" />Choose {p.name}</button>}
                {mine && <button className="btn mt-auto" disabled><Icon name="check2" />Current plan</button>}
              </section>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button className="btn btn-primary btn-lg" onClick={() => setPricing({ plan: null })}><Icon name="rocket-takeoff" />View prices & upgrade</button>
          <button className="btn btn-lg" disabled={busy} onClick={recheck} title="Sign in again so the app reads your new plan"><Icon name="arrow-repeat" className={busy ? 'spin' : ''} />I’ve upgraded — check again</button>
          <button className="btn btn-lg" disabled={!online} onClick={() => open('')}><Icon name="globe2" />Keep using the website</button>
          {onBack && <button className="btn btn-lg" onClick={onBack}><Icon name="arrow-left" />Back to the token steps</button>}
          {!online && <span className="help"><Icon name="wifi-off" className="mr-1" />Connect to the internet to open the website.</span>}
        </div>
        {pricing && <PricingModal focusPlan={pricing.plan} onClose={() => setPricing(null)} />}
        <p className="help mt-3 text-center"><Icon name="shield-check" className="mr-1" />After upgrading, choose “I’ve upgraded — check again”, sign in once more, and the token steps appear. Nothing on this computer is deleted.</p>
      </div>
    </div>
  );
}
