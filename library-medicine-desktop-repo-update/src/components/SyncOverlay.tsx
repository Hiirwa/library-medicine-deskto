import { useSession } from '../providers/AppProvider';
import { Icon } from './ui';

const LABEL: Record<string, [string, string]> = {
  'files-up': ['Uploading attached files', 'cloud-arrow-up'],
  pushing: ['Sending your changes', 'send'],
  pulling: ['Receiving updates', 'cloud-arrow-down'],
  'files-down': ['Downloading files for offline use', 'download'],
  done: ['Finished', 'check2-circle'],
  error: ['Sync problem', 'exclamation-octagon'],
};
const ORDER = ['files-up', 'pushing', 'pulling', 'files-down'];

/** While syncing, input is paused so the local database is never edited mid-merge. */
export function SyncOverlay() {
  const { syncing, progress } = useSession();
  if (!syncing) return null;
  const stage = progress?.stage ?? 'pushing';
  const pct = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : null;
  const at = ORDER.indexOf(stage);
  return (
    <div className="overlay grid place-items-center" role="alertdialog" aria-modal="true" aria-label="Synchronising">
      <div className="dialog w-[440px] p-7 text-center">
        <div className="relative mx-auto mb-4 grid h-16 w-16 place-items-center">
          <span className="spin absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 0 4px var(--rh-brand-soft)', borderTop: '4px solid var(--rh-brand)' }} />
          <Icon name={LABEL[stage]?.[1] ?? 'arrow-repeat'} className="text-2xl" />
        </div>
        <h2 className="text-xl grad-text">Synchronising with Library Medicine</h2>
        <p className="mt-1 font-bold" style={{ color: 'var(--rh-brand)' }}>{LABEL[stage]?.[0] ?? 'Working'}</p>
        <p className="muted mt-1 truncate text-sm">{progress?.message}</p>
        <div className="mt-4 flex justify-center gap-2">
          {ORDER.map((s, i) => <span key={s} className="h-1.5 w-10 rounded-full" style={{ background: i <= at ? 'var(--rh-brand)' : 'var(--rh-surface-3)' }} />)}
        </div>
        {pct !== null && <div className="bar lg mt-4"><i style={{ width: `${pct}%` }} /></div>}
        <p className="muted mt-4 text-xs">Editing is paused for a moment. Your work is safe on this computer.</p>
      </div>
    </div>
  );
}
