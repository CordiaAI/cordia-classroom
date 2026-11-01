// Supabase Auth's OAuth 2.1 server, from the student's side: the consent page approves or denies
// a connected app's request, and Settings lists and disconnects apps. The app keeps its own
// session (lib/api.js), so these call Supabase Auth's endpoints with that access token.
import { connectedAppHosts, isProductionDeploy } from './mcp/config.mjs';
import { restClient } from './supabaseRest.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Hosts a connected app may send the student back to. NEXT_PUBLIC_* values are passed in by the
// page, because Next only inlines them where they're written out in full.
export function redirectHosts({ configured, vercelEnv, nodeEnv }) {
  return connectedAppHosts(configured, { production: isProductionDeploy(vercelEnv, nodeEnv) });
}

export function redirectHostOf(uri) {
  try {
    return new URL(uri).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// https only, and an exact host on the list; plain http only for localhost.
export function redirectAllowed(uri, hosts) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (!hosts.includes(host)) return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(host));
}

export function clientName(client) {
  const name = String(client?.name || client?.client_name || '').trim();
  return name.slice(0, 60) || 'This app';
}

// Supabase Auth's endpoints for consent and grants, called as the signed-in student.
export function oauthApi(options) {
  const call = restClient(options);
  const id = value => encodeURIComponent(String(value));
  return {
    authorization: authorizationId => call(`/auth/v1/oauth/authorizations/${id(authorizationId)}`),
    decide: (authorizationId, action) => call(`/auth/v1/oauth/authorizations/${id(authorizationId)}/consent`, { method: 'POST', body: { action } }),
    grants: () => call('/auth/v1/user/oauth/grants'),
    revoke: clientId => call(`/auth/v1/user/oauth/grants?client_id=${id(clientId)}`, { method: 'DELETE' }),
    // When each app last called Cordia (recorded by the MCP endpoint; readable only by the student).
    lastUsed: () => call('/rest/v1/mcp_connection_activity?select=client_id,last_used_at'),
  };
}
