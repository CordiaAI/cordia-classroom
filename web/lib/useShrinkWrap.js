import { useEffect, useLayoutEffect } from 'react';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// A text box that wraps is as wide as the room it was given, so whatever sits beside it (the rename
// pencil next to a guide title) ends up far from where the text ends. This narrows the element to its
// widest line, now, once the fonts are in, and whenever its container changes size. When the first line
// is shorter than the widest, how much shorter goes to the parent as --first-line-slack, so the neighbour
// can slide back to sit one gap after the first line (the rows beside a short first line are empty).
// `deps` are what can change the text or the element itself. With no layout engine to ask, the box
// stays as it was.
export default function useShrinkWrap(ref, deps) {
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof document === 'undefined') return undefined;
    let alive = true;
    const fit = () => {
      if (!alive) return;
      el.style.width = '';
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = () => Array.from(range.getClientRects()).filter(rect => rect.width > 0);
      const box = el.getBoundingClientRect();
      const widest = Math.max(0, ...lines().map(rect => rect.right - box.left));
      // A whole pixel more than the widest line, so a fractional width never pushes a word down a line.
      if (widest > 0 && widest + 1 < box.width) el.style.width = `${Math.ceil(widest) + 1}px`;
      // The lines are read again once the box is narrowed (balanced lines can re-wrap in the narrower box),
      // and the slack is from the first line's end to the box's edge, where the neighbour starts.
      const rects = lines();
      const edge = el.getBoundingClientRect().right;
      const top = rects.length ? Math.min(...rects.map(rect => rect.top)) : 0;
      const first = rects.filter(rect => Math.abs(rect.top - top) < 2);
      const slack = first.length ? Math.max(0, Math.round((edge - Math.max(...first.map(rect => rect.right))) * 100) / 100) : 0;
      el.parentElement?.style.setProperty('--first-line-slack', `${slack}px`);
    };
    fit();
    // Refit when the room changes, when the text re-wraps (a font arriving or a look/size switch), and
    // once the fonts are in.
    const watch = typeof ResizeObserver === 'function' && el.parentElement ? new ResizeObserver(fit) : null;
    watch?.observe(el.parentElement);
    watch?.observe(el);
    const looks = typeof MutationObserver === 'function' ? new MutationObserver(fit) : null;
    looks?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-look', 'data-font', 'data-size'] });
    document.fonts?.ready?.then(fit);
    document.fonts?.addEventListener?.('loadingdone', fit);
    return () => { alive = false; watch?.disconnect(); looks?.disconnect(); document.fonts?.removeEventListener?.('loadingdone', fit); el.style.width = ''; el.parentElement?.style.removeProperty('--first-line-slack'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
