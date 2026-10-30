import { createClient } from '@supabase/supabase-js';
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from './supabaseUrl.mjs';

// Browser-safe project URL and publishable key. Supabase Auth performs every
// sign-in, sign-up, Google OAuth, and password-reset check; Classroom stores the
// resulting session with setToken() and refreshes it through the API.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

let client = null;

export function supabaseAuth() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }).auth;
  }
  return client;
}
