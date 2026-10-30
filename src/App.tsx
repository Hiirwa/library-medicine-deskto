import { DashboardView } from './views/DashboardView';
import { LoginView } from './views/LoginView';
import { TokenView } from './views/TokenView';
import { SyncOverlay } from './components/SyncOverlay';
import { Toasts } from './components/Toasts';
import { Logo } from './components/Brand';
import { useSession } from './providers/AppProvider';

export default function App() {
  const { stage } = useSession();
  return (
    <>
      {stage === 'loading' && <div className="grid h-full place-items-center"><Logo size={56} /></div>}
      {stage === 'login' && <LoginView />}
      {stage === 'token' && <TokenView />}
      {stage === 'app' && <DashboardView />}
      <SyncOverlay />
      <Toasts />
    </>
  );
}
