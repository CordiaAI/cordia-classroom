// Access-token checks for the MCP endpoint (the OAuth resource server). Supabase Auth's OAuth 2.1
// server issues the tokens; the access-token hook gives every connected-app token the
// mcp_client role and the MCP audience. Normal app sign-ins never pass: wrong audience, no
// client_id, wrong role.
import { createClient } from '@supabase/supabase-js';
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jwksByIssuer = new Map();

function invalid(message) {
  return new OAuthError(OAuthErrorCode.InvalidToken, message);
}

export function remoteKeys(issuer) {
  if (!jwksByIssuer.has(issuer)) jwksByIssuer.set(issuer, createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)));
  return jwksByIssuer.get(issuer);
}

// A Supabase client that acts as the student who owns the token, so Row Level Security and the
// mcp_client grants decide what it can reach. Never built with the service role key.
export function studentClient(config, token) {
  return createClient(config.supabaseUrl, config.publishableKey, {
    accessToken: async () => token,
    global: { headers: { 'X-Client-Info': 'cordia-mcp' } },
  });
}

// True while the student still has this app connected. A Disconnect in Settings revokes the grant
// at once, even though the access token itself stays valid until it expires. Also records when the
// app was last used, for the Connected apps list.
export async function grantIsActive(config, token) {
  const { data, error } = await studentClient(config, token).rpc('mcp_session_check');
  if (error) throw new OAuthError(OAuthErrorCode.ServerError, 'Cordia could not check this connection. Try again shortly.');
  return data === true;
}

export function createTokenVerifier(config, { keys = remoteKeys(config.issuer), checkGrant = grantIsActive } = {}) {
  return {
    async verifyAccessToken(token) {
      let payload;
      try {
        ({ payload } = await jwtVerify(token, keys, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ['ES256', 'RS256'],
          requiredClaims: ['exp', 'sub'],
        }));
      } catch {
        throw invalid('The access token is invalid or expired.');
      }
      if (typeof payload.client_id !== 'string' || !payload.client_id || payload.role !== 'mcp_client' || !UUID.test(String(payload.sub))) {
        throw invalid('Connect Cordia through its sign-in and consent page to get a token for this server.');
      }
      if (!(await checkGrant(config, token))) throw invalid('This app was disconnected from Cordia. Connect it again to continue.');
      return {
        token,
        clientId: payload.client_id,
        scopes: String(payload.scope || '').split(' ').filter(Boolean),
        expiresAt: payload.exp,
        resource: new URL(config.audience),
        extra: { userId: payload.sub },
      };
    },
  };
}
