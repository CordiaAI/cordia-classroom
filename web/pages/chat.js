// Chat workspace (prototype): Classroom as one conversation. Classes are projects, their study
// guides sit inside them, and every feature is a tool Cordia calls; what a tool opens appears as a
// window beside the chat (components/chat/Windows.js). Server: pages/api/study-chat.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { getToken, getUserName, tryRefreshToken } from '../lib/api';
import WindowPanel, { windowLabel } from '../components/chat/Windows';

const THREADS_KEY = 'cordiaChatThreads';
const MAX_HISTORY = 30;

const TOOL_TEXT = {
  get_study_set: 'Opening the study guide',
  search_my_materials: 'Searching your materials',
  list_study_sets: 'Looking through your guides',
  get_due_cards: 'Checking what’s due',
  list_lectures: 'Looking through your lectures',
  get_lecture: 'Opening the lecture',
  create_study_guide: 'Building a study guide',
  show_quiz: 'Writing your quiz',
  show_flashcards: 'Making flashcards',
};

const TOOL_MENU = [
  { label: 'Quiz me', prompt: 'Quiz me on ' },
  { label: 'Flashcards', prompt: 'Make flashcards for ' },
  { label: 'Study guide', prompt: 'Open my study guide for ' },
  { label: 'What’s due', prompt: 'What should I review today?' },
  { label: 'Lecture notes', prompt: 'Open my latest lecture notes' },
  { label: 'New guide', prompt: 'Make a study guide from this:\n\n' },
];

const STARTERS = ['What should I review today?', 'Quiz me on my newest guide', 'Explain the hardest idea in my last guide', 'Show me all my study guides'];

function readThreads() {
  try { return JSON.parse(localStorage.getItem(THREADS_KEY) || '[]'); } catch { return []; }
}

function saveThreads(threads) {
  try { localStorage.setItem(THREADS_KEY, JSON.stringify(threads.slice(0, 40))); } catch { /* storage full or blocked */ }
}

// Keeps the last turns, always starting on a student message (never a lone tool result).
function trimHistory(history) {
  let out = history.slice(-MAX_HISTORY);
  while (out.length && !(out[0].role === 'user' && typeof out[0].content === 'string')) out = out.slice(1);
  return out;
}

const newId = () => Math.random().toString(36).slice(2, 10);

async function chatFetch(options = {}) {
  const request = () => fetch('/api/study-chat', { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...options.headers } });
  let response = await request();
  if (response.status === 401 && await tryRefreshToken()) response = await request();
  return response;
}

