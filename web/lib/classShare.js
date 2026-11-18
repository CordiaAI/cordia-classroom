import { apiFetch } from './api';
import { supabaseRest } from './serverCopies';

// A class's sharing default: whether new guides filed in it are shared with the class (its course
// code) or kept private. It is the answer to the one-time "Share with MGT 300?" sheet
// (components/ShareSheet.js), stored in class_share_defaults. The class page's sharing control reads
// it as the student (the table's row-level security lets each student read their own rows) and
// changes it through the same endpoint the sheet uses.

// true (shared), false (private) or null (never answered, which works as private).
export async function readShareDefault(classId) {
  if (!classId) return null;
  try {
    const { ok, data } = await supabaseRest()(`/rest/v1/class_share_defaults?class_id=eq.${encodeURIComponent(classId)}&select=share`);
    return ok && Array.isArray(data) && data[0] && typeof data[0].share === 'boolean' ? data[0].share : null;
  } catch {
    return null;
  }
}

// Saves the default; resolves to the saved value, or null when it could not be saved.
export async function saveShareDefault(classId, share) {
  const data = await apiFetch(`/classes/${encodeURIComponent(classId)}/share-default`, { method: 'POST', body: JSON.stringify({ share: Boolean(share) }) });
  return typeof data?.share === 'boolean' ? data.share : null;
}
