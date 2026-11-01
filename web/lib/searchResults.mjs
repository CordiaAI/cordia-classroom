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
    return { key: `${kind}${hit.id}:${hit.card_index ?? ''}`, kind, title, meta: kind === 'card' ? hit.title : '', href: HREF[hit.kind](hit) };
  });
  const order = ['guide', 'card', 'note', 'lecture'];
  return order.flatMap(kind => rows.filter(row => row.kind === kind).slice(0, 6));
}
