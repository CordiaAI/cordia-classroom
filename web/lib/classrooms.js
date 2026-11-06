// Classrooms (social plan, Stage 5): study groups and instructor classes. Everything goes through
// the backend (routers/classrooms.py), which checks roles, blocks and caps. Behind CLASSROOMS_ON.
import { apiFetch, getToken } from './api';
import { anonymousFetch } from './guideSharing';

const json = body => ({ body: JSON.stringify(body) });

export const ROLE_LABELS = { owner: 'Owner', instructor: 'Instructor', admin: 'Admin', member: 'Member' };
export const KIND_LABELS = { study_group: 'Study group', instructor_class: 'Instructor class' };
export const VISIBILITY_HELP = {
  public: 'Shown on its class page. Anyone can ask to join.',
  unlisted: 'Only people with a link or code can join.',
  private: 'Only people a member invites by name can join.',
};

export const listClassrooms = (canAdd = false) => apiFetch('/classrooms' + (canAdd ? '?can_add=true' : ''));
export const createClassroom = body => apiFetch('/classrooms', { method: 'POST', ...json(body) });
export const getClassroom = id => apiFetch(`/classrooms/${id}`);
export const updateClassroom = (id, body) => apiFetch(`/classrooms/${id}`, { method: 'PATCH', ...json(body) });
export const archiveClassroom = id => apiFetch(`/classrooms/${id}/archive`, { method: 'POST' });
export const listMembers = id => apiFetch(`/classrooms/${id}/members`);
export const changeRole = (id, userId, role) => apiFetch(`/classrooms/${id}/members/${userId}`, { method: 'PATCH', ...json({ role }) });
export const approveMember = (id, userId) => apiFetch(`/classrooms/${id}/members/${userId}/approve`, { method: 'POST' });
export const removeMember = (id, userId) => apiFetch(`/classrooms/${id}/members/${userId}`, { method: 'DELETE' });
export const leaveClassroom = id => apiFetch(`/classrooms/${id}/leave`, { method: 'POST' });
export const transferOwnership = (id, userId) => apiFetch(`/classrooms/${id}/transfer`, { method: 'POST', ...json({ user_id: userId }) });
export const setShareProgress = (id, on) => apiFetch(`/classrooms/${id}/me`, { method: 'PATCH', ...json({ progress_visible_to_staff: on }) });
export const listInvites = id => apiFetch(`/classrooms/${id}/invites`);
export const createInvite = (id, body = {}) => apiFetch(`/classrooms/${id}/invites`, { method: 'POST', ...json(body) });
export const revokeInvite = inviteId => apiFetch(`/classrooms/invites/${inviteId}/revoke`, { method: 'POST' });
export const regenerateInvite = inviteId => apiFetch(`/classrooms/invites/${inviteId}/regenerate`, { method: 'POST' });
export const inviteFriends = (id, userIds) => apiFetch(`/classrooms/${id}/invite-friends`, { method: 'POST', ...json({ user_ids: userIds }) });
export const joinClassroom = body => apiFetch('/classrooms/join', { method: 'POST', ...json(body) });
export const requestJoin = (id, body = {}) => apiFetch(`/classrooms/${id}/request-join`, { method: 'POST', ...json(body) });
export const courseClassrooms = classId => apiFetch(`/classrooms/for-class/${classId}`);
export const listItems = id => apiFetch(`/classrooms/${id}/items`);
export const addItem = (id, body) => apiFetch(`/classrooms/${id}/items`, { method: 'POST', ...json(body) });
export const removeItem = (id, type, itemId) => apiFetch(`/classrooms/${id}/items/${type}/${itemId}`, { method: 'DELETE' });
export const setMilestone = (id, type, itemId, body) => apiFetch(`/classrooms/${id}/items/${type}/${itemId}`, { method: 'PATCH', ...json(body) });
export const reorderItems = (id, items) => apiFetch(`/classrooms/${id}/items/order`, { method: 'PUT', ...json({ items }) });
export const classroomActivity = id => apiFetch(`/classrooms/${id}/activity`);

// The invite preview works signed out too.
export async function previewInvite(token) {
  const path = `/join/${encodeURIComponent(token)}`;
  const data = getToken() ? await apiFetch(path) : await anonymousFetch(path);
  return data && typeof data.valid === 'boolean' ? data : { valid: false, reason: "Couldn't reach Classroom. Check your connection and try again." };
}

export function inviteLink(token) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://classroom.cordiaai.io';
  return `${origin}/join/${token}`;
}

// What a join answer means, in words.
export function joinMessage(result) {
  if (result?.status === 'pending') return 'Request sent. You’ll get in once an admin approves it.';
  if (result?.status === 'active') return 'You’re in.';
  return result?.detail || "Couldn't join. Try again.";
}
