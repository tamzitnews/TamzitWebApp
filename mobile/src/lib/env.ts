// Public Supabase settings (safe to ship in the app: access is enforced by RLS and RPCs).
// Values come from EXPO_PUBLIC_* env vars at build time (mobile/.env).
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
