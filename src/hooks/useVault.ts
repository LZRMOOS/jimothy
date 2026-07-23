import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VaultStatus } from "../types";

export function useVault() {
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>("plaintext");
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [vaultLoading, setVaultLoading] = useState(false);

  const vaultAction = useCallback(
    async (fn: () => Promise<void>, opts?: { clearError?: boolean; statusOnSuccess?: VaultStatus }) => {
      if (opts?.clearError !== false) setVaultError(null);
      setVaultLoading(true);
      try {
        await fn();
        if (opts?.statusOnSuccess) setVaultStatus(opts.statusOnSuccess);
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

  const checkVaultStatus = useCallback(async () => {
    const status = (await invoke("get_vault_status")) as VaultStatus;
    setVaultStatus(status);
    return status;
  }, []);

  const unlockVault = useCallback(
    (password: string) =>
      vaultAction(
        () => invoke("unlock_vault", { password }),
        { clearError: false, statusOnSuccess: "unlocked" }
      ).then((ok) => { if (ok) setVaultError(null); return ok; }),
    [vaultAction]
  );

  const lockVault = useCallback(async () => {
    await invoke("lock_vault");
    setVaultStatus("locked");
  }, []);

  const setupVault = useCallback(
    (password: string) =>
      vaultAction(
        () => invoke("setup_vault", { password }),
        { statusOnSuccess: "unlocked" }
      ),
    [vaultAction]
  );

  const changePassword = useCallback(
    (current: string, newPassword: string) =>
      vaultAction(() => invoke("change_vault_password", { current, newPassword })),
    [vaultAction]
  );

  const disableVault = useCallback(
    (password: string) =>
      vaultAction(
        () => invoke("disable_vault", { password }),
        { statusOnSuccess: "plaintext" }
      ),
    [vaultAction]
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
    disableVault,
  };
}
