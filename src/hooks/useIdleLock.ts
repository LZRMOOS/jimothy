import { useEffect, useRef, useCallback } from "react";

export function useIdleLock(
  enabled: boolean,
  timeoutMinutes: number,
  onLock: () => void
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (!enabled || timeoutMinutes <= 0) return;
    timerRef.current = setTimeout(onLock, timeoutMinutes * 60 * 1000);
  }, [enabled, timeoutMinutes, onLock]);

  useEffect(() => {
    if (!enabled || timeoutMinutes <= 0) return;

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    const handler = () => resetTimer();

    events.forEach((event) => window.addEventListener(event, handler));
    resetTimer();

    return () => {
      events.forEach((event) => window.removeEventListener(event, handler));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, timeoutMinutes, resetTimer]);
}
