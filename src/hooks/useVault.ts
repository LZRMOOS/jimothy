import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { VaultStatus } from "../types";

/// Result of a PIN unlock attempt, mirroring the backend PinUnlockDto plus a
/// frontend-only "error" variant for IPC/exception failures.
export type PinUnlockResult =
  | { status: "ok" }
  | { status: "wrong"; remaining: number }
  | { status: "wiped" }
  | { status: "not-enrolled" }
  | { status: "error"; message: string };

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

  // Unlock via PIN. Returns a discriminated result so the caller can message
  // remaining attempts / escrow-wiped without treating those as hard errors.
  const pinUnlock = useCallback(
    async (pin: string): Promise<PinUnlockResult> => {
      setVaultError(null);
      setVaultLoading(true);
      try {
        const res = (await invoke("pin_unlock", { pin })) as PinUnlockResult;
        if (res.status === "ok") setVaultStatus("unlocked");
        return res;
      } catch (e) {
        setVaultError(String(e));
        return { status: "error", message: String(e) };
      } finally {
        setVaultLoading(false);
      }
    },
    []
  );

  // Verify a PIN against the vault WITHOUT re-locking/unlocking — the re-auth
  // gate for a sensitive note while the vault is already unlocked. Shares the
  // escrow attempt counter with pinUnlock, so wrong tries here also burn the PIN.
  const pinVerify = useCallback(
    async (pin: string): Promise<PinUnlockResult> => {
      try {
        return (await invoke("pin_verify", { pin })) as PinUnlockResult;
      } catch (e) {
        return { status: "error", message: String(e) };
      }
    },
    []
  );

  // Unlock note protection (installs the protection key so .pnote notes decrypt)
  // using the same PIN. Used by the plaintext-mode sensitive-note gate.
  const pinUnlockProtection = useCallback(
    async (pin: string): Promise<PinUnlockResult> => {
      try {
        return (await invoke("pin_unlock_protection", { pin })) as PinUnlockResult;
      } catch (e) {
        return { status: "error", message: String(e) };
      }
    },
    []
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
    pinUnlock,
    pinVerify,
    pinUnlockProtection,
    lockVault,
    setupVault,
    changePassword,
    disableVault,
  };
}
