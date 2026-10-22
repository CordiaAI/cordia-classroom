// importers.js: reading a Quizlet set or a YouTube transcript for Classroom (loaded by background.js).
// Quizlet and YouTube turn servers away, so each opens the link in a background tab with the
// student's own browser session, reads it, and closes the tab. Only their own links are opened.

function quizletSetUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/(^|\.)quizlet\.com$/i.test(url.hostname)) throw new Error('Paste a quizlet.com set link.');
  url.hash = '';
  return url.href;
}

// Runs inside the Quizlet tab. Reads the set from the page's data, else from the term list.
function readQuizletSet() {
  const clean = text => String(text || '').replace(/\s+\n/g, '\n').trim();
  const side = sideData => clean((sideData?.media || []).map(media => media?.plainText || '').filter(Boolean).join('\n'));
  const found = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node.cardSides) && node.cardSides.length >= 2) {
      const front = node.cardSides.find(item => item.label === 'word') || node.cardSides[0];
      const back = node.cardSides.find(item => item.label === 'definition') || node.cardSides[1];
      found.push({ id: node.id, term: side(front), definition: side(back), rank: node.rank ?? found.length });
      return;
    }
    for (const value of Array.isArray(node) ? node : Object.values(node)) walk(value, depth + 1);
  };
  for (const script of document.querySelectorAll('script#__NEXT_DATA__, script[type="application/json"]')) {
    try {
      const data = JSON.parse(script.textContent || 'null');
      walk(data, 0);
      // The store is often serialized a second time as a string inside the page props.
      const nested = data?.props?.pageProps?.dehydratedReduxStateKey;
      if (typeof nested === 'string') walk(JSON.parse(nested), 0);
    } catch (_) { /* Not JSON. */ }
  }
  const seen = new Set();
  let cards = found
    .sort((a, b) => a.rank - b.rank)
    .filter(card => (card.term || card.definition) && !seen.has(card.id ?? `${card.term}\u0000${card.definition}`) && seen.add(card.id ?? `${card.term}\u0000${card.definition}`))
    .map(({ term, definition }) => ({ term, definition }));
  if (!cards.length) {
    const texts = [...document.querySelectorAll('.TermText, [class*="TermText"]')].map(element => clean(element.innerText));
    for (let index = 0; index + 1 < texts.length; index += 2) cards.push({ term: texts[index], definition: texts[index + 1] });
  }
  const heading = document.querySelector('h1')?.innerText || document.title.replace(/\s*[|-]\s*Quizlet.*$/i, '').replace(/\s*Flashcards\s*$/i, '');
  return { title: clean(heading), cards, blocked: /captcha|just a moment|access denied/i.test(document.title) };
}

function waitForTab(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); reject(new Error('Quizlet took too long to load.')); }, timeoutMs);
    function onUpdated(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// Opens the set in a background tab with the student's own browser session (Quizlet blocks
// servers), reads the cards, and closes the tab. Only quizlet.com links are opened.
async function importQuizlet(message) {
  const url = quizletSetUrl(message.url || '');
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTab(tab.id, 25000);
    let set = null;
    // The term list can render a moment after load.
    for (let attempt = 0; attempt < 6; attempt++) {
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readQuizletSet });
      set = result?.result;
      if (set?.cards?.length || set?.blocked) break;
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    if (set?.blocked) throw new Error('Quizlet asked for a quick check. Open the set in a tab, then try again.');
    if (!set?.cards?.length) throw new Error('No cards were found. Check that the set is public and the link opens the set itself.');
    return { title: set.title || 'Quizlet set', cards: set.cards.slice(0, 1000) };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// youtube.com/watch?v=, youtu.be/, /shorts/, /live/ and /embed/ links, as one watch link.
function youtubeWatchUrl(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^(www|m|music)\./i, '').toLowerCase();
  let id = '';
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') || (url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/) || [])[1] || '';
  }
  if (url.protocol !== 'https:' || !/^[\w-]{11}$/.test(id)) throw new Error('Paste a YouTube video link.');
  return `https://www.youtube.com/watch?v=${id}`;
}

