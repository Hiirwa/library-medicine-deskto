import { useSession } from '../providers/AppProvider';

const LABEL: Record<string, string> = {
  'files-up': 'Uploading attached files',
  pushing: 'Sending your changes',
  pulling: 'Receiving updates',
  'files-down': 'Downloading files for offline use',
  done: 'Finished',
  error: 'Sync problem',
};

/** While syncing, input is paused so the local database is never edited mid-merge. */
export function SyncOverlay() {
  const { syncing, progress } = useSession();
  if (!syncing) return null;
  const pct = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : null;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/30 backdrop-blur-[2px]" role="alertdialog" aria-modal="true" aria-label="Synchronising">
      <div className="card w-[420px] p-6 text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" aria-hidden="true" />
        <h2 className="text-lg font-bold text-slate-900">Synchronising with Library Medicine</h2>
        <p className="mt-1 text-sm font-semibold text-brand-700">{LABEL[progress?.stage ?? 'pushing'] ?? 'Working'}</p>
        <p className="mt-1 truncate text-sm text-slate-500">{progress?.message}</p>
        {pct !== null && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
        <p className="mt-4 text-xs text-slate-400">Editing is paused for a moment. Your work is safe on this computer.</p>
      </div>
    </div>
  );
}
