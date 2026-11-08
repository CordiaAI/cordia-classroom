// The words for one Activity item (social plan, Stage 10), kept apart so they're easy to test.
export function activityLine(item) {
  if (item.kind === 'guide_published') return { text: 'shared a new public guide', link: item.guide ? { href: `/sets/${item.guide.id}`, label: item.guide.title } : null };
  if (item.kind === 'classroom_guide') {
    const where = item.classroom ? ` to ${item.classroom.name}` : '';
    if (item.guide) return { text: `added a guide${where}`, link: { href: `/sets/${item.guide.id}`, label: item.guide.title } };
    return { text: `added a folder${where}`, link: item.classroom ? { href: `/classrooms/${item.classroom.id}`, label: item.folder?.name || 'Folder' } : null };
  }
  if (item.kind === 'streak') return { text: `reached a ${item.days}-day study streak`, link: null };
  return { text: '', link: null };
}

export function whenLabel(iso, now = new Date()) {
  const then = new Date(iso);
  const days = Math.floor((now - then) / 86400000);
  if (Number.isNaN(days)) return '';
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
