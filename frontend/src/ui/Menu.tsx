import * as D from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

import { cx } from "../lib/cx";

export function Menu({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <D.Root>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Content
          align="end"
          sideOffset={6}
          className="z-[60] min-w-52 rounded-lg border border-line-hi bg-panel p-1 shadow-[0_20px_44px_-20px_rgba(0,0,0,0.9)]"
        >
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function MenuItem({
  onSelect, children, right, danger,
}: {
  onSelect?: () => void;
  children: ReactNode;
  right?: ReactNode;
  danger?: boolean;
}) {
  return (
    <D.Item
      onSelect={onSelect}
      className={cx(
        "flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-13 outline-none",
        "data-[highlighted]:bg-panel-hi",
        danger ? "text-bad" : "text-ink-2 data-[highlighted]:text-ink",
      )}
    >
      {children}
      {right && <span className="ml-auto text-ink-3">{right}</span>}
    </D.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <D.Label className="eyebrow px-2 py-1.5">{children}</D.Label>;
}

export const MenuSeparator = () => <D.Separator className="my-1 h-px bg-line" />;
