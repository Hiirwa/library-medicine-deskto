import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Side-by-side columns where the shorter ones stay in view while the tallest one scrolls.
 * Put the columns as direct children: <StickyColumns className="grid gap-4" style={{ gridTemplateColumns: '1fr 22rem' }}> {left} {right} </StickyColumns>.
 * Re-measures whenever a column changes size, and does nothing when the columns are stacked (narrow window).
 * A shorter column that is still taller than the window sticks by its bottom edge, so all of it can be reached.
 */
export function StickyColumns({ children, className = '', style, top = 12 }: { children: ReactNode; className?: string; style?: CSSProperties; top?: number }) {
  const items = Children.toArray(children);
  const wrap = useRef<HTMLDivElement>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const [tops, setTops] = useState<(number | null)[]>([]);

  useEffect(() => {
    const root = wrap.current; if (!root) return;
    const measure = () => {
      const els = cols.current.filter((e): e is HTMLDivElement => !!e);
      if (els.length < 2) return;
      const lefts = els.map((e) => e.getBoundingClientRect().left);
      const sideBySide = lefts.every((l, i) => i === 0 || Math.abs(l - lefts[0]) > 24); // stacked columns share the same left edge
      const heights = els.map((e) => e.offsetHeight); const tallest = Math.max(...heights);
      const vh = (root.closest('.page') as HTMLElement | null)?.clientHeight ?? window.innerHeight;
      const next = heights.map((h) => (sideBySide && h + 24 < tallest ? Math.min(top, Math.round(vh - h - 16)) : null));
      setTops((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    cols.current.forEach((e) => e && ro.observe(e));
    ro.observe(root);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [items.length, top]);

  return (
    <div ref={wrap} className={className} style={style}>
      {items.map((c, i) => (
        <div key={i} ref={(el) => { cols.current[i] = el; }} style={{ minWidth: 0, alignSelf: 'start', ...(tops[i] !== null && tops[i] !== undefined ? { position: 'sticky', top: tops[i] as number } : {}) }}>{c}</div>
      ))}
    </div>
  );
}
