import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const appUrl = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, "");

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY wajib diisi.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
