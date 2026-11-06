// "View prices & upgrade": the website's own pricing section (same plans, prices, Monthly/Yearly switch, feature
// lists, comparison table and questions, same design) in a window inside the app. The website sends the section and
// its stylesheet (GET /desktop/pricing); the app shows it in a frame (no scripts run in it) and adapts the buttons to the
// signed-in person's plan. Choosing a plan opens the website's plan page, where payment happens.
import { useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api } from '../lib/native';
import { useSession } from '../providers/AppProvider';
import { useUi } from '../providers/UiProvider';
import { Icon } from './ui';

interface PricingResponse { html: string; css: string | null; css_hash: string; site: string; plan_page: string; pricing_page: string }
interface Cached { html: string; css: string; hash: string; at: string }

const KEY = 'lm_pricing_cache';
const loadCache = (): Cached | null => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const saveCache = (c: Cached) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage full: shown anyway */ } };

/** The page put in the frame: the website's stylesheet (fonts and icons from the app's own copies) + the section. */
function pageFor(html: string, css: string, dark: boolean, vivid: boolean) {
  const fixed = css.replace(/url\(\s*(['"]?)(?:\.\.\/)+assets\//g, 'url($1/webform/assets/'); // icon + Roboto fonts bundled with the app
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ''); // the app wires the buttons itself (no scripts in the frame)
  return `<!doctype html><html lang="en" data-bs-theme="${dark ? 'dark' : 'light'}" class="${vivid ? 'rh-vivid' : ''}"><head><meta charset="utf-8">
<style>${fixed}</style>
<style>
  html,body{background:transparent}
  body{padding:.5rem 1.6rem 2rem;font-family:"Roboto Condensed",system-ui,sans-serif}
  .pln{max-width:none}
  .pln-card.lm-focus{outline:3px solid var(--rh-brand,#4f46e5);outline-offset:4px;animation:lmPulse 1.2s ease 2}
  @keyframes lmPulse{50%{outline-color:transparent}}
  .pln-cta.lm-disabled{pointer-events:none;opacity:.85}
</style></head><body>${body}</body></html>`;
}

export function PricingModal({ onClose, focusPlan }: { onClose: () => void; focusPlan?: string | null }) {
  const { user, online, server, toast } = useSession();
  const { dark, vivid } = useUi();
  const [data, setData] = useState<Cached | null>(() => loadCache());
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() => (loadCache() ? 'ready' : 'loading'));
  const [stale, setStale] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);
  const site = server.replace(/\/$/, '');
  const planObj = user?.plan && typeof user.plan === 'object' ? user.plan : null;
  const myPlan = (planObj?.key ?? (typeof user?.plan === 'string' ? user.plan : '') ?? '').toString().toLowerCase();
  const open = (url: string) => openUrl(url).catch(() => toast('Could not open the website.', 'error'));

  // fresh plans from the website (the stylesheet only when it changed)
  useEffect(() => {
    if (!online) { setState((s) => (s === 'loading' ? 'error' : s)); return; }
    let off = false;
    const have = loadCache()?.hash ?? '';
    api<PricingResponse>('GET', `desktop/pricing?have=${encodeURIComponent(have)}`, undefined, 'none').then((r) => {
      if (off) return;
      if (r.status !== 200 || !r.body?.html) { setState((s) => (s === 'ready' ? s : 'error')); return; }
      const css = r.body.css ?? loadCache()?.css ?? '';
      const c: Cached = { html: r.body.html, css, hash: r.body.css_hash, at: new Date().toISOString() };
      saveCache(c);
      setData(c);
      setStale(false);
      setState('ready');
    }).catch(() => { if (!off) setState((s) => (s === 'ready' ? s : 'error')); });
    return () => { off = true; };
  }, [online]);

  // wire the frame: billing switch, "show all features", plan buttons for this person, links to the browser
  function wire() {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const rank = ['free', 'pro', 'max'];
    doc.querySelectorAll<HTMLElement>('.pln-card').forEach((card) => {
      const k = (card.dataset.plan || '').toLowerCase();
      const cta = card.querySelector<HTMLElement>('.pln-cta');
      const nm = (card.querySelector('.pln-name')?.textContent || k).replace(/\s*plan$/i, '').trim();
      if (!k || !cta) return;
      if (myPlan === 'admin') {
        cta.outerHTML = '<span class="btn pln-cta pln-cta-down lm-disabled"><i class="bi bi-shield-lock"></i><span>Administrators have full access</span></span>';
        card.classList.remove('pln-hot');
        return;
      }
      if (k === myPlan) {
        card.classList.add('pln-cur');
        card.querySelector('.pln-badge')?.remove();
        card.insertAdjacentHTML('afterbegin', '<span class="pln-badge pln-badge-cur"><i class="bi bi-check2-circle"></i> Your plan</span>');
        cta.outerHTML = `<a class="btn pln-cta pln-cta-ghost" href="${site}/account/plan#plan-${k}"><i class="bi bi-arrow-repeat"></i><span>Renew or extend</span></a>`;
        return;
      }
      const up = rank.indexOf(k) > rank.indexOf(myPlan || 'free');
      if (myPlan && !up) {
        cta.outerHTML = '<span class="btn pln-cta pln-cta-down lm-disabled"><i class="bi bi-info-circle"></i><span>Included in your plan</span></span>';
        card.classList.remove('pln-hot');
        return;
      }
      const a = doc.createElement('a');
      a.className = cta.className.replace('pln-cta-down', '');
      a.href = `${site}/account/plan#plan-${k}`;
      a.innerHTML = `<i class="bi bi-arrow-up-circle"></i><span>${k === 'free' ? 'Get started' : `Upgrade to ${nm}`}</span><i class="bi bi-arrow-right"></i>`;
      cta.replaceWith(a);
    });
    doc.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const bill = t.closest<HTMLElement>('[data-pln-bill]');
      if (bill) { // same behaviour as the website's script
        const r = bill.closest<HTMLElement>('[data-pln]'); const v = bill.dataset.plnBill || 'month';
        if (!r) return;
        r.setAttribute('data-bill', v);
        r.querySelectorAll<HTMLElement>('[data-pln-bill]').forEach((x) => { const on = x === bill; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
        r.querySelectorAll<HTMLElement>('.pln-amt').forEach((amt) => { const txt = amt.getAttribute(v === 'year' ? 'data-y' : 'data-m'); if (txt && amt.textContent !== txt) { amt.textContent = txt; amt.classList.remove('pln-flip'); void amt.offsetWidth; amt.classList.add('pln-flip'); } });
        return;
      }
      const more = t.closest<HTMLElement>('[data-pln-more]');
      if (more) {
        const c = more.closest<HTMLElement>('.pln-card'); if (!c) return;
        const on = !c.classList.contains('pln-open');
        c.classList.toggle('pln-open', on); more.setAttribute('aria-expanded', on ? 'true' : 'false');
        const sp = more.querySelector('span'); if (sp) sp.textContent = on ? 'Show fewer' : `Show all ${c.querySelector('[data-pln-feat]')?.getAttribute('data-n') ?? ''} features`;
        return;
      }
      const link = t.closest<HTMLAnchorElement>('a[href]');
      if (link) {
        e.preventDefault();
        const href = link.getAttribute('href') || '';
        if (href.startsWith('#')) return;
        open(/^https?:\/\//i.test(href) ? href : `${site}/${href.replace(/^\//, '')}`);
      }
    });
    if (focusPlan) {
      const c = doc.querySelector<HTMLElement>(`.pln-card[data-plan="${focusPlan}"]`);
      if (c) { c.classList.add('lm-focus'); c.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pricing-modal anim-in" role="dialog" aria-modal="true" aria-labelledby="pmTitle">
        <header className="pm-head">
          <span className="acc-ic" style={{ width: '2.6rem', height: '2.6rem', fontSize: '1.15rem' }}><Icon name="gem" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="pmTitle" className="grad-text text-xl">Pricing plans</h2>
            <p className="muted text-sm">The same plans and prices as on {new URL(server).host}{stale && data ? ' · saved copy' : ''}. Payment happens on the website.</p>
          </div>
          <button className="btn btn-sm" disabled={!online} onClick={() => open(`${site}/account/plan`)}><Icon name="box-arrow-up-right" />My plan on the website</button>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)"><Icon name="x-lg" /></button>
        </header>
        {state === 'loading' && (
          <div className="pm-body grid gap-4 p-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: '26rem', borderRadius: '1.4rem' }} />)}
          </div>
        )}
        {state === 'error' && !data && (
          <div className="pm-body grid place-items-center p-10 text-center">
            <div className="max-w-md">
              <span className="acc-ic mx-auto" style={{ width: '3.2rem', height: '3.2rem' }}><Icon name={online ? 'cloud-slash' : 'wifi-off'} /></span>
              <h3 className="mt-3 text-lg">{online ? 'The plans could not be loaded' : 'You are offline'}</h3>
              <p className="muted mt-1">{online ? 'The website may need the latest update. You can still see the plans on the website.' : 'Connect to the internet to see the plans.'}</p>
              {online && <button className="btn btn-primary mt-4" onClick={() => open(`${site}/#pricing`)}><Icon name="box-arrow-up-right" />Open pricing on the website</button>}
            </div>
          </div>
        )}
        {data && state !== 'loading' && (
          <iframe ref={frame} className="pm-frame" title="Pricing plans" srcDoc={pageFor(data.html, data.css, dark, vivid)} onLoad={wire} />
        )}
      </div>
    </div>
  );
}
