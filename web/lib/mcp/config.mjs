// Settings shared by the MCP endpoint, its discovery document and the consent page.
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, supabaseUrlFrom } from '../supabaseUrl.mjs';

// The audience the access-token hook writes into every connected-app token
// (supabase/migrations/20261031120000_oauth_lockdown.sql). Keep the two in step.
export const MCP_TOKEN_AUDIENCE = 'https://classroom.cordiacode.com/mcp';
export const MCP_SERVER_NAME = 'Cordia Classroom';
export const MCP_SERVER_VERSION = '0.1.0';
export const SUPPORT_EMAIL = 'jsmoore588@gmail.com';
export const PRIVACY_PATH = '/privacy';

// Where connected apps may send students back to after the consent page, and which browser
// origins may call /mcp. Hostnames only. Preview and local builds also allow localhost, for MCP
// Inspector; production never does.
const DEFAULT_APP_HOSTS = ['claude.ai', 'chatgpt.com'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export function listOf(value) {
  return String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

export function isProductionDeploy(vercelEnv, nodeEnv) {
  return vercelEnv === 'production' || (!vercelEnv && nodeEnv === 'production');
}

export function connectedAppHosts(configured, { production }) {
  const hosts = listOf(configured);
  return [...(hosts.length ? hosts : DEFAULT_APP_HOSTS), ...(production ? [] : LOCAL_HOSTS)];
}

export function mcpConfig(env = process.env) {
  const supabaseUrl = supabaseUrlFrom(env);
  const production = isProductionDeploy(env.VERCEL_ENV, env.NODE_ENV);
  return {
    supabaseUrl,
    issuer: `${supabaseUrl}/auth/v1`,
    audience: env.MCP_TOKEN_AUDIENCE || MCP_TOKEN_AUDIENCE,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY,
    allowedOrigins: connectedAppHosts(env.MCP_ALLOWED_ORIGINS, { production }),
  };
}

// The MCP endpoint's public URL, as the client reached it: production is
// https://classroom.cordiacode.com/mcp, a preview deploy is its own host.
export function resourceUrlFor(request) {
  const url = new URL(request.url);
  return new URL('/mcp', `${url.protocol}//${url.host}`);
}
