// The Supabase project URL. The browser falls back to the production project when
// NEXT_PUBLIC_SUPABASE_URL isn't set, so the server must too, or server features (visuals,
// lectures, note covers) think Supabase isn't set up while sign-in works.
export const DEFAULT_SUPABASE_URL = 'https://xoolkofwihjasrvjpbrs.supabase.co';

export function supabaseUrlFrom(env = process.env) {
  return (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
}
