import { Delete } from "lucide-react";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "-", "0", "back"];

/** Thumb entry for phones. Feeds the same input the keyboard does. */
export default function Keypad({
  onKey, onSubmit, disabled,
}: {
  onKey: (k: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid w-[min(18rem,100%)] grid-cols-3 gap-1.5">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          onClick={() => onKey(k)}
          aria-label={k === "back" ? "backspace" : k}
          className="flex h-11 items-center justify-center rounded-lg border border-line bg-panel font-mono text-15 text-ink transition-colors duration-100 hover:bg-panel-hi active:translate-y-px disabled:opacity-40"
        >
          {k === "back" ? <Delete size={15} className="text-ink-2" /> : k}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={onSubmit}
        className="col-span-3 h-11 rounded-lg bg-accent text-13 font-medium text-white transition-colors duration-100 hover:bg-accent-hi active:translate-y-px disabled:opacity-40"
      >
        Submit
      </button>
    </div>
  );
}
