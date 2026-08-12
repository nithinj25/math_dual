import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={250} skipDelayDuration={300}>
    {children}
  </T.Provider>
);

export function Tip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          sideOffset={6}
          className="z-[60] rounded-md border border-line-hi bg-panel-hi px-2 py-1 text-11 text-ink-2 shadow-[0_12px_28px_-12px_rgba(0,0,0,0.8)]"
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
