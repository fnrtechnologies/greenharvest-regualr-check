import { supabase } from "./supabase";

export async function adminLogin(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function isLoggedIn(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

export function logout() {
  supabase.auth.signOut();
}
