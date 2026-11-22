// Tutor voice mode (F11) in a real browser against a local dev server and the mock API (tests/qa/mock-api.cjs).
// The microphone is a stand-in stream made with Web Audio: a spoken-length sound once, then silence, so a turn
// ends on its own after the 800ms of quiet (Chromium's fake capture device hangs on some Macs). The Whisper path
// and /tutor/speak are answered here. Run the app first:
//   npm run dev --prefix web -- -p 3115
//   BASE=http://localhost:3115 SHOTS=dir node tests/qa/voice-check.cjs   (ONLY=regex runs some checks)
// Each check runs in light and dark, at 1440x900 and 390x844, with reduced motion on the phone size.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'));
const { install, createState, TOKEN, USER } = require('./mock-api.cjs');

const BASE = process.env.BASE || 'http://localhost:3115';
const SHOTS = process.env.SHOTS || '';
const LINES = ['Tracing water across the membrane', 'Comparing solute on each side', 'Linking osmosis to cell size'];
const REPLY = 'Osmosis is water moving across a membrane toward the side with more solute. Think of it as water following the salt. Cells swell in pure water for that reason.';
const results = [];
let current = null; // the page under test, to say what was on screen when a check fails
const expect = (condition, message) => { if (!condition) throw new Error(message); };

