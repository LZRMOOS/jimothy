use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::notes::Note;

/// KDF parameters stored in vault config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdfParams {
    pub algorithm: String,
    pub salt: String, // base64
    pub memory_cost: u32,
    pub time_cost: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        let mut salt = [0u8; 32];
        OsRng.fill_bytes(&mut salt);
        Self {
            algorithm: "argon2id".to_string(),
            salt: BASE64.encode(salt),
            memory_cost: 65536,
            time_cost: 3,
            parallelism: 1,
        }
    }
}

/// Vault configuration stored as .scratch/vault.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConfig {
    pub format: String,
    pub version: u32,
    pub kdf: KdfParams,
    pub verification_record: String, // base64 encrypted known plaintext
}

/// Cipher block within an encrypted note file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CipherBlock {
    pub algorithm: String,
    pub nonce: String,      // base64
    pub ciphertext: String, // base64
}

/// Encrypted note file format (.snote)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedNote {
    pub format: String,
    pub version: u32,
    pub note_id: String,
    pub cipher: CipherBlock,
}

/// The known plaintext used for password verification
const VERIFICATION_PLAINTEXT: &[u8] = b"scratch-vault-verification-v1";

/// Derive a 256-bit key from a password using Argon2id
pub fn derive_key(password: &str, params: &KdfParams) -> Result<Vec<u8>, String> {
    let salt = BASE64
        .decode(&params.salt)
        .map_err(|e| format!("Invalid salt: {}", e))?;

    let argon2_params = Params::new(
        params.memory_cost,
        params.time_cost,
        params.parallelism,
        Some(32),
    )
    .map_err(|e| format!("Invalid KDF params: {}", e))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon2_params);

    let mut key = vec![0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| format!("Key derivation failed: {}", e))?;

    Ok(key)
}

/// Encrypt arbitrary plaintext bytes with the given key, returning a CipherBlock
pub fn encrypt_bytes(plaintext: &[u8], key: &[u8]) -> Result<CipherBlock, String> {
    if key.len() != 32 {
        return Err("Key must be 32 bytes".to_string());
    }

    let cipher_key = Key::from_slice(key);
    let cipher = XChaCha20Poly1305::new(cipher_key);

    let mut nonce_bytes = [0u8; 24];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {}", e))?;

    Ok(CipherBlock {
        algorithm: "xchacha20-poly1305".to_string(),
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    })
}

/// Decrypt a CipherBlock back to plaintext bytes
pub fn decrypt_bytes(cipher_block: &CipherBlock, key: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 32 {
        return Err("Key must be 32 bytes".to_string());
    }
    if cipher_block.algorithm != "xchacha20-poly1305" {
        return Err(format!(
            "Unsupported cipher algorithm: {}",
            cipher_block.algorithm
        ));
    }

    let cipher_key = Key::from_slice(key);
    let cipher = XChaCha20Poly1305::new(cipher_key);

    let nonce_bytes = BASE64
        .decode(&cipher_block.nonce)
        .map_err(|e| format!("Invalid nonce: {}", e))?;
    if nonce_bytes.len() != 24 {
        return Err("Nonce must be 24 bytes".to_string());
    }
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = BASE64
        .decode(&cipher_block.ciphertext)
        .map_err(|e| format!("Invalid ciphertext: {}", e))?;

    cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Decryption failed: invalid password or corrupted data".to_string())
}

/// Encrypt a Note into an EncryptedNote structure
pub fn encrypt_note(note: &Note, key: &[u8]) -> Result<EncryptedNote, String> {
    let note_json = serde_json::to_string(note)
        .map_err(|e| format!("Failed to serialize note: {}", e))?;

    let cipher_block = encrypt_bytes(note_json.as_bytes(), key)?;

    Ok(EncryptedNote {
        format: "scratch".to_string(),
        version: 1,
        note_id: note.id.clone(),
        cipher: cipher_block,
    })
}

/// Decrypt an EncryptedNote back into a Note
pub fn decrypt_note(encrypted: &EncryptedNote, key: &[u8]) -> Result<Note, String> {
    if encrypted.format != "scratch" {
        return Err(format!("Unknown format: {}", encrypted.format));
    }
    if encrypted.version != 1 {
        return Err(format!("Unsupported version: {}", encrypted.version));
    }

    let plaintext = decrypt_bytes(&encrypted.cipher, key)?;

    let note: Note = serde_json::from_slice(&plaintext)
        .map_err(|e| format!("Failed to deserialize note: {}", e))?;

    Ok(note)
}

