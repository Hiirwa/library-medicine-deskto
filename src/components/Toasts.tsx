import { useSession } from '../providers/AppProvider';
import { Icon } from './ui';

export function Toasts() {
  const { toasts, dismissToast } = useSession();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} onClick={() => dismissToast(t.id)}>
          <span className="t-ic"><Icon name={t.kind === 'error' ? 'exclamation-lg' : 'check-lg'} /></span>
          <span className="flex-1 pt-0.5">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
