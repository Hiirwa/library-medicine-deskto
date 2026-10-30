import { useSession } from '../providers/AppProvider';

export function Toasts() {
  const { toasts } = useSession();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[360px] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`card pointer-events-auto px-4 py-3 text-sm font-medium ${t.kind === 'error' ? 'text-red-700' : 'text-slate-800'}`}>
          <span className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${t.kind === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`} />
          {t.msg}
        </div>
      ))}
    </div>
  );
}
