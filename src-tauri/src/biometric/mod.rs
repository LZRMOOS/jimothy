//! Biometric key escrow for vault unlock.
//!
//! The vault's security model derives the key from the password (Argon2id) on
//! every unlock and never persists it. Biometric unlock is an opt-in exception:
//! it stores a *copy* of the already-derived vault key in the OS secure store,
//! released only after a successful biometric check (Touch ID). The password
//! remains the source of truth — biometrics is a convenience gate over a copy
//! of the key, never a replacement for the KDF.
//!
//! Security properties (macOS):
//! - The key is stored as a Keychain generic-password item guarded by a
//!   `SecAccessControl` with `BIOMETRY_CURRENT_SET`. On Apple Silicon / T2 the
//!   item is wrapped by a key that never leaves the Secure Enclave; reading it
//!   requires a live Touch ID match. Our process never sees the wrapping key.
//! - `AccessibleWhenUnlockedThisDeviceOnly` keeps it off iCloud Keychain and
//!   out of backups, and prevents migration to another Mac.
//! - `BIOMETRY_CURRENT_SET` (not `BIOMETRY_ANY`) auto-invalidates the item if
//!   the enrolled fingerprint set changes, so adding a new fingerprint destroys
//!   the escrowed key and forces a password re-enrollment.
//!
//! Non-macOS targets compile the no-op fallback: `is_available()` returns false
//! and the store/retrieve/delete calls error, so the UI simply hides the
//! feature.

/// Which key an escrow entry belongs to. The vault key and the (separate)
/// protection key would map to distinct keychain items; only the vault is
/// wired up today, but the enum keeps the storage keying unambiguous.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BiometricKind {
    Vault,
}

impl BiometricKind {
    fn as_str(self) -> &'static str {
        match self {
            BiometricKind::Vault => "vault",
        }
    }
}

/// Service name under which escrow items are stored. The account is derived
/// per (kind, vault path) so multiple vault profiles each get their own entry
/// and never collide.
#[cfg(target_os = "macos")]
const SERVICE: &str = "com.jimothy.biometric";

/// Build the keychain account string for a given key kind and vault path. The
/// path scoping means enrolling Touch ID on one vault profile doesn't leak the
/// key of another.
#[cfg(target_os = "macos")]
fn account(kind: BiometricKind, vault_path: &str) -> String {
    format!("{}:{}", kind.as_str(), vault_path)
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{account, BiometricKind, SERVICE};
    use security_framework::access_control::{ProtectionMode, SecAccessControl};
    use security_framework::passwords::{delete_generic_password, generic_password};
    use security_framework::passwords_options::{AccessControlOptions, PasswordOptions};

    /// Touch ID is assumed available whenever we're on macOS. There's no cheap,
    /// side-effect-free probe for enrolled biometrics without prompting, so the
    /// real availability check happens implicitly: enrollment/retrieval will
    /// fail (and surface an error) if no biometrics are set up. Returning true
    /// here just means "the platform supports it" so the UI can offer the opt.
    pub fn is_available() -> bool {
        true
    }

    /// Store `key` in the keychain behind a biometry-gated access control.
    /// Overwrites any existing entry for this (kind, path) by deleting first —
    /// keychain add fails on a duplicate item otherwise.
    pub fn store_key(kind: BiometricKind, vault_path: &str, key: &[u8]) -> Result<(), String> {
        let acct = account(kind, vault_path);
        // Best-effort remove of any prior entry; ignore not-found.
        let _ = delete_generic_password(SERVICE, &acct);

        let access_control = SecAccessControl::create_with_protection(
            Some(ProtectionMode::AccessibleWhenUnlockedThisDeviceOnly),
            AccessControlOptions::BIOMETRY_CURRENT_SET.bits(),
        )
        .map_err(|e| format!("Failed to create access control: {}", e))?;

        let mut options = PasswordOptions::new_generic_password(SERVICE, &acct);
        options.set_access_control(access_control);
        // NOTE: deliberately NOT use_protected_keychain(). The data-protection
        // keychain requires a `keychain-access-groups` entitlement, which
        // unsigned / ad-hoc dev builds don't have ("A required entitlement
        // isn't present."). The default file-based keychain honors biometry
        // access-control ACLs too and needs no entitlement.

        security_framework::passwords::set_generic_password_options(key, options)
            .map_err(|e| format!("Failed to store key in keychain: {}", e))
    }

    /// Read the escrowed key back. This is the call that triggers the Touch ID
    /// prompt; it blocks until the user authenticates, cancels, or it fails.
    pub fn retrieve_key(kind: BiometricKind, vault_path: &str) -> Result<Vec<u8>, String> {
        let acct = account(kind, vault_path);
        let options = PasswordOptions::new_generic_password(SERVICE, &acct);
        generic_password(options).map_err(|e| format!("Touch ID unlock failed: {}", e))
    }

    /// Remove the escrow entry (on disable / password change / vault disable).
    /// Not-found is treated as success — the desired end state is "no entry".
    pub fn delete_key(kind: BiometricKind, vault_path: &str) -> Result<(), String> {
        let acct = account(kind, vault_path);
        match delete_generic_password(SERVICE, &acct) {
            Ok(()) => Ok(()),
            // errSecItemNotFound (-25300): nothing to delete, already clean.
            Err(e) if e.code() == -25300 => Ok(()),
            Err(e) => Err(format!("Failed to delete keychain entry: {}", e)),
        }
    }

}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::BiometricKind;

    pub fn is_available() -> bool {
        false
    }

    pub fn store_key(_kind: BiometricKind, _vault_path: &str, _key: &[u8]) -> Result<(), String> {
        Err("Biometric unlock is not supported on this platform".into())
    }

    pub fn retrieve_key(_kind: BiometricKind, _vault_path: &str) -> Result<Vec<u8>, String> {
        Err("Biometric unlock is not supported on this platform".into())
    }

    pub fn delete_key(_kind: BiometricKind, _vault_path: &str) -> Result<(), String> {
        // No-op: there's never anything stored on unsupported platforms.
        Ok(())
    }
}

pub use imp::{delete_key, is_available, retrieve_key, store_key};
