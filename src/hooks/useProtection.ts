import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export type ProtectionStatus = "none" | "locked" | "unlocked";

export function useProtection() {
  const [protectionStatus, setProtectionStatus] =
    useState<ProtectionStatus>("none");
  const [protectionError, setProtectionError] = useState<string | null>(null);
  const [protectionLoading, setProtectionLoading] = useState(false);

  const checkProtectionStatus = useCallback(async () => {
    const status = (await invoke("get_protection_status")) as ProtectionStatus;
    setProtectionStatus(status);
    return status;
  }, []);

  const setupProtection = useCallback(async (password: string) => {
    setProtectionError(null);
    setProtectionLoading(true);
    try {
      await invoke("setup_protection", { password });
      setProtectionStatus("unlocked");
      return true;
    } catch (e) {
      setProtectionError(String(e));
      return false;
    } finally {
      setProtectionLoading(false);
    }
  }, []);

  const unlockProtection = useCallback(async (password: string) => {
    setProtectionError(null);
    setProtectionLoading(true);
    try {
      await invoke("unlock_protection", { password });
      setProtectionStatus("unlocked");
      return true;
    } catch (e) {
      setProtectionError(String(e));
      return false;
    } finally {
      setProtectionLoading(false);
    }
  }, []);

  const verifyProtectionPassword = useCallback(async (password: string) => {
    return (await invoke("verify_protection_password", { password })) as boolean;
  }, []);

  const protectNote = useCallback(async (id: string) => {
    await invoke("protect_note", { id });
  }, []);

  const unprotectNote = useCallback(async (id: string) => {
    await invoke("unprotect_note", { id });
  }, []);

  const getProtectedNoteBody = useCallback(async (id: string) => {
    return (await invoke("get_protected_note_body", { id })) as string;
  }, []);

  const changeProtectionPassword = useCallback(
    async (current: string, newPassword: string) => {
      setProtectionError(null);
      setProtectionLoading(true);
      try {
        await invoke("change_protection_password", { current, newPassword });
        return true;
      } catch (e) {
        setProtectionError(String(e));
        return false;
      } finally {
        setProtectionLoading(false);
      }
    },
    []
  );

  const disableProtection = useCallback(async (password: string) => {
    setProtectionError(null);
    setProtectionLoading(true);
    try {
      await invoke("disable_protection", { password });
      setProtectionStatus("none");
      return true;
    } catch (e) {
      setProtectionError(String(e));
      return false;
    } finally {
      setProtectionLoading(false);
    }
  }, []);

  return {
    protectionStatus,
    protectionError,
    protectionLoading,
    checkProtectionStatus,
    setupProtection,
    unlockProtection,
    verifyProtectionPassword,
    protectNote,
    unprotectNote,
    getProtectedNoteBody,
    changeProtectionPassword,
    disableProtection,
  };
}
