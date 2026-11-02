// Settings shared by the MCP endpoint, its discovery document and the consent page.
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, supabaseUrlFrom } from '../supabaseUrl.mjs';

// The audience the access-token hook writes into every connected-app token
// (supabase/migrations/20261031120000_oauth_lockdown.sql). Keep the two in step.
export const MCP_TOKEN_AUDIENCE = 'https://classroom.cordiacode.com/mcp';
export const MCP_SERVER_NAME = 'Cordia Classroom';
export const MCP_SERVER_VERSION = '0.4.0';
export const MCP_SERVER_DESCRIPTION = 'Your own Cordia study sets, lecture notes, flashcards and progress: search them, get quizzed, and save new cards and notes back to your Library.';
// The connector's icon: the Cordia mark (served from web/public).
export const MCP_ICON_PATH = '/cordia-mcp-icon.png';
export const SUPPORT_EMAIL = 'jude@cordiaai.io';
export const PRIVACY_PATH = '/privacy';

// How a connected AI should use this server.
export const MCP_INSTRUCTIONS = [
  'Cordia Classroom holds this student\'s own course material: study sets, lecture notes and transcripts, flashcards, quizzes and progress.',
  'For questions about their courses, call search_my_materials first, answer from what it returns, and cite titles and lecture timestamps. If Cordia has nothing relevant, say so before using general knowledge.',
  'When quizzing, ask one question at a time and collect the student\'s answer and confidence before revealing anything. Log every answer with record_answer.',
  'Use get_progress weak_topics to choose what to review.',
  'Add to the Library (create_study_set, add_flashcards, save_note) only when the student asks.',
  'This connector can\'t see assignments, grades or due dates from Canvas or other LMSs, so don\'t promise them.',
].join(' ');

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
    // The FastAPI backend's /mcp/* routes (get_progress uses the app's Progress functions there).
    apiUrl: (env.CLASSROOM_API_URL || env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, ''),
  };
}

// The MCP endpoint's public URL, as the client reached it: production is
// https://classroom.cordiacode.com/mcp, a preview deploy is its own host.
export function resourceUrlFor(request) {
  const url = new URL(request.url);
  return new URL('/mcp', `${url.protocol}//${url.host}`);
}
