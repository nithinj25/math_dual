import { Command } from "cmdk";
import type { ReactNode } from "react";

export interface Action {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}

export function CommandPalette({
  open, onOpenChange, actions,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  actions: Action[];
}) {
  const groups = [...new Set(actions.map((a) => a.group))];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command menu"
      overlayClassName="fixed inset-0 z-[70] bg-black/55"
      contentClassName="fixed left-1/2 top-[16vh] z-[71] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-line-hi bg-panel shadow-[0_40px_80px_-32px_rgba(0,0,0,0.95)]"
    >
      <Command.Input
        autoFocus
        placeholder="Search commands…"
        className="h-12 w-full border-b border-line bg-transparent px-4 text-15 text-ink outline-none placeholder:text-ink-3"
      />
      <Command.List className="max-h-[19rem] overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-8 text-center text-13 text-ink-3">
          Nothing matches that.
        </Command.Empty>

        {groups.map((g) => (
          <Command.Group
            key={g}
            heading={g}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-11 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-ink-3"
          >
            {actions
              .filter((a) => a.group === g)
              .map((a) => (
                <Command.Item
                  key={a.id}
                  value={`${a.label} ${a.hint ?? ""}`}
                  onSelect={() => {
                    onOpenChange(false);
                    a.run();
                  }}
                  className="flex h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2 text-13 text-ink-2 data-[selected=true]:bg-panel-hi data-[selected=true]:text-ink"
                >
                  <span className="text-ink-3">{a.icon}</span>
                  <span>{a.label}</span>
                  {a.hint && <span className="ml-auto text-11 text-ink-3">{a.hint}</span>}
                </Command.Item>
              ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
