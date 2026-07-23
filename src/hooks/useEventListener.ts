import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

export function useEventListener<T = unknown>(
  event: string,
  handler: (payload: T) => void,
  deps: React.DependencyList = []
) {
  useEffect(() => {
    const unlisten = listen<T>(event, (e) => handler(e.payload));
    return () => { unlisten.then((fn) => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
