import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

export function useEventListener<T = unknown>(
  event: string,
  handler: (payload: T) => void,
  deps: React.DependencyList = []
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unlisten = listen<T>(event, (e) => handlerRef.current(e.payload));
    return () => { unlisten.then((fn) => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
