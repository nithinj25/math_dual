/** Join class names, dropping anything falsy. Lives outside ui/primitives so
 *  that file exports components only — react-refresh needs that. */
export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");
