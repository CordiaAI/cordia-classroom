// Study-time wording shared by the assignment sheet and Your week (lib/studyPlans.js re-exports
// these). No imports, so the node tests can load it.

export function minutesLabel(minutes) {
  const value = Math.max(0, Math.round(minutes || 0));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// What a scheduling call did, in plain words. When the free time before the deadline ran out,
// it says how much was scheduled against how much was needed: time is never dropped silently.
// `where` ends the sentence ("before it's due"), `covered` is the line when nothing was needed.
export function scheduleNotice(result, { where, covered }) {
  const added = result?.added || 0;
  const got = Math.round(result?.minutes_added || 0);
  const wanted = Math.round(result?.minutes_requested || 0);
  const blocks = `${added} study block${added === 1 ? '' : 's'}`;
  if (wanted > got) {
    return added
      ? `Added ${blocks} ${where}: ${minutesLabel(got)} of the ${minutesLabel(wanted)} needed. There isn't more free time before the deadline.`
      : `There isn't free time before the deadline, so no study time was added (${minutesLabel(wanted)} needed).`;
  }
  return added ? `Added ${blocks} ${where}.` : covered;
}
