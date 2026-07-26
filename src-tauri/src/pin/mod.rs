//! PIN quick-unlock for the vault and note protection.
//!
//! A short (4-digit) PIN is a *convenience gate*, never a replacement for the
//! vault password. On enrollment (while the vault is already unlocked) we wrap a
//! copy of the in-memory vault key with an Argon2id key derived from the PIN and
//! stash it in the app config dir. Unlocking re-derives the wrap key from the
//! entered PIN, unwraps the vault key, and validates it against the vault's
//! verification record before installing it.
//!
//! The SAME PIN can also wrap the note-protection key (a second, independent
//! escrow entry keyed by `EscrowKind::Protection`). That lets one PIN both
//! quick-unlock the vault *and* re-authenticate sensitive/protected notes — so
//! if you leave the vault unlocked, protected notes still demand the PIN. The
//! two escrows are separate wrapped keys under one PIN; each is validated
//! against its own verification record on unlock.
//!
//! Why this is safe despite a PIN's tiny keyspace (10k-1M):
//! - The escrow lives in the OS app-config dir (`dirs::config_dir()/jimothy/`),
//!   which is DEVICE-LOCAL and never placed in the notes folder / `.scratch/`.
//!   So it never syncs via Dropbox. Someone who copies your synced notes gets
//!   the full-strength Argon2id *password* vault and no PIN escrow to attack.
//! - A wrong PIN just fails to unwrap. We count failures and, after
//!   `MAX_ATTEMPTS`, delete the escrow entirely — the attacker is then forced
//!   back to the password. This caps online guessing.
//! - The password stays the source of truth: it always works, and any password
//!   change or vault-disable purges the escrow (the wrapped key is stale).
//!
//! Honest limitation: an attacker with code-execution on your unlocked account
//! could read the escrow file and brute-force the PIN offline (the attempt
//! counter is only enforced by this app). That same attacker can already read
//! the vault key from the running process or keylog the password, so the PIN is
//! not the weakest link in that scenario. This is a convenience feature, not a
//! security upgrade.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::crypto::{self, CipherBlock, KdfParams};

/// How many wrong PINs before the escrow is wiped and the user must fall back to
/// the full password.
pub const MAX_ATTEMPTS: u32 = 10;

/// A single vault's PIN escrow: the vault key wrapped under a PIN-derived key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinEscrow {
    /// KDF params (with a fresh random salt) for deriving the wrap key from the
    /// PIN. Independent of the vault's own KDF params.
    pub kdf: KdfParams,
    /// The vault key, encrypted under the PIN-derived key.
    pub wrapped_key: CipherBlock,
    /// Consecutive failed unlock attempts. Reset to 0 on success.
    pub fail_count: u32,
}

/// Which key an escrow wraps. One PIN can wrap both, as two independent entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EscrowKind {
    /// The vault key (unlocks all notes).
    Vault,
    /// The note-protection key (decrypts `.pnote` files / re-auth gate).
    Protection,
}

impl EscrowKind {
    fn prefix(self) -> &'static str {
        match self {
            EscrowKind::Vault => "vault",
            EscrowKind::Protection => "protection",
        }
    }
}

/// Compose the store key for a (kind, folder) pair. Prefixing by kind keeps the
/// two escrows independent while sharing one PIN and one device-local file.
fn store_key(kind: EscrowKind, vault_path: &str) -> String {
    format!("{}:{}", kind.prefix(), vault_path)
}

/// The on-disk escrow store: a map from `"{kind}:{folder path}"` to its escrow.
/// Kept in one device-local file so multiple vault profiles each get an
/// independent PIN, and each profile's vault and protection keys escrow
/// separately.
type EscrowStore = HashMap<String, PinEscrow>;

fn escrow_path() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir().ok_or("Cannot find config directory")?;
    Ok(config_dir.join("jimothy").join("pin-escrow.json"))
}

fn load_store() -> EscrowStore {
    let path = match escrow_path() {
        Ok(p) => p,
        Err(_) => return EscrowStore::new(),
    };
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => EscrowStore::new(),
    }
}

fn save_store(store: &EscrowStore) -> Result<(), String> {
    let path = escrow_path()?;
    let dir = path
        .parent()
        .ok_or("Bad escrow path")?
        .to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Failed to serialize PIN escrow: {}", e))?;
    // Atomic write: temp file + rename.
    let tmp = dir.join("pin-escrow.json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("Failed to write PIN escrow: {}", e))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Failed to save PIN escrow: {}", e)
    })
}

