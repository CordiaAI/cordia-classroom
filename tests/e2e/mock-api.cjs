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
    tutor: { id: 's1', status: 'idle', messages: [], conversation_version: 1, skills: [{ id: 'explain', label: 'Explain', available: true }] },
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
    if ((m = path.match(/^\/smart_notes\/([^/]+)$/))) return json({ note: state.notes.find(n => n.id === m[1]) || state.notes[0] });
    if (path === '/calendar/connection' && method === 'GET') return json(state.populated ? { connected: true, items: [
      { id: 'c1', title: 'Lab report', due_at: new Date(Date.now() + 86400000).toISOString(), type: 'assignment', course: 'BIO' },
      { id: 'c2', title: 'Midterm', due_at: new Date(Date.now() + 3 * 86400000).toISOString(), type: 'exam', course: 'BIO' },
    ] } : { connected: false });
    if (path === '/calendar/connection' && method === 'POST') return json({ connected: true, items: [] });
    if (path === '/tutor/session') return json(state.tutor);
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
    if (path === '/billing/status') return json({ plan: 'free', features: { guide: { used: 1, limit: 3 }, tutor: { used: 2, limit: 10 }, learn_my_way: { used: 0, limit: 5 }, retain_types: { remaining: 1 } }, trial_available: true });
    if (path === '/learning-style') return json({ enabled: false, style: null });
    if (path === '/explanation-preference') return json({ text: '' });
    if (path === '/search') return json({ results: state.guides.filter(g => g.title.toLowerCase().includes((url.searchParams.get('q') || '').toLowerCase())).map(g => ({ id: g.id, title: g.title })) });
    return json({});
  });
}

module.exports = { install, createState, TOKEN, USER };