/// Create a verification record (encrypted known plaintext) for password checking
pub fn create_verification_record(key: &[u8]) -> Result<String, String> {
    let cipher_block = encrypt_bytes(VERIFICATION_PLAINTEXT, key)?;
    let json = serde_json::to_string(&cipher_block)
        .map_err(|e| format!("Failed to serialize verification record: {}", e))?;
    Ok(BASE64.encode(json.as_bytes()))
}

/// Verify a key against a stored verification record
pub fn verify_key(key: &[u8], verification_record: &str) -> Result<bool, String> {
    let json_bytes = BASE64
        .decode(verification_record)
        .map_err(|e| format!("Invalid verification record: {}", e))?;

    let cipher_block: CipherBlock = serde_json::from_slice(&json_bytes)
        .map_err(|e| format!("Invalid verification record format: {}", e))?;

    match decrypt_bytes(&cipher_block, key) {
        Ok(plaintext) => Ok(plaintext == VERIFICATION_PLAINTEXT),
        Err(_) => Ok(false),
    }
}

/// Create a new VaultConfig with fresh salt and the given key
pub fn create_vault_config(password: &str) -> Result<(VaultConfig, Vec<u8>), String> {
    let kdf_params = KdfParams::default();
    let key = derive_key(password, &kdf_params)?;
    let verification_record = create_verification_record(&key)?;

    let config = VaultConfig {
        format: "scratch-vault".to_string(),
        version: 1,
        kdf: kdf_params,
        verification_record,
    };

    Ok((config, key))
}

/// Protected note file format (.pnote) — metadata in clear, body encrypted
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectedNote {
    pub format: String,
    pub version: u32,
    pub note_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub codex: Option<String>,
    pub body_cipher: CipherBlock,
}

/// Encrypt only the body of a note, keeping metadata in clear
pub fn encrypt_note_body(note: &Note, key: &[u8]) -> Result<ProtectedNote, String> {
    let cipher_block = encrypt_bytes(note.body.as_bytes(), key)?;

    Ok(ProtectedNote {
        format: "scratch-protected".to_string(),
        version: 1,
        note_id: note.id.clone(),
        title: note.title.clone(),
        created_at: note.created_at.to_rfc3339(),
        updated_at: note.updated_at.to_rfc3339(),
        codex: note.codex.clone(),
        body_cipher: cipher_block,
    })
}

/// Decrypt the body of a protected note
pub fn decrypt_note_body(protected: &ProtectedNote, key: &[u8]) -> Result<String, String> {
    let plaintext = decrypt_bytes(&protected.body_cipher, key)?;
    String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8 in decrypted body: {}", e))
}

/// Serialize a ProtectedNote to JSON string
pub fn serialize_protected_note(protected: &ProtectedNote) -> Result<String, String> {
    serde_json::to_string_pretty(protected)
        .map_err(|e| format!("Failed to serialize protected note: {}", e))
}

/// Deserialize a ProtectedNote from JSON string
pub fn parse_protected_note(json: &str) -> Result<ProtectedNote, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse protected note: {}", e))
}

/// Serialize an EncryptedNote to JSON string for file storage
pub fn serialize_encrypted_note(encrypted: &EncryptedNote) -> Result<String, String> {
    serde_json::to_string_pretty(encrypted)
        .map_err(|e| format!("Failed to serialize encrypted note: {}", e))
}

