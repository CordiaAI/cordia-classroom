// What search_my_materials (the same search connected apps use) found, as rows for the list.
const HREF = {
  study_guide: hit => '/guide/' + hit.id,
  flashcard: hit => `/flashcards/study?guideId=${hit.id}`,
  note: hit => '/smartnotes?id=' + hit.id,
  lecture: hit => '/lecture/' + hit.id,
};
const KIND = { study_guide: 'guide', flashcard: 'card', note: 'note', lecture: 'lecture' };
export function searchRows(hits) {
  const rows = (Array.isArray(hits) ? hits : []).filter(hit => HREF[hit.kind]).map(hit => {
    const kind = KIND[hit.kind];
    const title = kind === 'card' ? String(hit.snippet || '').split(' — ')[0] : (hit.title || 'Untitled');
    return { key: `${kind}${hit.id}:${hit.card_index ?? ''}`, kind, id: hit.id, title, meta: kind === 'card' ? hit.title : '', href: HREF[hit.kind](hit) };
  });
  const order = ['guide', 'card', 'note', 'lecture'];
  return uniqueRows(order.flatMap(kind => rows.filter(row => row.kind === kind).slice(0, 6)));
}

// The guide ids a student already has: every guide in their library, the set each one was copied
// from (forked_from_guide_id: a saved class set or a copied public set), and every guide or card
// row their own search found. Discover lists public sets from everyone, the student included, so
// without this their own published guide, or the set they copied, shows twice: once under Guides
// and again under Public sets. Ids only, never titles: two different sets can share a name.
export function ownedGuideIds(guides, rows) {
  const ids = new Set();
  for (const guide of Array.isArray(guides) ? guides : []) {
    if (guide?.id) ids.add(String(guide.id));
    if (guide?.forked_from_guide_id) ids.add(String(guide.forked_from_guide_id));
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    if ((row?.kind === 'guide' || row?.kind === 'card') && row.id) ids.add(String(row.id));
  }
  return ids;
}

// Each row once, by its stable key (kind and id, and the card's place for a card), in order.
export function uniqueRows(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(row => {
    if (!row?.key || seen.has(row.key)) return false;
    seen.add(row.key);
    return true;
  });
}
