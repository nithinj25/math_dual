import { useEffect, useRef, useState } from "react";

/** A clock that re-renders on an interval. Stops dead when active is false,
 *  so an idle screen costs nothing. */
export function useNow(intervalMs = 250, active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

/** Eases a number toward its target so scores roll rather than jump. */
export function useCountUp(target: number, durationMs = 450) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    if (a === target) return;

    const step = (t: number) => {
      const k = Math.min(1, (t - start) / durationMs);
      const eased = 1 - (1 - k) ** 3;
      setShown(Math.round(a + (target - a) * eased));
      if (k < 1) raf.current = requestAnimationFrame(step);
      else from.current = target;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, durationMs]);

  return shown;
}

/** Re-runs an async read on an interval, and reports load state honestly. */
export function usePolled<T>(
  read: () => Promise<T>,
  deps: unknown[],
  everyMs = 0,
): { data: T | null; error: string | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const readRef = useRef(read);
  readRef.current = read;

  useEffect(() => {
    let dead = false;
    const run = (first: boolean) => {
      if (first) setLoading(true);
      readRef
        .current()
        .then((d) => {
          if (dead) return;
          setData(d);
          setError(null);
        })
        .catch((e: Error) => !dead && setError(e.message))
        .finally(() => !dead && setLoading(false));
    };

    run(true);
    if (!everyMs) return () => { dead = true; };
    const id = setInterval(() => run(false), everyMs);
    return () => {
      dead = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, everyMs, nonce]);

  return { data, error, loading, refresh: () => setNonce((n) => n + 1) };
}
