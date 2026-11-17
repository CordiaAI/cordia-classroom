import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { BookOpen, Calendar, CalendarCheck, ChartLine, Ellipsis, FilePlus, GraduationCap, House, Layers, ListChecks, MessageCircle, Mic, PencilLine, PenLine, Plus, Stethoscope, Zap } from 'lucide-react';
import { MORE_TOOL, RAIL_TOOLS, moreTools, railCurrent, toolHref } from '../lib/shellTools.mjs';
import { openNewSheet } from '../lib/newSheet';
import { walkthroughEvent } from '../lib/walkthrough';
import { useWhatsNew } from '../lib/whatsNew';
import { ShellTipLayer, useShellTips } from './ShellTips';
import ShellMenu from './ShellMenu';

const ICONS = { BookOpen, Calendar, CalendarCheck, ChartLine, Ellipsis, FilePlus, GraduationCap, House, Layers, ListChecks, MessageCircle, Mic, PencilLine, PenLine, Plus, Stethoscope, Zap };
const tipId = key => `c-rail-tip-${key}`;

// The tool rail (DESIGN-SPEC 3.4): a pane of glass on the right edge, one 44px round button per
// tool, More tools alone at the bottom. Each button has a popover with its name and one line.
// Outside a chat every tool opens its own page (on the page's guide when there is one); Make guide
// and New open the New sheet. Wide screens only; phones keep the tab bar (T9 brings Tools there).
export default function ToolRail() {
  const router = useRouter();
  const { tip, bind, hide } = useShellTips();
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreInstant, setMoreInstant] = useState(false);
  const moreRef = useRef(null);
  const whatsNew = useWhatsNew();
  const current = railCurrent(router.pathname);
  const query = router.query || {};
  const closeMore = useCallback(refocus => {
    setMoreOpen(false);
    if (refocus) moreRef.current?.focus({ preventScroll: true });
  }, []);

  const MORE_ACTIONS = {
    new: () => openNewSheet(),
    record: () => { walkthroughEvent('record-opened'); openNewSheet('record'); },
  };
  const moreItems = moreTools({ nursing: Boolean(whatsNew.user?.nursing) }).map(item => ({
    key: item.key, label: item.label, meta: item.meta, icon: ICONS[item.icon],
    href: MORE_ACTIONS[item.key] ? null : toolHref(item.key, router.pathname, query),
    onSelect: MORE_ACTIONS[item.key],
    current: railCurrent(router.pathname) === 'more' && toolHref(item.key, router.pathname, query) === router.asPath.split(/[?#]/)[0],
  }));

  const tips = [...RAIL_TOOLS, MORE_TOOL].map(tool => ({ key: tool.key, id: tipId(tool.key), title: tool.label, line: tool.line }));

  return (
    <aside className="c-rail" aria-label="Tools">
      <ul className="c-rail-tools" onScroll={hide}>
        {RAIL_TOOLS.map(tool => {
          const Icon = ICONS[tool.icon];
          const common = {
            className: 'c-rail-btn', 'aria-label': tool.label, 'aria-describedby': tipId(tool.key),
            'aria-current': current === tool.key ? 'page' : undefined, ...bind(tool.key),
          };
          return (
            <li key={tool.key}>
              {tool.key === 'make' ? (
                <button type="button" {...common} data-spot="new" onClick={() => openNewSheet()}>
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                </button>
              ) : (
                <Link href={toolHref(tool.key, router.pathname, query)} {...common} data-tip={tool.key === 'calendar' ? 'calendar' : undefined}>
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <button ref={moreRef} type="button" className="c-rail-btn c-rail-more" aria-label={MORE_TOOL.label} aria-describedby={tipId('more')}
        aria-haspopup="menu" aria-expanded={moreOpen} aria-current={current === 'more' ? 'page' : undefined} {...bind('more')}
        onClick={event => { hide(); setMoreInstant(event.detail === 0); setMoreOpen(open => !open); }}>
        <Ellipsis size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <ShellTipLayer tip={moreOpen ? null : tip} items={tips} side="left" describes />
      <ShellMenu open={moreOpen} onClose={closeMore} anchorRef={moreRef} side="left" label="More tools" items={moreItems} instant={moreInstant} />
    </aside>
  );
}