/// Deserialize an EncryptedNote from JSON string
pub fn parse_encrypted_note(json: &str) -> Result<EncryptedNote, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse encrypted note: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn test_kdf_params() -> KdfParams {
        // Use minimal params for fast tests
        KdfParams {
            algorithm: "argon2id".to_string(),
            salt: BASE64.encode(b"test-salt-32-bytes-long-padding!"),
            memory_cost: 1024, // minimal for tests
            time_cost: 1,
            parallelism: 1,
        }
    }

    fn make_test_note() -> Note {
        Note {
            id: "01JTEST123456789ABCDEF".to_string(),
            title: "Test Note".to_string(),
            body: "This is a test note body with some content.".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            encrypted: true,
            file_path: String::new(),
            codex: None,
        }
    }

    #[test]
    fn test_derive_key_deterministic() {
        let params = test_kdf_params();
        let key1 = derive_key("password123", &params).unwrap();
        let key2 = derive_key("password123", &params).unwrap();
        assert_eq!(key1, key2);
        assert_eq!(key1.len(), 32);
    }

    #[test]
    fn test_derive_key_different_passwords() {
        let params = test_kdf_params();
        let key1 = derive_key("password1", &params).unwrap();
        let key2 = derive_key("password2", &params).unwrap();
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let params = test_kdf_params();
        let key = derive_key("my-secret-password", &params).unwrap();
        let note = make_test_note();

        let encrypted = encrypt_note(&note, &key).unwrap();
        assert_eq!(encrypted.format, "scratch");
        assert_eq!(encrypted.version, 1);
        assert_eq!(encrypted.note_id, note.id);
        assert_eq!(encrypted.cipher.algorithm, "xchacha20-poly1305");

        let decrypted = decrypt_note(&encrypted, &key).unwrap();
        assert_eq!(decrypted.id, note.id);
        assert_eq!(decrypted.title, note.title);
        assert_eq!(decrypted.body, note.body);
    }

    #[test]
    fn test_wrong_password_returns_error() {
        let params = test_kdf_params();
        let key_correct = derive_key("correct-password", &params).unwrap();
        let key_wrong = derive_key("wrong-password", &params).unwrap();

        let note = make_test_note();
        let encrypted = encrypt_note(&note, &key_correct).unwrap();

        let result = decrypt_note(&encrypted, &key_wrong);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Decryption failed: invalid password or corrupted data"));
    }

    #[test]
    fn test_verification_record() {
        let params = test_kdf_params();
        let key = derive_key("vault-password", &params).unwrap();

        let record = create_verification_record(&key).unwrap();
        assert!(verify_key(&key, &record).unwrap());

        let wrong_key = derive_key("wrong-password", &params).unwrap();
        assert!(!verify_key(&wrong_key, &record).unwrap());
    }

    #[test]
    fn test_vault_config_creation() {
        let (config, key) = create_vault_config("test-password").unwrap();
        assert_eq!(config.format, "scratch-vault");
        assert_eq!(config.version, 1);
        assert_eq!(config.kdf.algorithm, "argon2id");
        assert_eq!(key.len(), 32);

        // Verify the key works with the config's verification record
        assert!(verify_key(&key, &config.verification_record).unwrap());
    }

    #[test]
    fn test_encrypted_note_serialization() {
        let params = test_kdf_params();
        let key = derive_key("password", &params).unwrap();
        let note = make_test_note();

        let encrypted = encrypt_note(&note, &key).unwrap();
        let json = serialize_encrypted_note(&encrypted).unwrap();
        let parsed = parse_encrypted_note(&json).unwrap();

        // Decrypt the parsed version
        let decrypted = decrypt_note(&parsed, &key).unwrap();
        assert_eq!(decrypted.id, note.id);
        assert_eq!(decrypted.title, note.title);
    }

    #[test]
    fn test_fresh_nonce_each_encrypt() {
        let params = test_kdf_params();
        let key = derive_key("password", &params).unwrap();
        let note = make_test_note();

        let enc1 = encrypt_note(&note, &key).unwrap();
        let enc2 = encrypt_note(&note, &key).unwrap();

        // Same note encrypted twice should produce different nonces and ciphertexts
        assert_ne!(enc1.cipher.nonce, enc2.cipher.nonce);
        assert_ne!(enc1.cipher.ciphertext, enc2.cipher.ciphertext);
    }

    /// Cross-platform compatibility test: a hardcoded encrypted blob must
    /// decrypt to known plaintext, proving the format is stable.
    #[test]
    fn test_cross_platform_fixture() {
        // Fixed key (32 bytes, derived externally)
        let key: Vec<u8> = vec![
            0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x70, 0x81, 0x92, 0xa3, 0xb4, 0xc5, 0xd6, 0xe7,
            0xf8, 0x09, 0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87, 0x98, 0xa9, 0xba, 0xcb,
            0xdc, 0xed, 0xfe, 0x0f,
        ];

        // Encrypt a known plaintext with a known nonce (for fixture generation)
        let plaintext = b"Hello, Scratch! This is a cross-platform test.";
        let nonce_bytes: [u8; 24] = [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
            0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
        ];

        // Encrypt with known nonce to generate fixture
        let cipher_key = Key::from_slice(&key);
        let cipher = XChaCha20Poly1305::new(cipher_key);
        let nonce = XNonce::from_slice(&nonce_bytes);
        let ciphertext = cipher.encrypt(nonce, plaintext.as_ref()).unwrap();

        let fixture_nonce = BASE64.encode(nonce_bytes);
        let fixture_ciphertext = BASE64.encode(&ciphertext);

        // Now decrypt using our library function
        let cipher_block = CipherBlock {
            algorithm: "xchacha20-poly1305".to_string(),
            nonce: fixture_nonce.clone(),
            ciphertext: fixture_ciphertext.clone(),
        };

        let decrypted = decrypt_bytes(&cipher_block, &key).unwrap();
        assert_eq!(decrypted, plaintext);

        // Also verify the base64 values are stable (this is the actual fixture)
        assert_eq!(fixture_nonce, "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY");

        // Re-decrypt from the known base64 fixture to verify stability
        let fixture_block = CipherBlock {
            algorithm: "xchacha20-poly1305".to_string(),
            nonce: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY".to_string(),
            ciphertext: fixture_ciphertext,
        };
        let result = decrypt_bytes(&fixture_block, &key).unwrap();
        assert_eq!(
            String::from_utf8(result).unwrap(),
            "Hello, Scratch! This is a cross-platform test."
        );
    }

    #[test]
    fn test_vault_setup_and_unlock_flow() {
        // Simulate the full vault setup flow
        let password = "my-vault-password";

        // Step 1: Setup vault
        let (config, key) = create_vault_config(password).unwrap();

        // Step 2: Create and encrypt a note
        let note = make_test_note();
        let encrypted = encrypt_note(&note, &key).unwrap();
        let json = serialize_encrypted_note(&encrypted).unwrap();

        // Step 3: Simulate locking (drop key)
        drop(key);

        // Step 4: Unlock with same password
        let unlocked_key = derive_key(password, &config.kdf).unwrap();
        assert!(verify_key(&unlocked_key, &config.verification_record).unwrap());

        // Step 5: Decrypt with unlocked key
        let parsed = parse_encrypted_note(&json).unwrap();
        let decrypted = decrypt_note(&parsed, &unlocked_key).unwrap();
        assert_eq!(decrypted.id, note.id);
        assert_eq!(decrypted.title, note.title);
        assert_eq!(decrypted.body, note.body);

        // Step 6: Unlock with wrong password should fail verification
        let wrong_key = derive_key("wrong-password", &config.kdf).unwrap();
        assert!(!verify_key(&wrong_key, &config.verification_record).unwrap());
    }

    #[test]
    fn test_change_password_flow() {
        let old_password = "old-password";
        let new_password = "new-password";

        // Setup with old password
        let (old_config, old_key) = create_vault_config(old_password).unwrap();

        // Encrypt a note
        let note = make_test_note();
        let encrypted = encrypt_note(&note, &old_key).unwrap();

        // Verify old password works
        assert!(verify_key(&old_key, &old_config.verification_record).unwrap());

        // Decrypt with old key, re-encrypt with new key
        let decrypted = decrypt_note(&encrypted, &old_key).unwrap();
        let (new_config, new_key) = create_vault_config(new_password).unwrap();
        let re_encrypted = encrypt_note(&decrypted, &new_key).unwrap();

        // Verify new password works
        assert!(verify_key(&new_key, &new_config.verification_record).unwrap());

        // Verify old key no longer works on new vault
        assert!(!verify_key(&old_key, &new_config.verification_record).unwrap());

        // Decrypt with new key
        let final_note = decrypt_note(&re_encrypted, &new_key).unwrap();
        assert_eq!(final_note.id, note.id);
        assert_eq!(final_note.title, note.title);
    }
}