// Bold and bullet lists only; text stays text (no HTML from the model).
function Rich({ text }) {
  const blocks = [];
  let list = null;
  text.split('\n').forEach((line, index) => {
    const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (bullet) {
      if (!list) { list = []; blocks.push({ list }); }
      list.push(bullet[1]);
    } else {
      list = null;
      if (line.trim()) blocks.push({ line, index });
    }
  });
  const inline = value => value.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((part, at) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={at}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return <em key={at}>{part.slice(1, -1)}</em>;
    return part;
  });
  return blocks.map((block, at) => (block.list
    ? <ul key={at}>{block.list.map((item, k) => <li key={k}>{inline(item)}</li>)}</ul>
    : <p key={at}>{inline(block.line.replace(/^#+\s*/, ''))}</p>));
}

export default function ChatWorkspace() {
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState('');
  const [workspace, setWorkspace] = useState({ projects: [], loose: [] });
  const [projectId, setProjectId] = useState(null);
  const [open, setOpen] = useState({});
  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [activeWindow, setActiveWindow] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const scroller = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    if (!getToken()) { window.location.assign('/?next=/chat'); return; }
    setThreads(readThreads());
    chatFetch().then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setBlocked(data.detail || 'Could not open the chat.'); return; }
      setWorkspace(data);
    }).catch(() => setBlocked('Could not reach Classroom.')).finally(() => setReady(true));
  }, []);

  const thread = threads.find(item => item.id === threadId) || null;
  const project = workspace.projects.find(item => item.id === projectId) || null;
  const items = thread?.items || [];
  const windows = thread?.windows || [];

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [items.length, busy]);

  const updateThread = useCallback((id, change) => {
    setThreads(list => {
      const next = list.map(item => (item.id === id ? { ...item, ...change(item), updated: Date.now() } : item));
      next.sort((a, b) => b.updated - a.updated);
      saveThreads(next);
      return next;
    });
  }, []);

  const send = useCallback(async (text, options = {}) => {
    const message = String(text || '').trim();
    if (!message || busy) return;
    const scope = options.projectId !== undefined ? options.projectId : projectId;
    const scopeProject = workspace.projects.find(item => item.id === scope) || null;
    let id = options.fresh ? null : threadId;
    if (!id) {
      id = newId();
      const created = { id, projectId: scope, title: message.slice(0, 60), items: [], history: [], windows: [], updated: Date.now() };
      setThreads(list => { const next = [created, ...list]; saveThreads(next); return next; });
      setThreadId(id);
    }
    if (options.projectId !== undefined) setProjectId(scope);
    setDraft('');
    setMenu(false);
    setBusy(true);
    const current = readThreads().find(item => item.id === id);
    const history = trimHistory([...(current?.history || []), { role: 'user', content: message }]);
    updateThread(id, item => ({ items: [...item.items, { role: 'user', text: message }] }));

    try {
      const response = await chatFetch({ method: 'POST', body: JSON.stringify({ messages: history, projectId: scope, projectName: scopeProject?.name }) });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Cordia could not answer just now.');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'text') updateThread(id, item => ({ items: [...item.items, { role: 'assistant', text: event.text }] }));
          if (event.type === 'tool') {
            updateThread(id, item => {
              const exists = item.items.some(entry => entry.role === 'tool' && entry.id === event.id);
              const entry = { role: 'tool', id: event.id, name: event.name, status: event.status, error: event.error };
              return { items: exists ? item.items.map(row => (row.role === 'tool' && row.id === event.id ? { ...row, ...entry } : row)) : [...item.items, entry] };
            });
          }
          if (event.type === 'window') {
            updateThread(id, item => ({
              windows: [...item.windows.filter(win => win.id !== event.id), { id: event.id, kind: event.kind, data: event.data }].slice(-6),
              items: item.items.map(row => (row.role === 'tool' && row.id === event.id ? { ...row, kind: event.kind } : row)),
            }));
            setActiveWindow(event.id);
            setPanelOpen(true);
          }
          if (event.type === 'done') updateThread(id, () => ({ history: trimHistory(event.history || []) }));
          if (event.type === 'error') updateThread(id, item => ({ items: [...item.items, { role: 'error', text: event.message }] }));
        }
      }
    } catch (error) {
      updateThread(id, item => ({ items: [...item.items, { role: 'error', text: error.message || 'Something went wrong.' }] }));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }, [busy, projectId, threadId, updateThread, workspace.projects]);

  const newChat = scope => { setThreadId(null); setProjectId(scope === undefined ? projectId : scope); setActiveWindow(null); setNavOpen(false); input.current?.focus(); };
  const openGuide = (guide, folderId) => { setNavOpen(false); send(`Open “${guide.title}”.`, { projectId: folderId, fresh: !thread || thread.projectId !== folderId }); };
  const projectThreads = useMemo(() => threads.filter(item => (projectId ? item.projectId === projectId : true)).slice(0, 12), [threads, projectId]);
  const firstName = (getUserName() || '').split(' ')[0];

  if (!ready) return <div className="cc-shell cc-loading"><span className="cc-dot" /></div>;
  if (blocked) {
    return (
      <div className="cc-shell cc-blocked">
        <img src="/cordia-wordmark.webp" alt="Cordia Classroom" className="cc-wordmark" />
        <p>{blocked}</p>
        <a href="/dashboard">Back to Classroom</a>
      </div>
    );
  }

  const composer = (
    <form className="cc-composer" onSubmit={event => { event.preventDefault(); send(draft); }}>
      <textarea
        ref={input}
        value={draft}
        rows={1}
        placeholder={project ? `Ask about ${project.name}…` : 'Ask Cordia anything about your classes…'}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(draft); } }}
        aria-label="Message Cordia"
      />
      <div className="cc-composer-bar">
        <div className="cc-tools">
          <button type="button" className="cc-icon" aria-label="Tools" aria-expanded={menu} onClick={() => setMenu(!menu)}>+</button>
          {menu && (
            <div className="cc-menu" role="menu">
              {TOOL_MENU.map(tool => (
                <button type="button" role="menuitem" key={tool.label} onClick={() => { setDraft(tool.prompt); setMenu(false); input.current?.focus(); }}>{tool.label}</button>
              ))}
            </div>
          )}
          {project && <span className="cc-chip">{project.name}<button type="button" aria-label="Leave class" onClick={() => setProjectId(null)}>×</button></span>}
        </div>
        <button type="submit" className="cc-send" disabled={busy || !draft.trim()} aria-label="Send">↑</button>
      </div>
    </form>
  );

  return (
    <div className={`cc-shell ${windows.length && panelOpen ? 'has-panel' : ''} ${navOpen ? 'nav-open' : ''}`}>
      <Head><title>Chat · Cordia Classroom</title></Head>

      <nav className="cc-nav" aria-label="Classes">
        <div className="cc-nav-top">
          <img src="/cordia-wordmark.webp" alt="Cordia Classroom" className="cc-wordmark" />
          <button type="button" className="cc-new" onClick={() => newChat(null)}>New chat</button>
        </div>
        <p className="cc-label">Classes</p>
        <ul className="cc-projects">
          {workspace.projects.map(item => (
            <li key={item.id}>
              <button type="button" className={`cc-project ${projectId === item.id ? 'is-active' : ''}`} onClick={() => { setOpen(state => ({ ...state, [item.id]: !state[item.id] })); newChat(item.id); }}>
                <span className="cc-caret">{open[item.id] ? '▾' : '▸'}</span>{item.name}
                <span className="cc-count">{item.guides.length}</span>
              </button>
              {open[item.id] && (
                <ul className="cc-guides">
                  {item.guides.length ? item.guides.map(guide => (
                    <li key={guide.id}><button type="button" onClick={() => openGuide(guide, item.id)}>{guide.title}</button></li>
                  )) : <li className="cc-empty">No guides yet</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {projectThreads.length > 0 && (
          <>
            <p className="cc-label">{project ? `Chats in ${project.name}` : 'Recent chats'}</p>
            <ul className="cc-threads">
              {projectThreads.map(item => (
                <li key={item.id}>
                  <button type="button" className={item.id === threadId ? 'is-active' : ''} onClick={() => { setThreadId(item.id); setProjectId(item.projectId); setNavOpen(false); }}>{item.title}</button>
                </li>
              ))}
            </ul>
          </>
        )}
        <a className="cc-back" href="/dashboard">Classic Classroom</a>
      </nav>

      <main className="cc-main">
        <header className="cc-top">
          <button type="button" className="cc-icon cc-burger" aria-label="Classes" onClick={() => setNavOpen(!navOpen)}>☰</button>
          <span className="cc-where">{project ? project.name : 'All classes'}</span>
          {windows.length > 0 && !panelOpen && <button type="button" className="cc-reopen" onClick={() => setPanelOpen(true)}>Windows ({windows.length})</button>}
        </header>

        {!items.length ? (
          <div className="cc-hello">
            <h1>{firstName ? `What are we studying, ${firstName}?` : 'What are we studying?'}</h1>
            {composer}
            <div className="cc-starters">
              {STARTERS.map(text => <button type="button" key={text} onClick={() => send(text)}>{text}</button>)}
            </div>
          </div>
        ) : (
          <>
            <div className="cc-log" ref={scroller}>
              <div className="cc-log-inner">
                {items.map((item, index) => {
                  if (item.role === 'user') return <div className="cc-msg cc-user" key={index}>{item.text}</div>;
                  if (item.role === 'error') return <div className="cc-msg cc-error" key={index}>{item.text}</div>;
                  if (item.role === 'tool') {
                    const done = item.status === 'done';
                    return (
                      <button type="button" key={item.id} className={`cc-tool is-${item.status}`} disabled={!item.kind} onClick={() => { setActiveWindow(item.id); setPanelOpen(true); }}>
                        <span className="cc-tool-dot" />
                        {item.status === 'error' ? item.error : done && item.kind ? `Opened ${windowLabel(item.kind).toLowerCase()}` : TOOL_TEXT[item.name] || item.name}
                        {done && item.kind && <span className="cc-tool-open">View</span>}
                      </button>
                    );
                  }
                  return <div className="cc-msg cc-bot" key={index}><Rich text={item.text} /></div>;
                })}
                {busy && <div className="cc-thinking"><span className="cc-dot" /></div>}
              </div>
            </div>
            <div className="cc-dock">{composer}</div>
          </>
        )}
      </main>

      {windows.length > 0 && panelOpen && (
        <WindowPanel windows={windows} activeId={activeWindow} onSelect={setActiveWindow} onClose={() => setPanelOpen(false)} ask={text => send(text)} />
      )}
    </div>
  );
}
