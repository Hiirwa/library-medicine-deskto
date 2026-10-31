import { LoginView } from './views/LoginView';
import { TokenView } from './views/TokenView';
import { HomeView } from './views/HomeView';
import { ProjectView } from './views/ProjectView';
import { SyncView } from './views/SyncView';
import { SettingsView } from './views/SettingsView';
import { HelpView } from './views/HelpView';
import { Shell } from './components/Shell';
import { EditorHost } from './components/RecordEditor';
import { CommandPalette } from './components/CommandPalette';
import { SyncOverlay } from './components/SyncOverlay';
import { Toasts } from './components/Toasts';
import { ConfirmProvider } from './components/Confirm';
import { SetupWizard } from './components/SetupWizard';
import { Logo } from './components/Brand';
import { useEffect, useRef, useState } from 'react';
import { useSession } from './providers/AppProvider';
import { useUi } from './providers/UiProvider';
import { accentFor } from './lib/accent';
import { Icon } from './components/ui';

/** Round button that appears after scrolling down and takes you back to the top. */
function ScrollTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = document.getElementById('main'); if (!el) return;
    const on = () => setShow(el.scrollTop > 500);
    el.addEventListener('scroll', on, { passive: true }); on();
    return () => el.removeEventListener('scroll', on);
  });
  return <button type="button" className={`to-top ${show ? 'show' : ''}`} aria-label="Back to the top" title="Back to the top" tabIndex={show ? 0 : -1} onClick={() => document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' })}><Icon name="arrow-up" /></button>;
}

/** Soft ripple where a button, menu item or chip is pressed. */
function useRipple() {
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const t = (e.target as HTMLElement | null)?.closest?.('.btn, .chip-btn, .pick, .nav-item, .seg button, .tool') as HTMLElement | null;
      if (!t || (t as HTMLButtonElement).disabled) return;
      const r = t.getBoundingClientRect(); const d = Math.max(r.width, r.height) * 2;
      const i = document.createElement('span'); i.className = 'ripple';
      i.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
      t.classList.add('has-ripple'); t.appendChild(i); window.setTimeout(() => i.remove(), 650);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, []);
}

function Page() {
  const { route } = useUi();
  useRipple();
  const key = route.page === 'project' ? `${route.project}-${route.tab}` : route.page;
  const ref = useRef<HTMLElement>(null);
  // focus the page so PageUp / PageDown / arrows / Home / End / Space scroll it right away
  useEffect(() => { const a = document.activeElement; if (!a || a === document.body || a.closest?.('.sb, .tb')) ref.current?.focus({ preventScroll: true }); }, [key]);
  return (
    <main className="page" id="main" key={key} ref={ref} tabIndex={-1} data-accent={accentFor(route)}>
      {route.page === 'home' && <HomeView />}
      {route.page === 'project' && <ProjectView uuid={route.project} tab={route.tab} />}
      {route.page === 'sync' && <SyncView />}
      {route.page === 'settings' && <SettingsView />}
      {route.page === 'help' && <HelpView />}
    </main>
  );
}

export default function App() {
  const { stage } = useSession();
  return (
    <ConfirmProvider>
      {stage === 'loading' && <div className="grid h-full place-items-center"><div className="anim-in"><Logo size={64} /></div></div>}
      {stage === 'login' && <LoginView />}
      {stage === 'token' && <TokenView />}
      {stage === 'app' && (
        <>
          <Shell><Page /><ScrollTop /></Shell>
          <EditorHost />
          <CommandPalette />
          <SetupWizard />
        </>
      )}
      <SyncOverlay />
      <Toasts />
    </ConfirmProvider>
  );
}
