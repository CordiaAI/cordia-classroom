// The Cordia Classroom MCP server (Streamable HTTP, stateless). Only connected-app tokens from
// Supabase Auth's OAuth server are accepted; see lib/mcp/auth.mjs.
import { createMcpEndpoint } from '../../lib/mcp/endpoint.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const serve = createMcpEndpoint();

export const GET = request => serve(request);
export const POST = request => serve(request);
export const DELETE = request => serve(request);
export const OPTIONS = request => serve(request);