// A mono 16-bit WAV: `parts` is [[seconds, amplitude, hz]], amplitude 0 for silence.
function wav(parts, rate = 16000) {
  const samples = [];
  for (const [seconds, amplitude, hz] of parts) {
    for (let i = 0; i < Math.round(seconds * rate); i += 1) {
      const wobble = 0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / rate); // syllable-like rise and fall
      samples.push(amplitude ? Math.round(amplitude * wobble * 32767 * Math.sin((2 * Math.PI * hz * i) / rate)) : 0);
    }
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => data.writeInt16LE(value, index * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const SPOKEN = wav([[6, 0.25, 330]]); // the Tutor's "voice": long enough to catch it speaking

async function check(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  try { await fn(); results.push(true); console.log(`ok   ${name}`); }
  catch (error) {
    results.push(false);
    const seen = current ? await current.evaluate(() => [document.querySelector('.voice-state')?.textContent, document.querySelector('.voice-heard')?.textContent, document.querySelector('.voice-said')?.textContent].join(' / ')).catch(() => '') : '';
    console.log(`FAIL ${name}\n     ${String(error.message || error).split('\n').slice(0, 3).join(' | ').slice(0, 500)}${seen ? `\n     on screen: ${seen}` : ''}`);
  }
}

// The microphone: each getUserMedia call gives a stream that is quiet for 0.6s, "talks" for 1.6s, then stays quiet.
function fakeMicrophone() {
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext();
    const tone = context.createOscillator();
    tone.frequency.value = 220;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueAtTime(0.5, now + 0.6);
    gain.gain.setValueAtTime(0, now + 2.2);
    const out = context.createMediaStreamDestination();
    tone.connect(gain).connect(out);
    tone.start();
    return out.stream;
  };
}

async function session(browser, { width, height, theme, reduced, plan = 'pro', speak = 'ok', chatDelay = 5000, microphone = 'on', transcribe = 'ok', recognizer = false }) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference', colorScheme: theme });
  // A blocked microphone: getUserMedia says NotAllowedError, as Chrome, Safari and Firefox do.
  await context.addInitScript(microphone === 'blocked'
    ? () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); }
    : fakeMicrophone);
  // A stand-in for the browser's speech recognition: it "hears" one sentence a moment after it starts.
  if (recognizer) {
    await context.addInitScript(() => {
      window.SpeechRecognition = class {
        start() { setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'Browser heard this' }], { isFinal: true })] }), 1200); }
        stop() { setTimeout(() => this.onend?.(), 30); }
        abort() {}
      };
    });
  }
  const state = createState(true);
  state.statusLines = LINES;
  state.statusDelay = 300;
  state.chatDelay = chatDelay;
  state.tutorReply = REPLY;
  state.voiceCalls = [];
  await install(context, state);
  const voice = plan === 'free' ? { limit: 0, remaining: 0, used: 0 } : { limit: 150000, remaining: plan === 'limit' ? 40 : 149200, used: 800 };
  await context.route(/localhost:8000\/billing\/status/, route => route.fulfill({ json: {
    plan: plan === 'free' ? 'free' : 'classroom_plus', tier: plan === 'free' ? 'free' : 'pro',
    features: { guide: { used: 1, limit: 3, remaining: 2 }, tutor: { used: 2, limit: 300, remaining: 298 }, voice_characters: voice },
  } }));
  await context.route(/localhost:8000\/tutor\/speak/, route => {
    const body = JSON.parse(route.request().postData() || '{}');
    state.voiceCalls.push(body);
    if (speak === 'limit' || plan === 'limit') return route.fulfill({ status: 402, json: { detail: { code: 'limit_reached', feature: 'voice_characters' } } });
    return route.fulfill({ status: 200, body: SPOKEN, headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' } });
  });
  await context.route(/\/api\/lectures\/transcribe/, route => {
    state.transcribed = (state.transcribed || 0) + 1;
    if (transcribe === 'rate') return route.fulfill({ status: 429, headers: { 'retry-after': '30' }, json: { detail: { code: 'rate_limited', message: 'Wait.' } } });
    if (transcribe === 'cap') return route.fulfill({ status: 402, json: { detail: { code: 'limit_reached', feature: 'voice_turns', limit: 40 } } });
    return route.fulfill({ json: { text: 'Why does water follow salt?' } });
  });
  const page = await context.newPage();
  current = page;
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto(BASE + '/login');
  await page.evaluate(([token, user, mode]) => {
    localStorage.setItem('authToken', token); localStorage.setItem('userId', user); localStorage.setItem('refreshToken', 'r'); localStorage.setItem('theme', mode);
  }, [TOKEN, USER, theme]);
  return { context, page, state, problems };
}


// Contrast against the real pixels behind each line: the view's text is made transparent, the page is
// photographed, and each line's colour is laid over the average of the pixels in its box. 4.5:1 (3:1 for large text).
async function contrastProblems(page, scope = '.voice-view') {
  const items = await page.$$eval(`${scope} :is(p, h2, h3, li, span, button)`, nodes => nodes
    .filter(node => [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()))
    .map(node => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { text: node.textContent.trim().slice(0, 40), x: box.x, y: box.y, w: box.width, h: box.height, color: style.color, fill: style.webkitTextFillColor, size: parseFloat(style.fontSize), weight: Number(style.fontWeight) };
    })
    .filter(item => item.w > 0 && item.h > 0 && !/rgba\(0, 0, 0, 0\)/.test(item.fill || '')));
  const hide = await page.addStyleTag({ content: `${scope}, ${scope} * { color: transparent !important; -webkit-text-fill-color: transparent !important; } ${scope} svg { opacity: 0 !important; }` });
  await page.waitForTimeout(120);
  const shot = (await page.screenshot()).toString('base64');
  await hide.evaluate(node => node.remove());
  return page.evaluate(async ([png, list]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const draw = canvas.getContext('2d');
    draw.drawImage(image, 0, 0);
    const scale = image.width / window.innerWidth;
    const lum = ([r, g, b]) => [r, g, b].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const out = [];
    for (const item of list) {
      const data = draw.getImageData(Math.round(item.x * scale), Math.round(item.y * scale), Math.max(1, Math.round(item.w * scale)), Math.max(1, Math.round(item.h * scale))).data;
      const bg = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4) { bg[0] += data[i]; bg[1] += data[i + 1]; bg[2] += data[i + 2]; }
      const n = data.length / 4;
      const back = bg.map(v => v / n);
      const [r, g, b, a = 1] = item.color.match(/[\d.]+/g).map(Number);
      const text = [r, g, b].map((v, i) => v * a + back[i] * (1 - a));
      const [hi, lo] = [lum(text), lum(back)].sort((x, y) => y - x);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const large = item.size >= 24 || (item.size >= 18.66 && item.weight >= 700);
      if (ratio < (large ? 3 : 4.5)) out.push(`${item.text} ${ratio.toFixed(2)}:1`);
    }
    return out;
  }, [shot, items]);
}

const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : null);
const stateLine = page => page.$eval('.voice-state', node => node.textContent.trim());

