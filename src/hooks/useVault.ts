import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VaultStatus } from "../types";

export function useVault() {
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>("plaintext");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultLoading, setVaultLoading] = useState(false);

  const checkVaultStatus = useCallback(async () => {
    const status = (await invoke("get_vault_status")) as VaultStatus;
    setVaultStatus(status);
    return status;
  }, []);

  const unlockVault = useCallback(async (password: string) => {
    setVaultError(null);
    setVaultLoading(true);
    try {
      await invoke("unlock_vault", { password });
      setVaultStatus("unlocked");
      return true;
    } catch (e) {
      setVaultError(String(e));
      return false;
    } finally {
      setVaultLoading(false);
    }
  }, []);

  const lockVault = useCallback(async () => {
    await invoke("lock_vault");
    setVaultStatus("locked");
  }, []);

  const setupVault = useCallback(async (password: string) => {
    setVaultError(null);
    setVaultLoading(true);
    try {
      await invoke("setup_vault", { password });
      setVaultStatus("unlocked");
      return true;
    } catch (e) {
      setVaultError(String(e));
      return false;
    } finally {
      setVaultLoading(false);
    }
  }, []);

  const changePassword = useCallback(
    async (current: string, newPassword: string) => {
      setVaultError(null);
      setVaultLoading(true);
      try {
        await invoke("change_vault_password", {
          current,
          newPassword,
        });
        return true;
      } catch (e) {
        setVaultError(String(e));
        return false;
      } finally {
        setVaultLoading(false);
      }
    },
    []
  );

  return {
    vaultStatus,
    vaultError,
    vaultLoading,
    checkVaultStatus,
    unlockVault,
    lockVault,
    setupVault,
    changePassword,
  };
}
