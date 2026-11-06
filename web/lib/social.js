// Follows, friends and notifications (social plan, Stage 2). Everything goes through the API
// (backend/routers/social.py, notifications.py).
import { apiFetch } from './api';

const SUMMARY_EVENT = 'cordia:social-summary';
const SUMMARY_TTL = 30_000;
let summary = null;
let summaryAt = 0;
let pending = null;

const ok = data => Boolean(data && typeof data === 'object' && !data.detail && !data.failed);

// The badge counts: { incoming_friend_requests, incoming_follow_requests, unread_notifications }.
// Shared and re-read at most every 30 seconds; null when the server can't answer.
export function loadSocialSummary({ fresh = false } = {}) {
  if (!fresh && summary && Date.now() - summaryAt < SUMMARY_TTL) return Promise.resolve(summary);
  if (pending) return pending;
  pending = apiFetch('/social/summary').then(data => {
    pending = null;
    if (!ok(data) || typeof data.unread_notifications !== 'number') return null;
    summary = data;
    summaryAt = Date.now();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SUMMARY_EVENT, { detail: data }));
    return data;
  });
  return pending;
}

export function onSocialSummary(handler) {
  const listener = event => handler(event.detail);
  window.addEventListener(SUMMARY_EVENT, listener);
  return () => window.removeEventListener(SUMMARY_EVENT, listener);
}

// Something changed (a request answered, notifications read): refresh the badges.
export const refreshSocialSummary = () => loadSocialSummary({ fresh: true });

async function act(path, method) {
  const data = await apiFetch(path, { method, reportFailure: true });
  if (ok(data)) { refreshSocialSummary(); return { data }; }
  return { error: typeof data?.detail === 'string' ? data.detail : "Couldn't do that. Try again." };
}

export const follow = id => act(`/social/follow/${id}`, 'POST');
export const unfollow = id => act(`/social/follow/${id}`, 'DELETE');
export const approveFollow = id => act(`/social/follow-requests/${id}/approve`, 'POST');
export const declineFollow = id => act(`/social/follow-requests/${id}/decline`, 'POST');
export const removeFollower = id => act(`/social/followers/${id}`, 'DELETE');
export const requestFriend = id => act(`/social/friends/${id}`, 'POST');
export const acceptFriend = id => act(`/social/friends/${id}/accept`, 'POST');
export const declineFriend = id => act(`/social/friends/${id}/decline`, 'POST');
export const removeFriend = id => act(`/social/friends/${id}`, 'DELETE');

// One page of a list: { items, next_cursor } or null.
// list: 'friends' | 'following' | 'followers' | 'requests'; params: { kind, direction, cursor }.
export async function loadPeople(list, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();
  const data = await apiFetch(`/social/${list}${query ? '?' + query : ''}`);
  return ok(data) && Array.isArray(data.items) ? data : null;
}

export async function loadNotifications(cursor) {
  const data = await apiFetch('/notifications' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
  return ok(data) && Array.isArray(data.items) ? data : null;
}

export async function markNotificationsRead(ids) {
  const data = await apiFetch('/notifications/read', { method: 'POST', body: JSON.stringify(ids ? { ids } : { all: true }) });
  refreshSocialSummary();
  return ok(data);
}

// What a notification says, in plain words (the actor's name is shown separately).
export function notificationText(kind, item = null) {
  if (kind === 'classroom_invite') return `invited you to ${item?.classroom?.name ? `“${item.classroom.name}”` : 'a classroom'}`;
  return {
    follow: 'followed you',
    follow_request: 'asked to follow you',
    friend_request: 'sent you a friend request',
    friend_accepted: 'accepted your friend request',
  }[kind] || '';
}

export function notificationHref(item) {
  if (item.kind === 'classroom_invite' && item.classroom?.token) return `/join/${item.classroom.token}`;
  if (item.kind === 'friend_request' || item.kind === 'follow_request') return '/friends?tab=requests';
  return item.actor?.username ? `/u/${item.actor.username}` : '/friends';
}
