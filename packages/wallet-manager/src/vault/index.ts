/**
 * Vault Module
 * Exports all vault functionality for secure key storage
 */

export {
  DEFAULT_ENCRYPTION_CONFIG,
  MIN_PASSWORD_LENGTH,
  validatePassword,
  deriveKey,
  encryptData,
  decryptData,
  generateRandomKey,
  secureCompare,
  clearSensitiveData,
} from './encryption.js';

export {
  keyVault,
  KeyVaultImpl,
} from './key-vault.js';

export {
  LocalHSMAdapter,
  AWSCloudHSMAdapter,
  AzureKeyVaultAdapter,
  HashiCorpVaultAdapter,
  createHSMAdapter,
} from './hsm-adapter.js';
