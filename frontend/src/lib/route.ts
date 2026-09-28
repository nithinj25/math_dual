import { useSyncExternalStore } from "react";

/** Three pages, in the order a visitor meets them: the landing page, the
 *  sign-in page, then the game itself. Kept in the hash so a refresh — and the
 *  browser's back button — land where the player expects. */
export type Route = "home" | "login" | "play";

function parse(): Route {
  const path = window.location.hash.replace(/^#\/?/, "").split(/[?#]/)[0];
  return path === "login" ? "login" : path === "play" ? "play" : "home";
}

export function go(route: Route) {
  const next = route === "home" ? "#/" : `#/${route}`;
  if (window.location.hash !== next) window.location.hash = next;
}

/** Replaces the entry instead of adding one, so a redirect cannot trap the
 *  back button between two pages. */
export function replace(route: Route) {
  const next = route === "home" ? "#/" : `#/${route}`;
  if (window.location.hash === next) return;
  window.history.replaceState(null, "", `${window.location.pathname}${next}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

const subscribe = (fn: () => void) => {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
};

export const useRoute = () => useSyncExternalStore(subscribe, parse, () => "home" as Route);
