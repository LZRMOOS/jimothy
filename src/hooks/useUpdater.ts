import { useState, useEffect, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";

type UpdateState = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";

export function useUpdater() {
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    setUpdateState("checking");
    try {
      const update = await check();
      if (update) {
        setUpdateVersion(update.version);
        setUpdateState("available");
        return update;
      }
      setUpdateState("up-to-date");
      setTimeout(() => setUpdateState((s) => s === "up-to-date" ? "idle" : s), 4000);
    } catch {
      setUpdateState("error");
      setTimeout(() => setUpdateState((s) => s === "error" ? "idle" : s), 4000);
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