async function openVoice(page) {
  await page.goto(BASE + '/home');
  await page.waitForSelector('.chat-home textarea', { timeout: 30000 });
  await page.waitForSelector('button[aria-label="Start voice mode"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.click('button[aria-label="Start voice mode"]');
  await page.waitForSelector('.voice-view', { timeout: 10000 });
}

const SIZES = [
  { tag: 'desktop', width: 1440, height: 900, reduced: false },
  { tag: 'phone', width: 390, height: 844, reduced: true },
];

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--headless=new', '--autoplay-policy=no-user-gesture-required'] });

  for (const theme of ['light', 'dark']) {
    for (const size of SIZES) {
      const tag = `${size.tag}-${theme}`;

      await check(`${tag}: listening, thinking with the T4b line, speaking, then interrupted with Space`, async () => {
        const { page, state, problems, context } = await session(browser, { ...size, theme });
        await openVoice(page);
        await page.waitForFunction(() => document.querySelector('.voice-state')?.textContent === 'Listening', null, { timeout: 8000 });
        expect(await page.$eval('.voice-mic', node => node.textContent.includes('Microphone on')), 'microphone indicator');
        expect(await page.$eval('.voice-privacy', node => node.textContent) === 'Voice audio is transcribed and not stored.', 'privacy line');
        expect(await page.evaluate(() => document.activeElement?.classList.contains('voice-view')), 'the view holds focus');
        await shot(page, `voice-listening-${tag}`);
        await page.waitForFunction(() => document.querySelector('.voice-state')?.textContent === 'Thinking', null, { timeout: 10000 });
        await page.waitForSelector('.voice-thinking .tutor-line', { timeout: 5000 });
        await page.waitForTimeout(2600);
        const thinking = await page.$eval('.voice-thinking', node => node.textContent);
        expect(LINES.some(item => thinking.includes(item)) || thinking.includes('Reading your question'), `thinking line: ${thinking}`);
        expect(await page.$eval('.voice-heard', node => node.textContent) === 'Why does water follow salt?', 'the student caption');
        expect(await page.$$eval('.voice-view .c-loader', items => items.length) === 0, 'one mark only: the T4b line brings no second mark');
        expect(await page.$eval('.voice-view p.sr-only[aria-live="polite"]', node => node.textContent) === 'You said: Why does water follow salt?', 'what was heard is announced once when Thinking starts');
        await shot(page, `voice-thinking-${tag}`);
        await page.waitForFunction(() => document.querySelector('.voice-state')?.textContent === 'Speaking', null, { timeout: 12000 });
        await page.waitForTimeout(400);
        const said = await page.$eval('.voice-said', node => node.textContent);
        expect(said.startsWith('Osmosis is water moving'), `caption: ${said}`);
        expect(state.voiceCalls[0]?.text === 'Osmosis is water moving across a membrane toward the side with more solute.', `spoke: ${JSON.stringify(state.voiceCalls[0])}`);
        expect(state.voiceCalls[0]?.session_id === 's1' && state.voiceCalls[0]?.voice === 'matilda', 'session and voice sent');
        await shot(page, `voice-speaking-${tag}`);
        const low = await contrastProblems(page);
        expect(!low.length, `contrast while speaking: ${low.join('; ')}`);
        await page.keyboard.press('Space');
        await page.waitForFunction(() => document.querySelector('.voice-state')?.textContent === 'Stopped. Go ahead.', null, { timeout: 3000 });
        expect(await page.evaluate(() => [...document.querySelectorAll('audio')].every(audio => audio.paused)), 'audio stopped');
        await shot(page, `voice-interrupted-${tag}`);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.voice-view', { state: 'detached', timeout: 3000 });
        const thread = await page.$eval('.chat-home-thread', node => node.textContent);
        expect(thread.includes('Why does water follow salt?') && thread.includes('Osmosis is water moving'), 'the exchange is saved as normal messages');
        expect(state.transcribed === 1, `transcribed ${state.transcribed}`);
        expect(!problems.length, problems.join(' | '));
        await context.close();
      });

      await check(`${tag}: at the limit the browser voice takes over with a one-line note`, async () => {
        const { page, problems, context } = await session(browser, { ...size, theme, plan: 'limit', chatDelay: 400 });
        await openVoice(page);
        await page.waitForSelector('.voice-note', { timeout: 15000 });
        const note = await page.$eval('.voice-note', node => node.textContent);
        expect(note === "You've used this month's Tutor voice, so your browser's voice is speaking.", note);
        await shot(page, `voice-limit-${tag}`);
        const low = await contrastProblems(page);
        expect(!low.length, `contrast at the limit: ${low.join('; ')}`);
        expect(!problems.length, problems.join(' | '));
        await context.close();
      });

      await check(`${tag}: a blocked microphone says how to allow it`, async () => {
        const { page, context } = await session(browser, { ...size, theme, microphone: 'blocked' });
        await openVoice(page);
        await page.waitForSelector('.voice-problem', { timeout: 10000 });
        const text = await page.$eval('.voice-problem', node => node.textContent);
        expect(text.includes("Cordia can't hear you") && text.includes('Try again'), text);
        expect(await page.$eval('.voice-mic', node => node.textContent.includes('Microphone off')), 'indicator says off');
        await shot(page, `voice-blocked-${tag}`);
        const low = await contrastProblems(page);
        expect(!low.length, `contrast when blocked: ${low.join('; ')}`);
        await page.click('.voice-end');
        await page.waitForSelector('.voice-view', { state: 'detached', timeout: 3000 });
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Start voice mode', null, { timeout: 2000 })
          .catch(() => { throw new Error('focus back on the voice button'); });
        await context.close();
      });

      await check(`${tag}: End during Thinking puts focus back on the voice button, which is aria-disabled and never disabled`, async () => {
        const { page, context, problems } = await session(browser, { ...size, theme });
        await openVoice(page);
        await page.waitForFunction(() => document.querySelector('.voice-state')?.textContent === 'Thinking', null, { timeout: 10000 });
        await page.click('.voice-end');
        await page.waitForSelector('.voice-view', { state: 'detached', timeout: 3000 });
        await page.waitForTimeout(150);
        const focused = await page.evaluate(() => {
          const active = document.activeElement;
          return { label: active?.getAttribute('aria-label'), disabled: active?.disabled, ariaDisabled: active?.getAttribute('aria-disabled'), inComposer: Boolean(active?.closest('.composer')) };
        });
        expect(focused.inComposer && focused.label === 'Start voice mode', `focus: ${JSON.stringify(focused)}`);
        expect(focused.disabled === false && focused.ariaDisabled === 'true', `the button while the Tutor is busy: ${JSON.stringify(focused)}`);
        // A press on it while the Tutor is busy does nothing.
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        expect(await page.$('.voice-view') === null, 'an aria-disabled voice button does not start voice mode');
        expect(!problems.length, problems.join(' | '));
        await context.close();
      });

      if (!size.reduced) {
        await check(`${tag}: End during the fade-in turns the view around from where it is, never to full opacity first`, async () => {
          const { page, context } = await session(browser, { ...size, theme });
          await page.goto(BASE + '/home');
          await page.waitForSelector('button[aria-label="Start voice mode"]', { timeout: 30000 });
          await page.waitForTimeout(600);
          const seen = await page.evaluate(async () => {
            const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
            document.querySelector('button[aria-label="Start voice mode"]').click();
            let view = null;
            while (!view) { await frame(); view = document.querySelector('.voice-view'); }
            // Mid fade-in: after the first frame that shows the view part way up (a cold page can be slow to start it).
            let before = 0;
            for (let i = 0; i < 60 && before <= 0.2; i += 1) { await frame(); before = Number(getComputedStyle(view).opacity); }
            document.querySelector('.voice-end').click();
            const after = [];
            for (let i = 0; i < 8 && document.querySelector('.voice-view'); i += 1) { await frame(); after.push(Number(getComputedStyle(view).opacity)); }
            return { before, after };
          });
          expect(seen.before > 0 && seen.before < 0.95, `mid fade-in: ${JSON.stringify(seen)}`);
          // Frames can be slow here (the entrance keeps running until the next one is drawn), so the exit may start a little
          // above where the last frame showed. What it must never do is jump to full opacity first, as a keyframe exit did.
          const peak = Math.max(...seen.after);
          expect(peak < 0.95, `the exit jumped up to ${peak}: ${JSON.stringify(seen)}`);
          const turn = seen.after.indexOf(peak);
          expect(seen.after.slice(turn).every((value, index, list) => index === 0 || value <= list[index - 1] + 0.001), `the exit is steady once it turns: ${JSON.stringify(seen)}`);
          expect(seen.after[seen.after.length - 1] <= 0.45, `fading out: ${JSON.stringify(seen)}`);
          await context.close();
        });
      }

      for (const [transcribe, line] of [['cap', "You've used this month's voice listening. Type your message instead."], ['rate', 'That was a lot of voice turns in a minute. Wait a moment and try again, or type instead.']]) {
        await check(`${tag}: transcribe ${transcribe === 'cap' ? 'at the monthly cap (402)' : 'over the rate (429)'} without browser recognition says why in one line`, async () => {
          const { page, state, context, problems } = await session(browser, { ...size, theme, transcribe });
          await openVoice(page);
          await page.waitForSelector('.voice-note.is-error', { timeout: 12000 });
          expect(await page.$eval('.voice-note.is-error', node => node.textContent) === line, 'one line');
          expect(await page.evaluate(() => document.querySelector('.voice-view') !== null), 'voice mode stays open (the Tutor was not out of messages)');
          expect(!state.tutor.messages.some(message => message.role === 'user'), 'nothing was sent to the Tutor');
          await shot(page, `voice-transcribe-${transcribe}-${tag}`);
          const low = await contrastProblems(page);
          expect(!low.length, `contrast: ${low.join('; ')}`);
          expect(!problems.length, problems.join(' | '));
          await context.close();
        });
      }

      await check(`${tag}: transcribe at the cap falls back to the browser's recognition, with a note, and the turn goes to the Tutor`, async () => {
        const { page, state, context, problems } = await session(browser, { ...size, theme, transcribe: 'cap', recognizer: true, chatDelay: 800 });
        await openVoice(page);
        await page.waitForSelector('.voice-note', { timeout: 14000 });
        await page.waitForFunction(() => document.querySelector('.voice-heard')?.textContent === 'Browser heard this', null, { timeout: 12000 });
        expect(await page.$eval('.voice-note', node => node.textContent) === "You've used this month's voice listening, so your browser is writing down what you say.", 'one-line note');
        await page.waitForFunction(() => document.querySelector('.voice-state')?.textContent === 'Speaking', null, { timeout: 12000 });
        await page.waitForTimeout(3200); // a second turn: the audio is no longer sent once the cap is known
        expect(state.transcribed === 1, `audio was sent ${state.transcribed} times`);
        expect(!problems.length, problems.join(' | '));
        await context.close();
      });

      for (const plan of ['pro', 'free']) {
        await check(`${tag}: Settings › Tutor voice picker (${plan})`, async () => {
          const { page, context, problems } = await session(browser, { ...size, theme, plan });
          await page.goto(BASE + '/settings?section=tutor');
          await page.waitForSelector('#tutor-voice-title', { timeout: 30000 });
          await page.waitForTimeout(800);
          const radios = await page.$$eval('[aria-labelledby="tutor-voice-title"] [role="radio"]', items => items.map(item => item.textContent));
          expect(radios.join(',') === 'Matilda,Eric,Alice,George', radios.join(','));
          const hear = await page.$('text=Hear Matilda');
          expect(plan === 'pro' ? Boolean(hear) : !hear, 'Hear button only with the cloud voice');
          // force: Playwright treats an aria-disabled button as not clickable and would wait; a student's click is what is tested.
          await page.click('[aria-labelledby="tutor-voice-title"] [role="radio"]:has-text("Alice")', { force: true });
          if (plan === 'free') {
            expect(await page.evaluate(() => localStorage.getItem('cordiaTutorVoice')) === null, 'Free: the picker is preview-only, nothing is saved');
            const states = await page.$$eval('[aria-labelledby="tutor-voice-title"] [role="radio"]', items => items.map(item => [item.getAttribute('aria-disabled'), item.disabled, item.getAttribute('aria-checked')].join('/')));
            expect(states.join(',') === 'true/false/true,true/false/false,true/false/false,true/false/false', `radios: ${states.join(',')}`);
            expect(await page.$eval('[aria-labelledby="tutor-voice-title"]', node => node.getAttribute('aria-describedby')) === 'tutor-voice-note', 'described by the note that says why');
            expect(await page.$eval('#tutor-voice-note', node => /come with Pro/.test(node.textContent)), 'the existing explanation');
          } else {
            expect(await page.evaluate(() => localStorage.getItem('cordiaTutorVoice')) === 'alice', 'saved on the device');
          }
          // The four voices: one row on a wide screen; two rows of two at phone width, never three and one on its own.
          const rows = await page.$$eval('[aria-labelledby="tutor-voice-title"] [role="radio"]', items => {
            const tops = items.map(item => Math.round(item.getBoundingClientRect().top));
            return [...new Set(tops)].map(top => tops.filter(value => value === top).length);
          });
          expect(size.width > 520 ? rows.join() === '4' : rows.join() === '2,2', `voice rows: ${rows.join()}`);
          await page.$eval('#tutor-voice-title', node => node.closest('.settings-card').scrollIntoView({ block: 'center' }));
          await shot(page, `settings-tutor-${plan}-${tag}`);
          await page.$eval('#tutor-voice-title', node => node.closest('.settings-card').classList.add('qa-voice-card'));
          const low = await contrastProblems(page, '.qa-voice-card');
          expect(!low.length, `contrast in the voice card: ${low.join('; ')}`);
          expect(!problems.length, problems.join(' | '));
          await context.close();
        });
      }
    }
  }

  await browser.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} voice checks passed`);
  process.exit(failed ? 1 : 0);
})();
