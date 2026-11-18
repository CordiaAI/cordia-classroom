import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FolderInput, PenLine, Trash2 } from 'lucide-react';
import Menu from './Menu';
import { focusChatRow } from './ChatToast';
import { HOME_ROUTE } from '../lib/newShell.mjs';
import { deleteChat, loadChats, moveChat, renameChat, showChatMessage, showMoreChats } from '../lib/chats';

const EXIT_MS = 200; // tokens.css --dur-exit
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const keysOf = rows => new Set(rows.map(row => row.key));

const dot = tone => function ClassDot() {
  return <span className={'c-class-dot' + (tone ? '' : ' is-none')} style={tone ? { '--dot': `var(--cover-ink-${tone})` } : undefined} aria-hidden="true" />;
};

// Recent chats in the sidebar (DESIGN-SPEC 3.2): newest first, one line each with an ellipsis,
// filling the rest of the sidebar and scrolling inside it. Each row's ⋯ (shown on hover and on
// keyboard focus, once chats can be changed) offers Rename, Move to class and Delete, the same as
// the chat's own ⋯. Until the first answer the list area stays empty (no "no chats" line that then
// turns into a list). A row that goes (deleted here or elsewhere) fades and folds shut instead of
// vanishing (none with reduced motion). The list starts with the newest 30; past that, Show more asks
// for as many as the backend lists (100). chats: shellTools.recentChats rows; classes: every class
// (Sidebar sidebarClasses); more, limited: lib/chatStore.mjs snapshot.
export default function SidebarChats({ chats, current, editable, classes, failed, loaded, more = false, limited = false }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [ghosts, setGhosts] = useState([]); // rows on their way out: { chat, index }
  const done = useRef(false);
  const before = useRef(chats);

  useEffect(() => {
    const was = before.current;
    before.current = chats;
    if (reducedMotion() || !was.length || !chats.length) return undefined;
    const keys = new Set(chats.map(chat => chat.key));
    const gone = was.map((chat, index) => ({ chat, index })).filter(row => !keys.has(row.chat.key));
    // One or two rows leaving is a delete; a whole other list (another account, a reload) is not.
    if (!gone.length || gone.length > 2) return undefined;
    setGhosts(current => [...current, ...gone]);
    const timer = setTimeout(() => setGhosts(current => current.filter(row => !gone.includes(row))), EXIT_MS);
    return () => clearTimeout(timer);
  }, [chats]);

  const list = chats.slice();
  [...ghosts].sort((a, b) => a.index - b.index).forEach(row => { if (!keysOf(list).has(row.chat.key)) list.splice(Math.min(row.index, list.length), 0, { ...row.chat, ghost: true }); });

  // The button goes once the rest is in: focus moves to the first chat that was added.
  async function showMore(event) {
    if (loadingMore) return;
    const focused = document.activeElement === event.currentTarget;
    const shownBefore = chats.length;
    setLoadingMore(true);
    await showMoreChats();
    setLoadingMore(false);
    if (focused) requestAnimationFrame(() => document.querySelectorAll('.c-side-chat-list [data-chat-row] .c-side-chat')[shownBefore]?.focus({ preventScroll: false }));
  }

  function startRename(chat) {
    done.current = false;
    setRenaming(chat.id);
  }
  async function finishRename(chat, value, save = true) {
    if (done.current) return;
    done.current = true;
    setRenaming('');
    focusChatRow(chat.id);
    if (!save) return;
    const result = await renameChat(chat.id, value);
    if (!result.ok) showChatMessage(result.message);
  }
  async function move(chat, classId) {
    const result = await moveChat(chat.id, classId);
    if (!result.ok) showChatMessage(result.message);
  }
  // The row goes at once; focus moves to the next one (or New chat). Deleting the open chat goes home.
  async function remove(chat, index) {
    const next = chats[index + 1] || chats[index - 1];
    focusChatRow(next?.id || '');
    const result = await deleteChat(chat.id);
    if (!result.ok) { showChatMessage(result.message); return; }
    if (current === chat.key && router.pathname === '/chat/[id]') router.replace(HOME_ROUTE);
  }

  return (
    <div className="c-side-section c-side-chats" role="group" aria-labelledby="c-side-chats">
      <h2 id="c-side-chats" className="c-side-heading c-side-heading-row">Recent chats</h2>
      {list.length > 0 ? (
        <ul className="c-side-list c-side-chat-list">
          {list.map(chat => chat.ghost ? (
            <li key={chat.key} className="c-side-chat-row is-leaving" aria-hidden="true">
              <div className="c-side-chat-ghost"><span className="c-side-item c-side-chat"><span className="c-side-label">{chat.title}</span></span></div>
            </li>
          ) : (
            <li key={chat.key} data-chat-row={chat.id} className={'c-side-chat-row' + (editable ? ' has-more' : '')}>
              {renaming === chat.id ? (
                <input className="c-side-chat-rename" defaultValue={chat.title} aria-label="Chat title" maxLength={120} autoFocus
                  onFocus={event => event.currentTarget.select()}
                  onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); finishRename(chat, event.currentTarget.value); }
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishRename(chat, '', false); }
                  }}
                  onBlur={event => finishRename(chat, event.currentTarget.value)} />
              ) : (
                <Link className="c-side-item c-side-chat" href={chat.href} aria-current={current === chat.key ? 'page' : undefined}>
                  <span className="c-side-label">{chat.title}</span>
                </Link>
              )}
              {editable && renaming !== chat.id && (
                <Menu label={`Options for ${chat.title}`} triggerClassName="c-side-icon c-side-chat-more" items={[
                  { key: 'rename', label: 'Rename', icon: PenLine, onSelect: () => startRename(chat) },
                  {
                    key: 'move', label: 'Move to class', icon: FolderInput,
                    items: [
                      { key: 'none', label: 'No class', icon: dot(0), current: !chat.classId, onSelect: () => move(chat, null) },
                      ...classes.map(item => ({ key: String(item.id), label: item.code, meta: item.name !== item.code ? item.name : undefined, icon: dot(item.tone), current: String(chat.classId || '') === String(item.id), onSelect: () => move(chat, String(item.id)) })),
                    ],
                  },
                  { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => remove(chat, chats.findIndex(item => item.key === chat.key)) },
                ]} />
              )}
            </li>
          ))}
          {more && (
            <li className="c-side-more">
              <button type="button" className="c-side-all c-side-more-btn" onClick={showMore} aria-disabled={loadingMore || undefined}>{loadingMore ? 'Loading…' : 'Show more'}</button>
            </li>
          )}
          {limited && <li className="c-side-more c-side-empty">Showing your newest {chats.length} chats.</li>}
        </ul>
      ) : failed ? (
        <p className="c-side-empty">Recent chats didn't load. <button type="button" className="c-side-retry" onClick={() => loadChats({ fresh: true })}>Try again</button></p>
      ) : loaded ? <p className="c-side-empty">Chats with the Tutor show up here.</p> : null}
    </div>
  );
}