/// How many digits a PIN has. Fixed at 4 (a convenience gate, not a security
/// boundary — length buys nothing meaningful against the only real attacks, so
/// we favor the shorter, phone-lock-screen feel). Keep in sync with the
/// frontend `PinInput length`.
pub const PIN_LENGTH: usize = 4;

/// Basic PIN shape check. Keep the policy in one place so the frontend and
/// backend agree. Exactly `PIN_LENGTH` digits, numeric only.
pub fn pin_valid(pin: &str) -> bool {
    pin.chars().count() == PIN_LENGTH && pin.chars().all(|c| c.is_ascii_digit())
}

/// Whether a PIN is enrolled for the given kind + vault path. Cheap file read,
/// no crypto, no prompt — safe to call to decide whether to show the PIN UI.
/// The vault escrow is the canonical "a PIN exists" signal; the protection
/// escrow tags along only when protection is set up.
pub fn is_enrolled(kind: EscrowKind, vault_path: &str) -> bool {
    load_store().contains_key(&store_key(kind, vault_path))
}

/// Build a fresh escrow wrapping `key` under a key derived from `pin` (fresh
/// random salt each time, so the same PIN never yields the same wrap key twice).
fn wrap(pin: &str, key: &[u8]) -> Result<PinEscrow, String> {
    let kdf = KdfParams::default();
    let pin_key = crypto::derive_key(pin, &kdf)?;
    let wrapped_key = crypto::encrypt_bytes(key, &pin_key)?;
    Ok(PinEscrow {
        kdf,
        wrapped_key,
        fail_count: 0,
    })
}

/// (Re)enroll a PIN for this vault, wrapping the given key(s) under it. This is
/// the ONLY enroll entry point, and it always REPLACES the whole PIN: both the
/// vault and protection escrows are dropped first, then re-created for whichever
/// keys are supplied. That matters for correctness — if you re-set the PIN while
/// one layer is locked (its key not in memory), the old escrow for that layer
/// must NOT survive, or the OLD PIN would still open it (the layer's key hasn't
/// changed). The single `save_store` also makes enrollment atomic: it can't
/// leave one layer on the new PIN and the other on the old one.
///
/// At least one key must be supplied; passing neither is a programmer error.
pub fn enroll_keys(
    vault_path: &str,
    pin: &str,
    vault_key: Option<&[u8]>,
    protection_key: Option<&[u8]>,
) -> Result<(), String> {
    if !pin_valid(pin) {
        return Err("PIN must be 4 digits.".into());
    }
    if vault_key.is_none() && protection_key.is_none() {
        return Err("No key to wrap under the PIN.".into());
    }

    // Wrap up front so a crypto failure can't leave a half-cleared store.
    let vault_escrow = vault_key.map(|k| wrap(pin, k)).transpose()?;
    let protection_escrow = protection_key.map(|k| wrap(pin, k)).transpose()?;

    let mut store = load_store();
    // Replace, not merge: drop any prior escrows for this vault first.
    store.remove(&store_key(EscrowKind::Vault, vault_path));
    store.remove(&store_key(EscrowKind::Protection, vault_path));
    if let Some(e) = vault_escrow {
        store.insert(store_key(EscrowKind::Vault, vault_path), e);
    }
    if let Some(e) = protection_escrow {
        store.insert(store_key(EscrowKind::Protection, vault_path), e);
    }
    save_store(&store)
}

/// Remove the escrow for this kind + vault (a purge on password change / disable
/// of that layer). Not-found is success.
pub fn disable(kind: EscrowKind, vault_path: &str) -> Result<(), String> {
    let mut store = load_store();
    if store.remove(&store_key(kind, vault_path)).is_some() {
        save_store(&store)?;
    }
    Ok(())
}

/// Remove BOTH the vault and protection escrows for this vault (user turned the
/// PIN off entirely). Not-found is success.
pub fn disable_all(vault_path: &str) -> Result<(), String> {
    let mut store = load_store();
    let before = store.len();
    store.remove(&store_key(EscrowKind::Vault, vault_path));
    store.remove(&store_key(EscrowKind::Protection, vault_path));
    if store.len() != before {
        save_store(&store)?;
    }
    Ok(())
}

/// Outcome of a PIN unlock attempt.
pub enum PinUnlockResult {
    /// PIN correct — here is the unwrapped vault key (validated by the caller).
    Ok(Vec<u8>),
    /// Wrong PIN; this many attempts remain before the escrow is wiped.
    Wrong { remaining: u32 },
    /// Too many failures — escrow has been deleted; fall back to password.
    Wiped,
    /// No escrow enrolled for this vault.
    NotEnrolled,
}

