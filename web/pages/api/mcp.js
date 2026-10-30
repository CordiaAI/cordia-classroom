// The Cordia Classroom MCP server, served at /mcp (rewrite in next.config.js). Stateless
// Streamable HTTP. The one route that accepts connected-app tokens, and only those: see
// lib/mcp/auth.mjs. Every other API route refuses them (lib/server/connectedApps.mjs).
import { createMcpEndpoint } from '../../lib/mcp/endpoint.mjs';
import { webHandler } from '../../lib/server/webRequest.mjs';

export const config = { api: { bodyParser: false, responseLimit: false }, maxDuration: 300 };

export default webHandler(createMcpEndpoint());
