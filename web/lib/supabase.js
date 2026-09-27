import { createClient } from '@supabase/supabase-js';

// Browser-safe project URL and publishable key. Supabase Auth performs every
// sign-in, sign-up, Google OAuth, and password-reset check; Classroom stores the
// resulting session with setToken() and refreshes it through the API.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xoolkofwihjasrvjpbrs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_dzIE5FrkoKgAZUc9h8SkNA_xPxCzdGM';

let client = null;

export function supabaseAuth() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }).auth;
  }
  return client;
}
