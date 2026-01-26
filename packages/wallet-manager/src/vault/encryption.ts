/**
 * Encryption utilities for secure key storage
 * Uses AES-256-GCM with scrypt key derivation
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from 'crypto';
import { promisify } from 'util';
import type { EncryptionConfig, WalletErrorCode } from '../types.js';
import { WalletManagerError } from '../types.js';

const scryptAsync = promisify(scrypt);

/**
 * Default encryption configuration
 * Following OWASP recommendations for secure key derivation
 */
export const DEFAULT_ENCRYPTION_CONFIG: EncryptionConfig = {
  algorithm: 'aes-256-gcm',
  keyLength: 32,
  saltLength: 32,
  ivLength: 16,
  tagLength: 16,
  scryptN: 16384, // CPU/memory cost parameter
  scryptR: 8,      // Block size
  scryptP: 1,      // Parallelization
};

/**
 * Minimum password length requirement
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Validate password strength
 * @param password - The password to validate
 * @throws WalletManagerError if password is too weak
 */
export function validatePassword(password: string): void {
  if (!password || typeof password !== 'string') {
    throw new WalletManagerError(
      'PASSWORD_TOO_WEAK' as WalletErrorCode,
      'Password is required'
    );
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WalletManagerError(
      'PASSWORD_TOO_WEAK' as WalletErrorCode,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`
    );
  }

  // Check for at least one uppercase, lowercase, number, and special character
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

  if (!hasUppercase || !hasLowercase || !hasNumber || !hasSpecial) {
    throw new WalletManagerError(
      'PASSWORD_TOO_WEAK' as WalletErrorCode,
      'Password must contain uppercase, lowercase, number, and special character'
    );
  }
}

/**
 * Derive an encryption key from a password using scrypt
 * @param password - The password
 * @param salt - The salt buffer
 * @param config - Encryption configuration
 * @returns The derived key buffer
 */
export async function deriveKey(
  password: string,
  salt: Buffer,
  config: EncryptionConfig = DEFAULT_ENCRYPTION_CONFIG
): Promise<Buffer> {
  const derivedKey = await scryptAsync(password, salt, config.keyLength) as Buffer;

  return derivedKey;
}

/**
 * Encrypt data using AES-256-GCM
 * @param data - The data to encrypt
 * @param password - The password for encryption
 * @param config - Optional encryption configuration
 * @returns The encrypted data as a base64 string
 */
export async function encryptData(
  data: Uint8Array,
  password: string,
  config: EncryptionConfig = DEFAULT_ENCRYPTION_CONFIG
): Promise<string> {
  validatePassword(password);

  // Generate random salt and IV
  const salt = randomBytes(config.saltLength);
  const iv = randomBytes(config.ivLength);

  // Derive encryption key
  const derivedKey = await deriveKey(password, salt, config);

  // Create cipher and encrypt
  const cipher = createCipheriv(config.algorithm, derivedKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(data)),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Combine: salt + iv + authTag + encrypted
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);

  return combined.toString('base64');
}

/**
 * Decrypt data using AES-256-GCM
 * @param encryptedData - The encrypted data as a base64 string
 * @param password - The password for decryption
 * @param config - Optional encryption configuration
 * @returns The decrypted data as Uint8Array
 */
export async function decryptData(
  encryptedData: string,
  password: string,
  config: EncryptionConfig = DEFAULT_ENCRYPTION_CONFIG
): Promise<Uint8Array> {
  try {
    const combined = Buffer.from(encryptedData, 'base64');

    // Minimum length check
    const minLength = config.saltLength + config.ivLength + config.tagLength + 1;
    if (combined.length < minLength) {
      throw new WalletManagerError(
        'DECRYPTION_FAILED' as WalletErrorCode,
        'Invalid encrypted data format'
      );
    }

    // Extract components
    let offset = 0;
    const salt = combined.subarray(offset, offset + config.saltLength);
    offset += config.saltLength;
    const iv = combined.subarray(offset, offset + config.ivLength);
    offset += config.ivLength;
    const authTag = combined.subarray(offset, offset + config.tagLength);
    offset += config.tagLength;
    const encrypted = combined.subarray(offset);

    // Derive key
    const derivedKey = await deriveKey(password, salt, config);

    // Create decipher and decrypt
    const decipher = createDecipheriv(config.algorithm, derivedKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return new Uint8Array(decrypted);
  } catch (error) {
    if (error instanceof WalletManagerError) {
      throw error;
    }
    throw new WalletManagerError(
      'DECRYPTION_FAILED' as WalletErrorCode,
      'Failed to decrypt data. Check your password.'
    );
  }
}

/**
 * Generate a random encryption key
 * @returns A random 32-byte key as Uint8Array
 */
export function generateRandomKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

/**
 * Securely compare two buffers (constant-time comparison)
 * @param a - First buffer
 * @param b - Second buffer
 * @returns True if equal
 */
export function secureCompare(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return result === 0;
}

/**
 * Clear sensitive data from memory (best effort in JavaScript)
 * @param data - The data to clear
 */
export function clearSensitiveData(data: Uint8Array | Buffer): void {
  if (data instanceof Buffer) {
    data.fill(0);
  } else if (data instanceof Uint8Array) {
    data.fill(0);
  }
}
