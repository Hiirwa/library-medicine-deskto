import { useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { sanitizeHtml } from '../lib/html';
import { Icon } from './ui';

/** Formatted description: HTML from the website is cleaned and shown as headings, lists and bold text. Long text folds with “Show more”. */
export function Rich({ html, className = '', fold = 0 }: { html: string | null | undefined; className?: string; fold?: number }) {
  const safe = useMemo(() => sanitizeHtml(html), [html]);
  const [open, setOpen] = useState(false);
  if (!safe) return null;
  const long = fold > 0 && (html ?? '').length > fold;
  return (
    <div className={className}>
      <div className={`rich selectable ${long && !open ? 'folded' : ''}`} style={long && !open ? { maxHeight: `${Math.max(9, fold / 50)}rem` } : undefined}
        onClick={(e) => { const a = (e.target as HTMLElement).closest('a[data-ext]'); if (a) { e.preventDefault(); openUrl(a.getAttribute('href') ?? ''); } }}
        dangerouslySetInnerHTML={{ __html: safe }} />
      {long && <button type="button" className="btn btn-sm mt-2" onClick={() => setOpen((o) => !o)} aria-expanded={open}><Icon name={open ? 'chevron-up' : 'chevron-down'} />{open ? 'Show less' : 'Show more'}</button>}
    </div>
  );
}
