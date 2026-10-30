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
import { Logo } from './components/Brand';
import { useSession } from './providers/AppProvider';
import { useUi } from './providers/UiProvider';

function Page() {
  const { route } = useUi();
  const key = route.page === 'project' ? `${route.project}-${route.tab}` : route.page;
  return (
    <main className="page" id="main" key={key}>
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
    <>
      {stage === 'loading' && <div className="grid h-full place-items-center"><div className="anim-in"><Logo size={64} /></div></div>}
      {stage === 'login' && <LoginView />}
      {stage === 'token' && <TokenView />}
      {stage === 'app' && (
        <>
          <Shell><Page /></Shell>
          <EditorHost />
          <CommandPalette />
        </>
      )}
      <SyncOverlay />
      <Toasts />
    </>
  );
}
