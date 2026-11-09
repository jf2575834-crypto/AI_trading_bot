import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> = {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** Time of the last successful load, for stale-data indicators. */
  loadedAt: number | null;
  reload: () => Promise<void>;
  setData: (value: T) => void;
};

/**
 * Loads data and exposes loading / error / data states. Concurrent reloads are
 * collapsed so an auto-refresh can never stack requests, and late responses
 * from a previous dependency set are ignored.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const generation = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  const reload = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const gen = generation.current;
    setLoading(true);
    const p = run()
      .then((value) => {
        if (gen !== generation.current) return;
        setData(value);
        setError(null);
        setLoadedAt(Date.now());
      })
      .catch((err: unknown) => {
        if (gen !== generation.current) return;
        setError(err instanceof Error ? err.message : "Something went wrong");
      })
      .finally(() => {
        inFlight.current = null;
        if (gen === generation.current) setLoading(false);
      });
    inFlight.current = p;
    return p;
  }, [run]);

  useEffect(() => {
    generation.current += 1;
    inFlight.current = null;
    void reload();
  }, [reload]);

  return { data, error, loading, loadedAt, reload, setData };
}

/** Re-renders every `ms` milliseconds; returns the current time. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** Calls `fn` every `ms` while the tab is visible. */
export function useVisibleInterval(fn: () => void, ms: number) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") saved.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

/** Tracks an element's width for responsive SVG charts. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
