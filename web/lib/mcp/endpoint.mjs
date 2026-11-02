// The MCP endpoint (https://classroom.cordiacode.com/mcp) and its OAuth discovery document.
// Stateless Streamable HTTP: every request is checked and served on its own.
import {
  McpServer,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  originValidationResponse,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import { MCP_ICON_PATH, MCP_INSTRUCTIONS, MCP_SERVER_DESCRIPTION, MCP_SERVER_NAME, MCP_SERVER_VERSION, PRIVACY_PATH, mcpConfig, resourceUrlFor } from './config.mjs';
import { registerPrompts } from './prompts.mjs';
import { createTokenVerifier, studentClient } from './auth.mjs';
import { loadCourses } from './courses.mjs';
import { registerReadTools } from './readTools.mjs';
import { registerWriteTools } from './writeTools.mjs';
import { zoneOf } from './zoned.mjs';

const ALLOW_HEADERS = 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID';
const EXPOSE_HEADERS = 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version';

// What one request's tools work with: a Supabase client acting as the student (their token, so RLS
// applies), links on the host the client used, the student's time zone, and their course labels.
export function studentContext(config, authInfo, request) {
  const db = studentClient(config, authInfo.token);
  let courses = null;
  let loaded = null;
  const ctx = {
    db,
    userId: authInfo.extra?.userId,
    baseUrl: request ? resourceUrlFor(request).origin : new URL(config.audience).origin,
    timeZone: 'UTC',
    courses: () => courses || (courses = loadCourses(db)),
    clientId: authInfo.clientId,
    fetchBackend: (path, { method = 'GET', body } = {}) => fetch(`${config.apiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${authInfo.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    }),
    // Rate limit (false: over it) and audit log, in the database as the student. Before the Phase 3
    // migration runs, calls are allowed and not logged.
    takeCall: kind => db.rpc('mcp_take_call', { kind }).then(({ data, error }) => (error ? null : data !== false), () => null),
    logCall: (tool, status, code, latency) => db.rpc('mcp_log_tool_call', { tool, status, error_code: code, latency_ms: latency }).then(() => {}, () => {}),
    load: () => loaded || (loaded = db.from('user_profiles').select('timezone').eq('id', ctx.userId).maybeSingle()
      .then(({ data }) => { ctx.timeZone = zoneOf(data?.timezone || 'UTC'); }, () => {})),
  };
  return ctx;
}

// Name, version, icon, site and description, as the MCP initialize result reports them.
export function serverInfo(origin) {
  return {
    name: MCP_SERVER_NAME,
    title: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    description: MCP_SERVER_DESCRIPTION,
    websiteUrl: origin,
    icons: [{ src: new URL(MCP_ICON_PATH, origin).href, mimeType: 'image/png', sizes: ['512x512'] }],
  };
}

export function createServer(context = {}, config = mcpConfig()) {
  let origin = new URL(config.audience).origin;
  try { if (context.requestInfo) origin = resourceUrlFor(context.requestInfo).origin; } catch { /* the production origin */ }
  const server = new McpServer(serverInfo(origin), { instructions: MCP_INSTRUCTIONS });
  if (context.authInfo) {
    const ctx = studentContext(config, context.authInfo, context.requestInfo);
    registerReadTools(server, ctx);
    registerWriteTools(server, ctx);
    registerPrompts(server);
  }
  return server;
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

export function createMcpEndpoint(config = mcpConfig(), { verifier = createTokenVerifier(config), serverFactory = context => createServer(context, config) } = {}) {
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
