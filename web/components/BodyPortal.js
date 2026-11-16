import { useInsertionEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Sheets, dialogs and menus render at the end of <body>. Inside the glass top bar or a glass card,
// backdrop-filter would trap their fixed scrim inside that box (Help showed no scrim).
//
// Leaving: every caller unmounts its overlay the moment it closes, which would make it vanish.
// The portal's own box watches for that and puts the removed overlay back for the length of its
// exit (styles/system.css, `.is-leaving`), inert and unclickable, then removes it for good. So
// each overlay fades out the way it came without any caller holding it open.
const LEAVES = '.c-scrim, .c-menu';
const EXIT_MS = 200; // the longest exit: a phone sheet sliding down

function leave(box, node) {
  if (!(node instanceof HTMLElement) || !node.matches(LEAVES) || node.classList.contains('is-leaving')) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  node.classList.add('is-leaving');
  node.inert = true;
  node.setAttribute('aria-hidden', 'true');
  box.appendChild(node);
  setTimeout(() => node.remove(), EXIT_MS);
}

export default function BodyPortal({ children }) {
  // The box exists from the first render and is in <body> before any layout effect runs, so
  // what's inside can measure and take focus as soon as it mounts.
  const [box] = useState(() => (typeof document === 'undefined' ? null : Object.assign(document.createElement('div'), { className: 'c-portal' })));
  const removal = useRef(null);
  useInsertionEffect(() => {
    if (!box) return undefined;
    clearTimeout(removal.current);
    document.body.appendChild(box);
    const watcher = new MutationObserver(records => {
      for (const record of records) record.removedNodes.forEach(removed => leave(box, removed));
    });
    watcher.observe(box, { childList: true });
    // The box outlives the portal by one exit, so an overlay closed by unmounting the whole
    // portal still gets its exit.
    return () => { removal.current = setTimeout(() => { watcher.disconnect(); box.remove(); }, EXIT_MS + 50); };
  }, [box]);
  return box ? createPortal(children, box) : null;
}
