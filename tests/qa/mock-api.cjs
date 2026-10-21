// Mocked Classroom API + Supabase Auth for local browser tests. Never hits production.
const USER = '11111111-2222-4333-8444-555555555555';
function b64(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
const TOKEN = `${b64({ alg: 'HS256' })}.${b64({ sub: USER, email: 'test.student@example.com', exp: Math.floor(Date.now() / 1000) + 86400, user_metadata: { name: 'Test Student' } })}.sig`;

function sampleGuide(id, title, extra = {}) {
  const pairs = Array.from({ length: 7 }, (_, i) => `Q${i + 1}: What is concept ${i + 1} in ${title}?\nA${i + 1}: Concept ${i + 1} is an idea explained in plain words so it can be studied and recalled later on.`).join('\n');
  return { id, title, folder_id: null, created_at: new Date(Date.now() - 86400000 * 3).toISOString(), read_progress: 0.07, is_bookmarked: false,
    study_guide: pairs, notes: '- Note one\n- Note two', flashcards: Array.from({ length: 8 }, (_, i) => ({ front: `Term ${i + 1}`, back: `Definition ${i + 1}` })),
    flashcard_progress: { known: [0, 1] }, source_title: 'Lecture 3.pdf', source_type: 'file', ...extra };
}

function createState(populated) {
  return {
    populated,
    onboarding: populated ? { step: 'done', completed: true } : { step: 'style', completed: false },
    meta: {},
    folders: populated ? [{ id: 'f0000000-0000-4000-8000-000000000001', name: 'Biology 101' }] : [],
    guides: populated ? [
      sampleGuide('a0000000-0000-4000-8000-000000000001', 'Pledge Test', { folder_id: 'f0000000-0000-4000-8000-000000000001' }),
      sampleGuide('a0000000-0000-4000-8000-000000000002', 'Cell Biology Basics', { is_bookmarked: true, read_progress: 0.5 }),
      sampleGuide('a0000000-0000-4000-8000-000000000003', 'Nursing Pharmacology', { domain: 'nursing' }),
    ] : [],
    notes: populated ? [{ id: 'n1', title: 'Lecture notes', content: '<p>Mitochondria make energy.</p>', updated_at: new Date().toISOString() }] : [],
    tutor: { id: 's1', status: 'idle', messages: [], conversation_version: 1, skills: [{ id: 'explain', label: 'Explain', available: true }, { id: 'organize', label: 'Organize', available: true }] },
    calls: [],
  };
}

function summary(guide) {
  const { study_guide, notes, flashcards, flashcard_progress, ...rest } = guide;
  return { ...rest, flashcard_count: flashcards?.length || 0 };
}

async function install(context, state) {
  await context.route(/supabase\.co\/auth\/v1\//, async route => {
    const req = route.request();
    const url = req.url();
    if (url.endsWith('/auth/v1/user')) {
      if (req.method() === 'PUT') { const body = JSON.parse(req.postData() || '{}'); state.meta = { ...state.meta, ...(body.data || {}) }; }
      return route.fulfill({ json: { id: USER, user_metadata: state.meta } });
    }
    if (url.includes('/otp')) { state.otp = JSON.parse(req.postData() || '{}'); return route.fulfill({ json: {} }); }
    if (url.includes('/verify')) {
      const body = JSON.parse(req.postData() || '{}');
      state.verified = body;
      if (body.token !== '123456') return route.fulfill({ status: 403, json: { code: 'otp_expired', msg: 'Token has expired or is invalid' } });
      return route.fulfill({ json: { access_token: TOKEN, refresh_token: 'r2', token_type: 'bearer', expires_in: 3600, user: { id: USER, phone: (body.phone || '').replace('+', '') } } });
    }
    if (url.includes('/signup')) return route.fulfill({ status: 422, json: { code: 'weak_password', msg: 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};\':"|<>?,./`~.' } });
    if (url.includes('/token')) return route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } });
    return route.fulfill({ json: {} });
  });
  await context.route(/localhost:8000\//, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch { return {}; } })() : {};
    state.calls.push(`${method} ${path}`);
    const json = data => route.fulfill({ json: data });
    let m;
    if (path === '/auth/me') return json({ user_id: USER, email: 'test.student@example.com', name: 'Test Student' });
    if (path === '/auth/profile') return json({ updated: ['university'] });
    if (path === '/feedback/reviewer-status') return json({ reviewer: false });
    if (path === '/folders' && method === 'GET') return json({ folders: state.folders });
    if ((m = path.match(/^\/folders\/([^/]+)$/)) && method === 'PATCH') { const f = state.folders.find(item => item.id === m[1]); if (f) f.name = body.name; return json(f ? { folder: f } : { detail: 'Class not found' }); }
    // Canvas-linked class: set state.canvas (a /canvas/status payload) to turn these on.
    if (path === '/canvas/status' && state.canvas) return json(state.canvas);
    if ((m = path.match(/^\/classes\/([^/]+)\/deadlines$/))) return json({ deadlines: state.deadlines || [] });
    if ((m = path.match(/^\/classes\/([^/]+)$/)) && method === 'GET' && state.canvas) return json({ class: { id: m[1], code: 'MUL 101', name: 'Introduction to Music', school: 'Usaonline' }, sets: [] });
    if ((m = path.match(/^\/canvas\/courses\/(\d+)\/files$/))) return json({ files: [{ id: 1, name: 'Week 3 - Rhythm and Meter.pdf', size: 2400000, type: 'application/pdf' }, { id: 2, name: 'Syllabus.docx', size: 54000 }] });
    if ((m = path.match(/^\/canvas\/courses\/(\d+)\/grades$/))) return json(state.grades || { score: null, letter: null, weighted: false, upcoming: [] });
    if ((m = path.match(/^\/calendar\/items\/([^/]+)\/done$/)) && method === 'PUT') { state.marks = { ...(state.marks || {}), [decodeURIComponent(m[1])]: body.done }; return json({ item_key: decodeURIComponent(m[1]), done: body.done }); }
    if (path === '/folders' && method === 'POST') { const f = { id: 'f' + Date.now(), name: body.name }; state.folders.unshift(f); return json({ folder: f }); }
    if (path === '/guides' && method === 'GET') return json({ guides: url.searchParams.get('fields') === 'summary' ? state.guides.map(summary) : state.guides });
    if (path === '/guides' && method === 'POST') {
      const g = { ...sampleGuide('b' + String(Date.now()).padStart(7, '0').slice(-7) + '-0000-4000-8000-000000000009', body.title), ...body, created_at: new Date().toISOString(), read_progress: 0, flashcard_progress: {} };
      state.guides.unshift(g); return json({ guide: g });
    }
    if ((m = path.match(/^\/guides\/([^/]+)$/))) {
      const g = state.guides.find(x => x.id === m[1]);
      if (method === 'DELETE') { state.guides = state.guides.filter(x => x.id !== m[1]); return json({ deleted: true }); }
      if (method === 'PATCH') { Object.assign(g, body); return json({ guide: g }); }
      return g ? json({ guide: g }) : route.fulfill({ status: 404, json: { detail: 'Guide not found' } });
    }
    if ((m = path.match(/^\/guides\/([^/]+)\/(bookmark|rename|move|read-progress|flashcard-progress)$/))) {
      const g = state.guides.find(x => x.id === m[1]);
      if (m[2] === 'bookmark') { g.is_bookmarked = !g.is_bookmarked; return json({ is_bookmarked: g.is_bookmarked }); }
      if (m[2] === 'rename') { g.title = body.title; return json({ title: g.title }); }
      if (m[2] === 'move') { g.folder_id = body.folder_id; return json({ updated: true }); }
      if (m[2] === 'flashcard-progress') { g.flashcard_progress = body; return json({ updated: true }); }
      return json({ updated: true });
    }
    if (path === '/stats/overview') return json({ total_guides: state.guides.length, cards_studied: state.populated ? 20 : 0, avg_quiz_score: 0, current_streak: 1, minutes_today: 0 });
    if (path === '/stats/streak') return json({ current_streak: state.populated ? 1 : 0, studied_today: true, week: [] });
    if (path === '/stats/insights') return json(state.populated ? { answered: 12, strengths: [{ kind: 'mc', label: 'Definitions', correct: 7, total: 8 }], needs_work: [{ kind: 'app', label: 'Applying ideas', correct: 2, total: 4 }], tips: [{ text: 'Mix topics in one session.', source: 'Rohrer 2012' }] } : { answered: 0, strengths: [], needs_work: [], tips: [] });
    if (path.startsWith('/stats/')) return json({ ok: true });
    if (path === '/onboarding' && method === 'GET') return json(state.onboarding);
    if (path === '/onboarding' && method === 'PUT') { state.onboarding = { step: body.step, completed: body.step === 'done' }; return json(state.onboarding); }
    if (path === '/onboarding/checklist') return json({ extension_guide: false, learn_your_way: false, practice: false, smartnote: false });
    if (path === '/smart_notes' && method === 'GET') return json({ notes: state.notes });
    if (path === '/smart_notes' && method === 'POST') { const n = { id: 'n' + Date.now(), title: body.title, content: '' }; state.notes.unshift(n); return json({ note: n }); }
    if ((m = path.match(/^\/smart_notes\/([^/]+)$/)) && method === 'PUT') { const n = state.notes.find(item => item.id === m[1]); if (n) Object.assign(n, body); return json({ note: n }); }
    if ((m = path.match(/^\/smart_notes\/([^/]+)$/))) return json({ note: state.notes.find(n => n.id === m[1]) || state.notes[0] });
    if (path === '/calendar/connection' && method === 'GET') return json(state.populated ? { connected: true, items: [
      { id: 'c1', title: 'Lab report [BIO-101-002]', due_at: new Date(Date.now() + 86400000).toISOString(), type: 'assignment', url: 'https://school.instructure.com/courses/1/assignments/1' },
      { id: 'c2', title: 'Midterm [BIO-101-002]', due_at: new Date(Date.now() + 3 * 86400000).toISOString(), type: 'exam' },
      ...Array.from({ length: 6 }, (_, i) => ({ id: 't' + i, title: `Reading quiz ${i + 1} [EH-102-136]`, due_at: new Date(new Date().setHours(10 + i, 0, 0, 0)).toISOString(), type: i % 2 ? 'quiz' : 'assignment' })),
    ] } : { connected: false });
    if (path === '/calendar/connection' && method === 'POST') return json({ connected: true, items: [] });
    if (path === '/tutor/session') return json(state.tutor);
    if (path === '/tutor/chats') return json({ chats: state.chats || [] });
    if (path === '/tutor/session/new') {
      state.chats = state.chats || [];
      if (state.tutor.messages.length) state.chats.unshift({ id: 'c' + (state.chats.length + 1), guide_id: state.tutor.active_guide_id || null, title: state.tutor.messages[0].text.slice(0, 80), updated_at: new Date().toISOString(), messages: state.tutor.messages });
      const resumed = body.resume_id && state.chats.find(chat => chat.id === body.resume_id);
      if (resumed) state.chats = state.chats.filter(chat => chat !== resumed);
      state.tutor = { ...state.tutor, messages: resumed ? resumed.messages : [], active_guide_id: resumed ? resumed.guide_id : body.guide_id, conversation_version: state.tutor.conversation_version + 1 };
      return json(state.tutor);
    }
    if (path === '/chat') {
      state.tutor = { ...state.tutor, messages: [...state.tutor.messages, { role: 'user', text: body.question }, { role: 'ai', text: 'Here is a **simple** explanation from your guide.' }], conversation_version: state.tutor.conversation_version + 1 };
      return json({ answer: 'ok', session: state.tutor });
    }
    if ((m = path.match(/^\/quiz\/([^/]+)\/history$/))) return json({ attempts: state.populated ? [{ id: 'q1', score: 80, correct_answers: 4, total_questions: 5, completed_at: new Date().toISOString() }] : [] });
    if ((m = path.match(/^\/quiz\/([^/]+)\/session$/))) {
      const questions = Array.from({ length: 6 }, (_, i) => ({ question: `Question ${i + 1}?`, options: [`Right ${i + 1}`, `Wrong A${i}`, `Wrong B${i}`, `Wrong C${i}`], correct_index: 0 }));
      return json({ questions, cards: questions.map((_, i) => ({ type: 'mc', concepts: [i] })) });
    }
    if ((m = path.match(/^\/quiz\/([^/]+)\/submit$/))) return json({ score: 67 });
    if ((m = path.match(/^\/practice\/([^/]+)\/state$/))) return json({ practice: null });
    if (path === '/generate') return json({ study_guide: 'Q1: Where is ATP made?\nA1: In the mitochondria, through cellular respiration.', notes: '- ATP stores energy', flashcards: [{ front: 'ATP', back: 'Energy carrier' }] });
    if (path === '/lectures/usage') return json({ minutes_used: 36, minutes_limit: 120, minutes_left: 84, plan: 'free' });
    if (path === '/lectures/terms') return json({ terms: ['mitochondria', 'ATP'] });
    if (path === '/lectures/chunk') {
      const seq = Number((req.postData() || '').match(/name="seq"\r\n\r\n(\d+)/)?.[1] || 0);
      state.lectureChunks = [...(state.lectureChunks || []), seq];
      return json({ text: `Part ${seq + 1} of the lecture covers cell energy and ATP.`, minutes_charged: 0 });
    }
    if (path === '/lectures/notes') return json({ notes: [{ kind: 'heading', text: 'Cell energy', at_ms: 0 }, { kind: 'exam', text: 'ATP is made in mitochondria', at_ms: 20000 }], class_id: state.folders[0]?.id || '' });
    if (path === '/lectures/finish') return json({ title: 'Cell Energy and ATP', transcript: (body.segments || []).map(s => s.text).join(' ') + ' Mitochondria make ATP through respiration.\nATP stores energy.\nCells use ATP for work.' });
    if (path === '/lectures/transcribe-file') return json({ segments: [{ start_ms: 0, text: 'An uploaded lecture about the Krebs cycle and how cells make energy in plain terms.' }] });
    if (path === '/billing/status') return json({ plan: 'free', features: { guide: { used: 1, limit: 3 }, tutor: { used: 2, limit: 10 }, learn_my_way: { used: 0, limit: 5 }, retain_types: { remaining: 1 } }, trial_available: true });
    if (path === '/learning-style') return json({ enabled: false, style: null });
    if (path === '/explanation-preference') return json({ text: '' });
    if (path === '/search') return json({ results: state.guides.filter(g => g.title.toLowerCase().includes((url.searchParams.get('q') || '').toLowerCase())).map(g => ({ id: g.id, title: g.title })) });
    return json({});
  });
}

module.exports = { install, createState, TOKEN, USER };
