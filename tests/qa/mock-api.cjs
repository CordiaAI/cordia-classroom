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
  const { study_guide, notes, flashcards, ...rest } = guide;
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
    if (path === '/calendar/coursework') {
      if (!state.coursework) return json({ connected: false, counts: { upcoming: 0, missing: 0, completed: 0 }, upcoming: [], missing: [], completed: [] });
      const at = days => new Date(Date.now() + days * 86400000).toISOString();
      const mk = (id, title, course, days, extra = {}) => ({ id: 'canvas-' + id, title, course, due_at: at(days), points: 50, url: 'https://school.instructure.com/courses/1/assignments/' + id, done: false, type: 'assignment', ...extra });
      const upcoming = [mk(1, 'Concert Report #2', 'MUL-101-102', 1, { points: 60 }), mk(2, 'Concert #2 program', 'MUL-101-102', 1), mk(3, 'Narrative Timeline', 'REL-200-101', 3), mk(4, 'A05 Seven Ethical Frameworks Quiz', 'BUS-101-101', 6, { points: 100 }), mk(5, 'Packback #9', 'REL-200-101', 6, { points: 10 }), mk(6, 'A07AA Rough Draft, Resume', 'BUS-101-101', 7), mk(7, 'Reading response 8', 'ENG-102-104', 9)];
      const missing = [mk(10, 'A03 Career Vision Statement Video Assignment', 'BUS-101-101', -6), mk(11, 'SMART Goals', 'BUS-150-103', -4), mk(12, 'Melody Video', 'MUL-101-102', -3), mk(13, 'Develop Your Skills | Financial Literacy', 'BUS-150-103', -2), mk(14, 'Week 8 quiz', 'REL-200-101', -9)];
      const completed = Array.from({ length: 12 }, (_, i) => mk(30 + i, `Assignment ${i + 1}`, 'BUS-101-101', -(i * 3 + 1), { done: true, score: 40 + i }));
      return json({ connected: true, counts: { upcoming: upcoming.length, missing: missing.length, completed: 170 }, upcoming, missing, completed });
    }
    if (path === '/stats/activity') {
      const day = back => { const d = new Date(Date.now() - back * 86400000); return d.toISOString().slice(0, 10); };
      const minutes = [0, 25, 40, 0, 15, 60, 35, 0, 0, 20, 45, 30, 0, 10, 55, 70, 0, 25, 30, 0, 15, 40, 85, 20, 0, 35, 50, 0, 25, 45];
      const recent = state.populated ? minutes.map((m, i) => ({ date: day(29 - i), minutes: m, cards: m ? Math.round(m / 2) : 0 })) : minutes.map((_, i) => ({ date: day(29 - i), minutes: 0, cards: 0 }));
      const older = state.populated ? Array.from({ length: 90 }, (_, i) => ({ date: day(40 + i * 3), minutes: (i * 37) % 70, sessions: 1, cards: 5 })).filter(d => d.minutes) : [];
      return json({
        days: [...older.reverse(), ...recent.filter(d => d.minutes).map(d => ({ ...d, sessions: 2 }))],
        recent,
        by_kind: state.populated ? { read: 420, flashcard: 310, quiz: 95, timer: 60, browse: 25 } : { read: 0, flashcard: 0, quiz: 0, timer: 0, browse: 0 },
        hours: state.populated ? [0, 0, 0, 0, 0, 0, 0, 10, 25, 40, 30, 15, 20, 35, 45, 30, 25, 40, 60, 85, 110, 70, 30, 5] : Array(24).fill(0),
        classes: state.populated ? [{ id: state.folders[0]?.id || 'f1', name: 'Biology 101', minutes: 520 }, { id: 'f2', name: 'CS 101 · Intro to Programming', minutes: 260 }, { id: 'f3', name: 'Art History: Renaissance', minutes: 130 }] : [],
        quizzes: state.populated ? [62, 70, 68, 75, 81, 78, 88, 92].map((score, i) => ({ date: day(28 - i * 4), score, title: ['Cell Biology Basics', 'Nursing Pharmacology', 'Pledge Test'][i % 3] })) : [],
      });
    }
    if (path === '/stats/insights') return json(state.populated ? { answered: 12, strengths: [{ kind: 'mc', label: 'Definitions', correct: 7, total: 8 }], needs_work: [{ kind: 'app', label: 'Applying ideas', correct: 2, total: 4 }], tips: [{ text: 'Mix topics in one session.', source: 'Rohrer 2012' }] } : { answered: 0, strengths: [], needs_work: [], tips: [] });
    if (path.startsWith('/stats/')) return json({ ok: true });
    if (path === '/onboarding' && method === 'GET') return json(state.onboarding);
    if (path === '/onboarding' && method === 'PUT') { state.onboarding = { step: body.step, completed: body.step === 'done' }; return json(state.onboarding); }
    if (path === '/onboarding/checklist') return json({ extension_guide: false, learn_your_way: false, practice: false, smartnote: false });
    if (path === '/smart_notes' && method === 'GET') return json({ notes: state.notes });
    if (path === '/smart_notes' && method === 'POST') { const n = { id: 'n' + Date.now(), title: body.title, content: '' }; state.notes.unshift(n); return json({ note: n }); }
    if ((m = path.match(/^\/smart_notes\/([^/]+)$/)) && method === 'PUT') { const n = state.notes.find(item => item.id === m[1]); if (n) Object.assign(n, body); return json({ note: n }); }
    if ((m = path.match(/^\/smart_notes\/([^/]+)$/)) && method === 'DELETE') { state.notes = state.notes.filter(n => n.id !== m[1]); return json({ deleted: true }); }
    if ((m = path.match(/^\/smart_notes\/([^/]+)$/))) return json({ note: state.notes.find(n => n.id === m[1]) || state.notes[0] });
    if (path === '/calendar/connection' && method === 'GET') return json(state.populated ? { connected: true, items: [
      { id: 'c1', title: 'Lab report [BIO-101-002]', due_at: new Date(Date.now() + 86400000).toISOString(), type: 'assignment', url: 'https://school.instructure.com/courses/1/assignments/1' },
      { id: 'c2', title: 'Midterm [BIO-101-002]', due_at: new Date(Date.now() + 3 * 86400000).toISOString(), type: 'exam' },
      ...Array.from({ length: 6 }, (_, i) => ({ id: 't' + i, title: `Reading quiz ${i + 1} [EH-102-136]`, due_at: new Date(new Date().setHours(10 + i, 0, 0, 0)).toISOString(), type: i % 2 ? 'quiz' : 'assignment' })),
    ] } : { connected: false });
    if (path === '/calendar/connection' && method === 'POST') return json({ connected: true, items: [] });
    if (path === '/tutor/session') return json(state.tutor);
    if (path === '/tutor/chats') return json({ chats: state.chats || [] });
    if (path === '/connectors' && method === 'GET') {
      state.linked = state.linked || {};
      return json({ connectors: [['gcal', 'Google Calendar', 'Put your deadlines on your calendar.'], ['apple_calendar', 'Apple Calendar', 'Subscribe to your deadlines on iPhone and Mac.'], ['gtasks', 'Google Tasks', 'Turn deadlines into to-dos.'], ['gdrive', 'Google Drive', 'Import course files into a guide.'], ['dropbox', 'Dropbox', 'Class folders that fill your Library.'], ['gdocs', 'Google Docs', 'Import notes into a guide.'], ['notion', 'Notion', 'Import notes into a guide.'], ['gsheets', 'Google Sheets', 'Your grades and study time in a sheet.'], ['github', 'GitHub', 'Your code on programming assignments.'], ['slack', 'Slack', 'Class channels and study sessions.'], ['gmail', 'Gmail', 'Cordia texts you about emails that need a reply.'], ['outlook', 'Outlook', 'Cordia texts you about emails that need a reply.'], ['ynab', 'YNAB', 'Check your budget by text.']].map(([id, name, tagline]) => ({ id, name, tagline, available: true, connected: Boolean(state.linked[id]), ...(['gmail', 'outlook'].includes(id) ? { watch_dates: Boolean((state.watch || {})[id]) } : {}), uses: { tutor: true, assistant: true }, health: { sync_on: Boolean((state.syncing || {})[id]), last_synced_at: state.syncing?.[id] ? new Date(Date.now() - 240000).toISOString() : null, stats: state.syncing?.[id] ? (id === 'gcal' ? { blocks: 6 } : { tasks: 12 }) : {}, error: null, needs_reconnect: false } })) });
    }
    if ((m = path.match(/^\/connectors\/([a-z_]+)\/connect$/))) { state.linked = { ...(state.linked || {}), [m[1]]: true }; return json({ redirect_url: `/settings?section=connectors&connected=${m[1]}` }); }
    if ((m = path.match(/^\/connectors\/([a-z_]+)$/)) && method === 'DELETE') { delete state.linked[m[1]]; return json({ ok: true }); }
    if ((m = path.match(/^\/sync\/(gcal|gtasks)$/))) { state.syncing = { ...(state.syncing || {}), [m[1]]: method === 'POST' }; return json({ on: method === 'POST' }); }
    if (path === '/alerts' && method === 'GET') return json({ alerts: state.populated ? [...(state.extraAlerts || []),
      { id: 'canvas:1', kind: 'grade_drop', course: 'BIO-101', from: 88.5, to: 84, at: new Date().toISOString() },
      { id: 'announcement:5', kind: 'deadline', title: 'Lab report moved', summary: 'The lab report is now due Friday at noon.', course: 'BIO-101' },
      { id: 'change:x1', change_id: 'x1', kind: 'date_change', change: 'moved', title: 'Midterm [BIO-101-002]', sender: 'Prof. Dana Lee <lee@state.edu>', summary: 'The midterm moves to Friday because of the campus closure.', old_due: new Date(Date.now() + 3 * 86400000).toISOString(), new_due: new Date(Date.now() + 5 * 86400000).toISOString() },
      { id: 'exam:c2', kind: 'exam_prep', title: 'Midterm [BIO-101-002]', item_key: 'c2', days: 3, course: 'BIO-101' },
      { id: 'canvas:m', kind: 'module_done', module: 'Week 4: Cell energy', course: 'BIO-101', folder_id: 'f1', prefix: 'BIO-101 · Week 4' },
    ] : [] });
    if (path.match(/^\/plans\/[^/]+\/review-set$/) || path === '/review-sets') return json({ guide: { id: state.guides[0]?.id || 'g1', title: 'Review' } });
    if (path.match(/^\/deadline-changes\/[^/]+\/accept$/)) return json({ ok: true, blocks_removed: 1, steps_moved: 2, blocks_added: 1 });
    if ((m = path.match(/^\/mail\/(gmail|outlook)\/watch$/))) { state.watch = { ...(state.watch || {}), [m[1]]: body.on }; return json({ on: body.on, checked: 2, found: 1 }); }
    if (path === '/drive/links' && method === 'GET') return json({ links: state.driveLinks || [] });
    if (path === '/drive/links' && method === 'PUT') { state.driveLinks = [...(state.driveLinks || []), { library_folder_id: body.library_folder_id, drive_folder_id: body.drive_folder_id, drive_folder_name: body.drive_folder_name }]; return json({ imported: 4, links: state.driveLinks }); }
    if (path.startsWith('/drive/links/') && method === 'DELETE') { state.driveLinks = []; return json({ links: [] }); }
    if (path === '/drive/folders') return json({ folders: [{ id: 'df1', name: 'BIO 101 Slides', edited: '2026-10-20' }, { id: 'df2', name: 'Readings', edited: '2026-10-11' }] });
    if (path === '/drive/sync') return json({ imported: 0, links: state.driveLinks || [] });
    if (path === '/drive/save') return json({ file_id: 'x', name: 'Guide.md' });
    if (path.startsWith('/alerts/')) return json({ ok: true });
    // Phase 5 apps (backend routers/apps.py).
    if ((m = path.match(/^\/dropbox\/(links|folders|sync)/))) {
      if (m[1] === 'folders') return json({ folders: [{ id: 'id:db1', name: 'BIO 101', path: '/School/BIO 101' }, { id: 'id:db2', name: 'Lab photos', path: '/School/Lab photos' }] });
      if (m[1] === 'sync') return json({ imported: 0, links: state.dropboxLinks || [] });
      if (method === 'PUT') { state.dropboxLinks = [{ library_folder_id: body.library_folder_id, drive_folder_id: body.drive_folder_id, drive_folder_name: body.drive_folder_name }]; return json({ imported: 3, links: state.dropboxLinks }); }
      if (method === 'DELETE') state.dropboxLinks = [];
      return json({ links: state.dropboxLinks || [] });
    }
    if (path === '/github/repos') return json({ repos: [{ full_name: 'sam/cs101-lab3', private: true, pushed: '2026-10-24', branch: 'main' }, { full_name: 'sam/portfolio', private: false, pushed: '2026-09-02', branch: 'main' }] });
    if (path.match(/^\/plans\/[^/]+\/repo$/)) {
      if (method === 'PUT') state.repo = { full_name: body.full_name, branch: body.branch, url: `https://github.com/${body.full_name}` };
      if (method === 'DELETE') state.repo = null;
      const perDay = [0, 0, 1, 0, 3, 2, 0, 0, 0, 4, 1, 0, 0, 0];
      return json({ repo: state.repo ? { ...state.repo, activity: { per_day: perDay, total: 11, last: { at: new Date(Date.now() - 3 * 86400000).toISOString(), message: 'Parse the input file and handle empty lines', url: 'https://github.com' } } } : null });
    }
    if (path === '/sheets/status') return json({ auto: Boolean(state.sheetsAuto), url: state.sheetUrl || null, last: state.sheetUrl ? new Date(Date.now() - 3600000).toISOString() : null });
    if (path === '/sheets/export') { state.sheetUrl = 'https://docs.google.com/spreadsheets/d/x/edit'; return json({ spreadsheet_id: 'x', url: state.sheetUrl, classes: 4, days: 37 }); }
    if (path === '/sheets/auto') { state.sheetsAuto = body.on; return json({ auto: body.on, url: state.sheetUrl || null, last: null }); }
    if (path === '/slack/channels') return json({ channels: [{ id: 'C0000001', name: 'bio-101', member: true }, { id: 'C0000002', name: 'cs101-study-group', member: true }, { id: 'C0000003', name: 'general', member: true }, { id: 'C0000004', name: 'chem-lab-help', member: false }] });
    if (path === '/slack/watched') { if (method === 'PUT') state.slackWatched = body.channels; return json({ channels: state.slackWatched || [] }); }
    if (path === '/slack/check') return json({ checked: 14, found: 1, posted: 1 });
    if (path === '/slack/session') return json({ posted: true, reminder_at: new Date(Date.now() + 3600000).toISOString() });
    if ((m = path.match(/^\/plans\/([^/]+)(\/schedule)?$/))) {
      state.plans = state.plans || {};
      const key = decodeURIComponent(m[1]);
      const due = Date.now() + 4 * 86400000;
      if (method === 'POST' && !m[2]) state.plans[key] = { item_key: key, effort_minutes: 150, effort_basis: 'A 50-point lab write-up with a 4-part rubric.', blocks: [], steps: [
        { id: 's1', title: 'Re-read the lab handout and gather your data', minutes: 30, due_at: new Date(due - 3 * 86400000).toISOString(), done: true },
        { id: 's2', title: 'Analyze the results and make the two graphs', minutes: 60, due_at: new Date(due - 1.5 * 86400000).toISOString(), done: false },
        { id: 's3', title: 'Write the discussion and check it against the rubric', minutes: 60, due_at: new Date(due).toISOString(), done: false },
      ] };
      if (m[2] && state.plans[key]) { state.plans[key].blocks = [0, 1].map(i => ({ id: 'b' + i, starts_at: new Date(Date.now() + (i + 1) * 86400000).toISOString(), ends_at: new Date(Date.now() + (i + 1) * 86400000 + 3600000).toISOString(), status: 'planned' })); return json({ plan: state.plans[key], added: 2 }); }
      if (method === 'DELETE') { delete state.plans[key]; return json({ ok: true }); }
      return json({ plan: state.plans[key] || null, points: 50, missing: false, draft: state.draft || null, repo: state.repo ? { full_name: state.repo.full_name, branch: state.repo.branch, url: state.repo.url } : null, rubric: [{ description: 'Data analysis', points: 20, long_description: 'Graphs are labeled and support the conclusion.' }, { description: 'Discussion', points: 20 }, { description: 'Formatting', points: 10 }] });
    }
    if (path.match(/^\/plans\/[^/]+\/steps\//)) return json({ step: { id: 's', done: body.done } });
    if (path.match(/^\/plans\/[^/]+\/draft$/)) { state.draft = method === 'PUT' ? { doc_id: body.doc_id, title: body.title, url: 'https://docs.google.com/document/d/x/edit', words: 1240 } : null; return json({ draft: state.draft }); }
    if (path === '/notion/home') return json({ home: state.notionHome || null });
    if (path === '/notion/pages') return json({ pages: [{ id: 'np1', title: 'School 2026', edited: '2026-10-20' }, { id: 'np2', title: 'BIO notes', edited: '2026-10-11' }] });
    if (path === '/notion/setup') { state.notionHome = { id: body.page_id, title: body.title }; return json({ on: true, added: 7, home: state.notionHome }); }
    if (path === '/notion/sync') return json({ on: true, added: 0, done_in_notion: 1 });
    if (path === '/docs/export' || path === '/notion/export') return json({ url: 'about:blank' });
    if (path.match(/^\/connectors\/[a-z]+\/library$/)) return json({ guide: { id: 'g1', title: 'Biology lecture 4 notes' } });
    if (path === '/week') return json({ due: [
      { id: 'c1', title: 'Lab report [BIO-101-002]', course: 'BIO-101', due_at: new Date(Date.now() + 86400000).toISOString(), effort_minutes: 150, planned: true, scheduled_minutes: 120 },
      { id: 'c2', title: 'Midterm [BIO-101-002]', course: 'BIO-101', due_at: new Date(Date.now() + 3 * 86400000).toISOString(), effort_minutes: null, planned: false, scheduled_minutes: 0 },
    ], grades: [{ course: 'BIO-101', score: 84, grade: 'B' }, { course: 'EH-102', score: 92.4, grade: null }], last_week: { planned_minutes: 240, done_minutes: 180 }, next_week_minutes: 120 });
    if (path === '/week/accept') return json({ added: 3 });
    if (path === '/announcements') return json({ announcements: [
      { canvas_announcement_id: 5, title: 'Lab report moved', summary: 'The lab report is now due Friday at noon.', changes: 'deadline', course: 'BIO-101' },
      { canvas_announcement_id: 6, title: 'Welcome to week 9', summary: 'Office hours move to Tuesday this week.', changes: 'none', course: 'EH-102' },
    ] });
    if (path === '/connectors/apple_calendar/feed') return json({ url: 'https://api.example.com/calendar-feed/u.sig.ics', webcal_url: 'about:blank' });
    if (path.match(/^\/connectors\/[a-z]+\/files/)) return json({ files: [{ id: 'f1', title: 'Biology lecture 4 notes', kind: 'doc', edited: '2026-10-20' }, { id: 'f2', title: 'Syllabus', kind: 'pdf', edited: '2026-09-01' }] });
    if (path.match(/^\/connectors\/[a-z]+\/import$/)) return json({ title: 'Biology lecture 4 notes', text: 'Osmosis is the movement of water across a membrane.' });
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
