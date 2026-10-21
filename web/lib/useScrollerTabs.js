import { useEffect, useRef } from 'react';

// A row of tabs that can be wider than a phone: fades the edge that has more tabs, and keeps
// the current tab in view (scrolling only the row, never the page). Pair with `c-seg is-scroller`.
export default function useScrollerTabs(activeKey) {
  const ref = useRef(null);

  useEffect(() => {
    const row = ref.current;
    if (!row) return undefined;
    const update = () => {
      const more = row.scrollWidth - row.clientWidth > 1;
      row.classList.toggle('fade-left', more && row.scrollLeft > 4);
      row.classList.toggle('fade-right', more && row.scrollLeft < row.scrollWidth - row.clientWidth - 4);
    };
    update();
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { row.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);

  useEffect(() => {
    const row = ref.current;
    const active = row?.querySelector('[aria-selected="true"]');
    if (!row || !active || row.scrollWidth <= row.clientWidth) return;
    const left = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [activeKey]);

  return ref;
}
