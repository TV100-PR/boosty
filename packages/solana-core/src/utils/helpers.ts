/**
 * Utility Functions
 */

import { PublicKey } from '@solana/web3.js';

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isValidPublicKey(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export function shortenAddress(address: string | PublicKey, chars = 4): string {
  const str = address.toString();
  return `${str.slice(0, chars)}...${str.slice(-chars)}`;
}

export function lamportsToSol(lamports: number | bigint): number {
  return Number(lamports) / 1e9;
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * 1e9));
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;
  const paddedFractional = fractionalPart.toString().padStart(decimals, '0');
  return `${integerPart}.${paddedFractional}`.replace(/\.?0+$/, '');
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  const [intPart, decPart = ''] = amount.split('.');
  const paddedDecimal = decPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(intPart + paddedDecimal);
}

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }
  
  throw lastError!;
}

export function nowMs(): number {
  return Date.now();
}

export function msSince(startMs: number): number {
  return Date.now() - startMs;
}
// ============================================================================
// Rent Calculation Utilities
// ============================================================================

/**
 * Account size constants in bytes
 */
export const ACCOUNT_SIZES = {
  /** Standard SPL Token account */
  TOKEN_ACCOUNT: 165,
  /** Token-2022 base account (without extensions) */
  TOKEN_2022_ACCOUNT: 165,
  /** Mint account */
  MINT_ACCOUNT: 82,
  /** Multisig account */
  MULTISIG_ACCOUNT: 355,
  /** Metadata account (approximate) */
  METADATA_ACCOUNT: 679,
  /** Master Edition account */
  MASTER_EDITION_ACCOUNT: 282,
} as const;

/**
 * Get estimated rent exemption for common account types
 * Note: Use connection.getMinimumBalanceForRentExemption for precise values
 * These are estimates based on typical rent rates
 */
export function estimateRentExemption(dataSize: number): number {
  // Rent is approximately 0.00089088 SOL per byte per epoch (2 days)
  // Rent exemption requires ~2 years worth of rent
  const LAMPORTS_PER_BYTE_YEAR = 6960;
  const EXEMPTION_YEARS = 2;
  return dataSize * LAMPORTS_PER_BYTE_YEAR * EXEMPTION_YEARS;
}

/**
 * Get rent exemption for a token account
 */
export function estimateTokenAccountRent(): number {
  return estimateRentExemption(ACCOUNT_SIZES.TOKEN_ACCOUNT);
}

/**
 * Get rent exemption for a mint account
 */
export function estimateMintRent(): number {
  return estimateRentExemption(ACCOUNT_SIZES.MINT_ACCOUNT);
}