/// Attempt to unwrap the `kind` key with `pin`. Increments/​resets the failure
/// counter and, after `MAX_ATTEMPTS`, wipes BOTH escrows for the vault — it's one
/// PIN, so a burned PIN is useless for either layer. The returned key is NOT yet
/// validated against the verification record — the caller must do that (and reset
/// the counter via `record_success`) so a corrupt escrow that happens to decrypt
/// to garbage is still rejected.
pub fn attempt_unlock(
    kind: EscrowKind,
    vault_path: &str,
    pin: &str,
) -> Result<PinUnlockResult, String> {
    let key = store_key(kind, vault_path);
    let mut store = load_store();
    let escrow = match store.get_mut(&key) {
        Some(e) => e,
        None => return Ok(PinUnlockResult::NotEnrolled),
    };

    let pin_key = crypto::derive_key(pin, &escrow.kdf)?;
    match crypto::decrypt_bytes(&escrow.wrapped_key, &pin_key) {
        Ok(unwrapped) => {
            // Don't reset the counter here — the caller validates the key first
            // and calls record_success. Leave state untouched on the happy path.
            Ok(PinUnlockResult::Ok(unwrapped))
        }
        Err(_) => {
            escrow.fail_count += 1;
            let fail_count = escrow.fail_count;
            if fail_count >= MAX_ATTEMPTS {
                // Burn the whole PIN, not just the attempted layer.
                store.remove(&store_key(EscrowKind::Vault, vault_path));
                store.remove(&store_key(EscrowKind::Protection, vault_path));
                save_store(&store)?;
                Ok(PinUnlockResult::Wiped)
            } else {
                let remaining = MAX_ATTEMPTS - fail_count;
                save_store(&store)?;
                Ok(PinUnlockResult::Wrong { remaining })
            }
        }
    }
}

/// Reset the failure counter after a validated successful unlock. Resets both
/// escrows' counters — a correct PIN clears the whole PIN's failure history.
pub fn record_success(vault_path: &str) -> Result<(), String> {
    let mut store = load_store();
    let mut changed = false;
    for kind in [EscrowKind::Vault, EscrowKind::Protection] {
        if let Some(escrow) = store.get_mut(&store_key(kind, vault_path)) {
            if escrow.fail_count != 0 {
                escrow.fail_count = 0;
                changed = true;
            }
        }
    }
    if changed {
        save_store(&store)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_keys_are_kind_scoped() {
        // Vault and protection escrows for the same folder must never collide.
        let vault = store_key(EscrowKind::Vault, "/notes");
        let protection = store_key(EscrowKind::Protection, "/notes");
        assert_ne!(vault, protection);
        assert_eq!(vault, "vault:/notes");
        assert_eq!(protection, "protection:/notes");
    }

    #[test]
    fn pin_shape_policy() {
        assert!(pin_valid("1234"));
        assert!(!pin_valid("123")); // too short
        assert!(!pin_valid("12345")); // too long
        assert!(!pin_valid("123456")); // too long
        assert!(!pin_valid("12a4")); // non-digit
        assert!(!pin_valid("")); // empty
    }

    // Exercise the wrap/unwrap round-trip directly (no file I/O) so the crypto
    // contract is covered without touching the shared on-disk store.
    #[test]
    fn wrap_unwrap_roundtrip() {
        let vault_key = vec![7u8; 32];
        let kdf = KdfParams {
            algorithm: "argon2id".to_string(),
            salt: base64_salt(),
            memory_cost: 1024,
            time_cost: 1,
            parallelism: 1,
        };
        let pin_key = crypto::derive_key("4242", &kdf).unwrap();
        let wrapped = crypto::encrypt_bytes(&vault_key, &pin_key).unwrap();

        // Right PIN unwraps to the same key.
        let same = crypto::derive_key("4242", &kdf).unwrap();
        assert_eq!(crypto::decrypt_bytes(&wrapped, &same).unwrap(), vault_key);

        // Wrong PIN fails to unwrap.
        let wrong = crypto::derive_key("9999", &kdf).unwrap();
        assert!(crypto::decrypt_bytes(&wrapped, &wrong).is_err());
    }

    fn base64_salt() -> String {
        use base64::engine::general_purpose::STANDARD as B64;
        use base64::Engine;
        B64.encode(b"test-salt-32-bytes-long-padding!")
    }
}
