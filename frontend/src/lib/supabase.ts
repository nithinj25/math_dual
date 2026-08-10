import { createClient, type Session } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!URL || !ANON) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env",
  );
}

export const supabase = createClient(URL, ANON);

export function onAuth(cb: (session: Session | null) => void) {
  supabase.auth.getSession().then(({ data }) => cb(data.session));
  const { data } = supabase.auth.onAuthStateChange((_e, s) => cb(s));
  return () => data.subscription.unsubscribe();
}

export async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  // Supabase reports a bad provider config or a disallowed redirect here
  // rather than throwing, so surface it instead of failing silently.
  if (error) throw new Error(error.message);
}

export function signOut() {
  return supabase.auth.signOut();
}
