import { ChevronDown, Copy, LogOut, Search, Swords } from "lucide-react";

import type { Me } from "../lib/api";
import type { Status } from "../lib/socket";
import { initials } from "../lib/format";
import { Button, Dot, Kbd } from "../ui/primitives";
import { cx } from "../lib/cx";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../ui/Menu";
import { Tip } from "../ui/Tooltip";

export type View = "play" | "board" | "system";

const NAV: { id: View; label: string }[] = [
  { id: "play", label: "Play" },
  { id: "board", label: "Leaderboard" },
  { id: "system", label: "System" },
];

export default function TopBar({
  me, view, onView, apiOk, ws, showNav, dev, onCommand, onSignOut, onSignIn, onHome,
}: {
  me: Me | null;
  view: View;
  onView: (v: View) => void;
  apiOk: boolean | null;
  ws: Status;
  showNav: boolean;
  /** Service dots, the System tab and ⌘K are for building, not for playing. */
  dev: boolean;
  onCommand: () => void;
  onSignOut: () => void;
  /** Only on the landing page, where signing in is the one thing to do. */
  onSignIn?: () => void;
  onHome: () => void;
}) {
  const nav = dev ? NAV : NAV.filter((n) => n.id !== "system");
  return (
    <header className="sticky top-0 z-40 flex h-12 items-center gap-1 border-b border-line bg-bg/80 px-3 backdrop-blur-xl sm:px-4">
      <button onClick={onHome} className="flex items-center gap-2 pr-2" aria-label="MathDuel home">
        <span className="grid size-6 place-items-center rounded-md bg-accent/15 text-accent-hi ring-1 ring-accent/25">
          <Swords size={13} strokeWidth={2.25} />
        </span>
        <span className="text-13 font-medium tracking-[-0.02em]">MathDuel</span>
      </button>

      {showNav && (
        <nav className="flex items-center gap-0.5">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => onView(n.id)}
              aria-current={view === n.id ? "page" : undefined}
              className={cx(
                "h-7 rounded-md px-2.5 text-13 font-medium transition-colors duration-150",
                view === n.id ? "bg-panel-hi text-ink" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {n.label}
            </button>
          ))}
        </nav>
      )}

      <span className="flex-1" />

      {dev && me && (
        <button
          onClick={onCommand}
          className="mr-1 hidden h-7 items-center gap-2 rounded-md border border-line pl-2 pr-1.5 text-13 text-ink-3 transition-colors duration-150 hover:border-line-hi hover:text-ink-2 sm:flex"
        >
          <Search size={12} />
          <span>Search</span>
          <Kbd>⌘K</Kbd>
        </button>
      )}

      {dev && (
        <>
      <Tip label={apiOk === null ? "checking the API" : apiOk ? "API reachable" : "API unreachable"}>
        <span className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-11 text-ink-3">
          <Dot tone={apiOk === null ? "idle" : apiOk ? "on" : "off"} />
          api
        </span>
      </Tip>

      {ws !== "idle" && (
        <Tip label={`gateway socket: ${ws}`}>
          <span className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-11 text-ink-3">
            <Dot tone={ws === "open" ? "on" : ws === "connecting" ? "warn" : "off"} />
            ws
          </span>
        </Tip>
      )}
        </>
      )}

      {onSignIn && (
        <Button variant="primary" size="sm" className="ml-1" onClick={onSignIn}>
          Sign in
        </Button>
      )}

      {me && (
        <Menu
          trigger={
            <Button variant="ghost" size="sm" className="gap-2 pl-1.5">
              <span className="grid size-5 place-items-center rounded-full bg-accent text-[10px] font-semibold uppercase text-white">
                {initials(me.username)}
              </span>
              <span className="hidden text-ink sm:inline">{me.username}</span>
              <ChevronDown size={12} className="text-ink-3" />
            </Button>
          }
        >
          <MenuLabel>{me.email ?? me.username}</MenuLabel>
          <MenuItem onSelect={() => navigator.clipboard?.writeText(me.id)}>
            <Copy size={13} /> Copy user id
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={onSignOut}>
            <LogOut size={13} /> Sign out
          </MenuItem>
        </Menu>
      )}
    </header>
  );
}
