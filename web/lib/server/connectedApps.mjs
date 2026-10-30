// Tokens Supabase's OAuth server issues to connected apps (Claude and other MCP clients) carry a
// client_id, and the access-token hook gives them the mcp_client role (see
// supabase/migrations/*_oauth_lockdown.sql). The app's API routes never accept them; only the MCP
// endpoint will. Reading the claims unverified is safe here: it can only turn a request away.

export const OAUTH_CLIENT_ROLE = 'mcp_client';

export function isConnectedAppToken(authorization) {
  const token = String(authorization || '').replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return Boolean(claims?.client_id) || claims?.role === OAUTH_CLIENT_ROLE;
  } catch {
    return false;
  }
}

// Wraps a pages/api handler so connected-app tokens get a 401 before any work is done.
export function withAppTokensOnly(handler) {
  return function appTokensOnly(req, res) {
    if (isConnectedAppToken(req.headers?.authorization)) {
      return res.status(401).json({ detail: "Connected-app tokens can't be used here" });
    }
    return handler(req, res);
  };
}
