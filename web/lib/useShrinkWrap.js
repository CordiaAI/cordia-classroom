import { useEffect, useLayoutEffect } from 'react';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

// A text box that wraps is as wide as the room it was given, so whatever sits beside it (the rename
// pencil next to a guide title) ends up far from where the text ends. This narrows the element to its
// widest line, now, once the fonts are in, and whenever its container changes size. `deps` are what
// can change the text or the element itself. With no layout engine to ask, the box stays as it was.
export default function useShrinkWrap(ref, deps) {
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof document === 'undefined') return undefined;
    let alive = true;
    const fit = () => {
      if (!alive) return;
      el.style.width = '';
      const box = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const rights = Array.from(range.getClientRects(), rect => rect.right);
      const widest = rights.length ? Math.max(...rights) - box.left : 0;
      // A whole pixel more than the widest line, so a fractional width never pushes a word down a line.
      if (widest > 0 && widest + 1 < box.width) el.style.width = `${Math.ceil(widest) + 1}px`;
    };
    fit();
    const watch = typeof ResizeObserver === 'function' && el.parentElement ? new ResizeObserver(fit) : null;
    watch?.observe(el.parentElement);
    document.fonts?.ready?.then(fit);
    return () => { alive = false; watch?.disconnect(); el.style.width = ''; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
