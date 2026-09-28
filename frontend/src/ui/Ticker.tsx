import { useEffect, useState } from "react";
import { animate } from "motion/react";

import { cx } from "../lib/cx";

/** A number that rolls to its new value instead of snapping. */
export function Ticker({
  value, className, format = (n) => String(n),
}: {
  value: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const controls = animate(shown, value, {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(v),
    });
    return () => controls.stop();
    // shown is deliberately not a dependency: it is the animation's own output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span className={cx("tnum", className)}>{format(Math.round(shown))}</span>;
}
