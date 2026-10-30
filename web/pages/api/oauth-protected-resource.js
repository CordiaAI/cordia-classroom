// RFC 9728 discovery for the MCP server, served at /.well-known/oauth-protected-resource and
// /.well-known/oauth-protected-resource/mcp (rewrites in next.config.js).
import { protectedResourceMetadataResponse } from '../../lib/mcp/endpoint.mjs';
import { webHandler } from '../../lib/server/webRequest.mjs';

export default webHandler(request => protectedResourceMetadataResponse(request));
