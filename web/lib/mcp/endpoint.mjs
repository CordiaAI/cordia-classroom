// The MCP endpoint (https://classroom.cordiacode.com/mcp) and its OAuth discovery document.
// Stateless Streamable HTTP: every request is checked and served on its own.
import {
  McpServer,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  originValidationResponse,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, PRIVACY_PATH, mcpConfig, resourceUrlFor } from './config.mjs';
import { createTokenVerifier } from './auth.mjs';

const ALLOW_HEADERS = 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID';
const EXPOSE_HEADERS = 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version';

// Tools, prompts and instructions arrive in later phases; for now a signed-in client can connect.
export function createServer() {
  return new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });
}

// Browsers may call /mcp only from an allowed origin (Claude and ChatGPT call it server to server,
// with no Origin header at all).
function corsHeaders(request, allowedOrigins) {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  try {
    if (!allowedOrigins.includes(new URL(origin).hostname)) return {};
  } catch {
    return {};
  }
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': EXPOSE_HEADERS, Vary: 'Origin' };
}

function withHeaders(response, headers) {
  if (!Object.keys(headers).length) return response;
  const out = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) out.headers.set(key, value);
  return out;
}

export function createMcpEndpoint(config = mcpConfig(), { verifier = createTokenVerifier(config), serverFactory = createServer } = {}) {
  const handler = createMcpHandler(serverFactory, { legacy: 'stateless' });
  const expectedResource = new URL(config.audience);

  return async function serve(request) {
    const cors = corsHeaders(request, config.allowedOrigins);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': ALLOW_HEADERS, 'Access-Control-Max-Age': '600' } });
    }
    const rejected = originValidationResponse(request, config.allowedOrigins);
    if (rejected) return rejected;
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrlFor(request));
    const auth = await requireBearerAuth({ verifier, resourceMetadataUrl, expectedResource })(request);
    if (auth instanceof Response) return withHeaders(auth, cors);
    return withHeaders(await handler.fetch(request, { authInfo: auth }), cors);
  };
}

// RFC 9728 Protected Resource Metadata: tells clients that Supabase Auth issues tokens for /mcp.
export function protectedResourceMetadata(request, config = mcpConfig()) {
  const resource = resourceUrlFor(request);
  return {
    resource: resource.href,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ['header'],
    resource_name: MCP_SERVER_NAME,
    resource_policy_uri: new URL(PRIVACY_PATH, resource).href,
  };
}

export function protectedResourceMetadataResponse(request, config = mcpConfig()) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Mcp-Protocol-Version' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  return Response.json(protectedResourceMetadata(request, config), { headers: { ...cors, 'Cache-Control': 'public, max-age=3600' } });
}
