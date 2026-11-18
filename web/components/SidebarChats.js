import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FolderInput, PenLine, Trash2 } from 'lucide-react';
import Menu from './Menu';
import { focusChatRow } from './ChatToast';
import { HOME_ROUTE } from '../lib/newShell.mjs';
import { deleteChat, loadChats, moveChat, renameChat, showChatMessage } from '../lib/chats';

const dot = tone => function ClassDot() {
  return <span className={'c-class-dot' + (tone ? '' : ' is-none')} style={tone ? { '--dot': `var(--cover-ink-${tone})` } : undefined} aria-hidden="true" />;
};

// Recent chats in the sidebar (DESIGN-SPEC 3.2): newest first, one line each with an ellipsis,
// filling the rest of the sidebar and scrolling inside it. Each row's ⋯ (shown on hover and on
// keyboard focus, once chats can be changed) offers Rename, Move to class and Delete, the same as
// the chat's own ⋯. Until the first answer the list area stays empty (no "no chats" line that then
// turns into a list). chats: shellTools.recentChats rows; classes: every class (Sidebar sidebarClasses).
export default function SidebarChats({ chats, current, editable, classes, failed, loaded }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState('');
  const done = useRef(false);

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
      {chats.length > 0 ? (
        <ul className="c-side-list c-side-chat-list">
          {chats.map((chat, index) => (
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
                  { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => remove(chat, index) },
                ]} />
              )}
            </li>
          ))}
        </ul>
      ) : failed ? (
        <p className="c-side-empty">Recent chats didn't load. <button type="button" className="c-side-retry" onClick={() => loadChats({ fresh: true })}>Try again</button></p>
      ) : loaded ? <p className="c-side-empty">Chats with the Tutor show up here.</p> : null}
    </div>
  );
}
