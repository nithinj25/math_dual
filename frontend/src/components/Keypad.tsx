const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "-", "0", "⌫"];

/** Thumb-sized entry for phones — the keyboard path stays identical, this
 *  just feeds the same input. */
export default function Keypad({
  onKey, onSubmit, disabled,
}: {
  onKey: (k: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="keypad">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className="key"
          disabled={disabled}
          onClick={() => onKey(k)}
          aria-label={k === "⌫" ? "backspace" : k === "-" ? "minus" : k}
        >
          {k}
        </button>
      ))}
      <button type="button" className="key enter" disabled={disabled} onClick={onSubmit}>
        Submit
      </button>
    </div>
  );
}