// Runs inside the YouTube tab: the caption track if YouTube serves it, else the page's own
// transcript panel. Prefers captions written by people over automatic ones.
async function readYoutubeTranscript() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  document.querySelector('video')?.pause();
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
  let player = null;
  for (const script of document.querySelectorAll('script')) {
    const source = script.textContent || '';
    const at = source.indexOf('ytInitialPlayerResponse = {');
    if (at < 0) continue;
    const start = source.indexOf('{', at);
    let depth = 0;
    let inString = false;
    for (let index = start; index < source.length; index++) {
      const char = source[index];
      if (inString) {
        if (char === '\\') index++;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try { player = JSON.parse(source.slice(start, index + 1)); } catch (_) { /* Keep looking. */ }
        break;
      }
    }
    if (player) break;
  }
  const details = player?.videoDetails || {};
  const title = clean(details.title || document.title.replace(/\s*-\s*YouTube$/, ''));
  const meta = { title, channel: clean(details.author), minutes: Math.round(Number(details.lengthSeconds || 0) / 60) };
  if (/not a bot|unusual traffic/i.test(document.body?.innerText?.slice(0, 4000) || '')) return { ...meta, blocked: true };
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const rank = track => (track.kind === 'asr' ? 2 : 0) + (/^en/i.test(track.languageCode || '') ? 0 : 1);
  const track = [...tracks].sort((a, b) => rank(a) - rank(b))[0];
  if (track?.baseUrl) {
    try {
      const response = await fetch(`${track.baseUrl}&fmt=json3`, { credentials: 'include' });
      const data = JSON.parse((await response.text()) || 'null');
      const text = (data?.events || []).map(event => (event.segs || []).map(seg => seg.utf8 || '').join('')).join(' ');
      if (clean(text).length > 40) return { ...meta, text: clean(text) };
    } catch (_) { /* YouTube may refuse direct caption fetches; use the panel. */ }
  }
  // The transcript panel: open the description, then "Show transcript", and read the lines.
  document.querySelector('ytd-text-inline-expander #expand, #description-inline-expander #expand')?.click();
  await sleep(400);
  const opener = document.querySelector('ytd-video-description-transcript-section-renderer button')
    || [...document.querySelectorAll('button')].find(button => /show transcript/i.test(button.innerText || button.getAttribute('aria-label') || ''));
  if (!opener) return { ...meta, noCaptions: !tracks.length };
  opener.click();
  let lines = [];
  for (let wait = 0, stable = 0; wait < 30 && stable < 3; wait++) {
    await sleep(500);
    const nodes = document.querySelectorAll('ytd-transcript-segment-renderer .segment-text, ytd-transcript-segment-renderer yt-formatted-string.segment-text, transcript-segment-view-model [class*="segment-text"]');
    const next = [...nodes].map(node => clean(node.innerText || node.textContent)).filter(Boolean);
    stable = next.length && next.length === lines.length ? stable + 1 : 0;
    lines = next;
  }
  return lines.length ? { ...meta, text: lines.join(' ') } : { ...meta, noCaptions: !tracks.length };
}

// Opens the video in a muted background tab (YouTube turns servers away), reads its transcript,
// and closes the tab. Only YouTube links are opened.
async function importYoutube(message) {
  const url = youtubeWatchUrl(message.url || '');
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
    await waitForTab(tab.id, 30000);
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readYoutubeTranscript });
    const video = result?.result || {};
    if (video.blocked) throw new Error('YouTube asked for a quick check. Open the video in a tab, then try again.');
    if (!video.text) throw new Error(video.noCaptions ? "This video has no captions or transcript, so there's nothing to read." : "The video's transcript couldn't be read. Try again in a moment.");
    return { title: video.title || 'YouTube video', channel: video.channel || '', minutes: video.minutes || 0, text: video.text, url };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}
