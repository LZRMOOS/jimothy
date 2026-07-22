import { useState, useEffect, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";

type UpdateState = "idle" | "available" | "downloading" | "ready" | "error";

export function useUpdater() {
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    try {
      const update = await check();
      if (update) {
        setUpdateVersion(update.version);
        setUpdateState("available");
        return update;
      }
    } catch {
      // Updater not configured or network error — silently ignore
    }
    return null;
  }, []);

  const installUpdate = useCallback(async () => {
    try {
      const update = await check();
      if (!update) return;
      setUpdateState("downloading");
      await update.downloadAndInstall();
      setUpdateState("ready");
    } catch {
      setUpdateState("error");
    }
  }, []);

  useEffect(() => {
    checkForUpdate();
    const interval = setInterval(checkForUpdate, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkForUpdate]);

  return { updateState, updateVersion, checkForUpdate, installUpdate };
}
