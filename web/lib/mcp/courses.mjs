// Course labels for tool output. A folder made from Canvas or the calendar feed that the student
// hasn't renamed is "Course 1", "Course 2"… (by when it was made), shown with up to three of its
// study set titles; connected apps never see the Canvas course name (folders.name isn't granted).
// Folders the student named keep their name.
export async function loadCourses(db) {
  const { data: folders, error } = await db.from('folders').select('id, lms_named, own_name, created_at').order('created_at', { ascending: true }).limit(500);
  if (error) throw error;
  const neutral = (folders || []).filter(folder => folder.lms_named || !folder.own_name);
  const examples = new Map(neutral.map(folder => [folder.id, []]));
  if (neutral.length) {
    const { data: guides } = await db.from('study_guides').select('title, folder_id').in('folder_id', neutral.map(folder => folder.id))
      .order('created_at', { ascending: false }).limit(300);
    for (const guide of guides || []) {
      const list = examples.get(guide.folder_id);
      if (list && list.length < 3 && guide.title) list.push(guide.title);
    }
  }
  const byId = new Map();
  let number = 0;
  for (const folder of folders || []) {
    if (examples.has(folder.id)) {
      number += 1;
      byId.set(folder.id, { id: folder.id, name: `Course ${number}`, example_study_sets: examples.get(folder.id) });
    } else {
      byId.set(folder.id, { id: folder.id, name: folder.own_name });
    }
  }
  return { get: id => (id && byId.get(id)) || null, has: id => byId.has(id) };
}
