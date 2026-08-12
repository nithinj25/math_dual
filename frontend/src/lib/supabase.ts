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

/** Google is the only way in. Supabase reports a bad provider config or a
 *  disallowed redirect in `error` rather than throwing, so surface it. */
export async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw new Error(humanise(error.message));
}

export function signOut() {
  return supabase.auth.signOut();
}

/** The two failures a visitor can actually hit, in plain words. */
function humanise(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("provider is not enabled"))
    return "Google sign-in is not configured for this project yet.";
  if (m.includes("redirect") && m.includes("not allowed"))
    return "This address is not on the project's allowed redirect list.";
  return message;
}
