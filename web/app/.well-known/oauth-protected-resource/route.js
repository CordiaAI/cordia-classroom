// RFC 9728 discovery for the MCP server at /mcp. Clients look here, or at the path-specific
// copy (./mcp), after /mcp answers 401.
import { protectedResourceMetadataResponse } from '../../../lib/mcp/endpoint.mjs';

export const dynamic = 'force-dynamic';

export const GET = request => protectedResourceMetadataResponse(request);
export const OPTIONS = request => protectedResourceMetadataResponse(request);
