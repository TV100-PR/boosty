/**
 * Balance operations for Solana wallets
 * Fetches SOL and SPL token balances
 */

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  AccountLayout,
} from '@solana/spl-token';
import type {
  WalletBalance,
  TokenBalance,
  WalletErrorCode,
} from '../types.js';
import { WalletManagerError } from '../types.js';

/**
 * Token metadata cache (in production, fetch from token list or Metaplex)
 */
const tokenMetadataCache = new Map<string, { symbol: string; name: string; decimals: number }>();

/**
 * Get the balance of a wallet (SOL + all tokens)
 * @param connection - Solana connection
 * @param address - Wallet address
 * @param solPrice - Current SOL price in USD (optional)
 * @returns Complete wallet balance
 */
export async function getWalletBalance(
  connection: Connection,
  address: string,
  solPrice?: number
): Promise<WalletBalance> {
  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(address);
  } catch {
    throw new WalletManagerError(
      'WALLET_NOT_FOUND' as WalletErrorCode,
      'Invalid wallet address'
    );
  }

  // Get SOL balance
  const lamports = await connection.getBalance(publicKey);
  const sol = BigInt(lamports);
  const solAmount = lamports / LAMPORTS_PER_SOL;
  const solUsd = solPrice ? solAmount * solPrice : 0;

  // Get all token accounts
  const tokens = await getAllTokenBalances(connection, address);

  // Calculate total USD value
  const tokenValueUsd = tokens.reduce((sum, t) => sum + (t.usdValue || 0), 0);
  const totalValueUsd = solUsd + tokenValueUsd;

  return {
    sol,
    solUsd,
    tokens,
    totalValueUsd,
    lastUpdated: new Date(),
  };
}

/**
 * Get balances for multiple wallets
 * @param connection - Solana connection
 * @param addresses - Array of wallet addresses
 * @param solPrice - Current SOL price in USD (optional)
 * @returns Map of address to balance
 */
export async function getWalletBalances(
  connection: Connection,
  addresses: string[],
  solPrice?: number
): Promise<Map<string, WalletBalance>> {
  const balances = new Map<string, WalletBalance>();

  // Batch fetch SOL balances
  const publicKeys = addresses.map(addr => {
    try {
      return new PublicKey(addr);
    } catch {
      return null;
    }
  });

  const validAddresses: string[] = [];
  const validPublicKeys: PublicKey[] = [];

  publicKeys.forEach((pk, i) => {
    const addr = addresses[i];
    if (pk && addr) {
      validAddresses.push(addr);
      validPublicKeys.push(pk);
    }
  });

  // Use getMultipleAccountsInfo for batch fetching
  const accountInfos = await connection.getMultipleAccountsInfo(validPublicKeys);

  // Process each account
  const promises = validAddresses.map(async (address, i) => {
    const accountInfo = accountInfos[i];
    const lamports = accountInfo?.lamports ?? 0;
    const sol = BigInt(lamports);
    const solAmount = lamports / LAMPORTS_PER_SOL;
    const solUsd = solPrice ? solAmount * solPrice : 0;

    // Get token balances (this could be optimized further with batch RPC)
    const tokens = await getAllTokenBalances(connection, address);

    const tokenValueUsd = tokens.reduce((sum, t) => sum + (t.usdValue || 0), 0);
    const totalValueUsd = solUsd + tokenValueUsd;

    const balance: WalletBalance = {
      sol,
      solUsd,
      tokens,
      totalValueUsd,
      lastUpdated: new Date(),
    };

    balances.set(address, balance);
  });

  await Promise.all(promises);

  return balances;
}

/**
 * Get all token balances for a wallet
 * @param connection - Solana connection
 * @param address - Wallet address
 * @returns Array of token balances
 */
export async function getAllTokenBalances(
  connection: Connection,
  address: string
): Promise<TokenBalance[]> {
  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(address);
  } catch {
    return [];
  }

  // Get all token accounts for this owner
  const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
    programId: TOKEN_PROGRAM_ID,
  });

  const balances: TokenBalance[] = [];

  for (const { account, pubkey } of tokenAccounts.value) {
    const accountData = AccountLayout.decode(account.data);
    const mint = new PublicKey(accountData.mint).toString();
    const amount = BigInt(accountData.amount.toString());

    // Skip zero balances
    if (amount === BigInt(0)) {
      continue;
    }

    // Get token metadata (from cache or fetch)
    const metadata = await getTokenMetadata(connection, mint);

    const balance: TokenBalance = {
      mint,
      symbol: metadata.symbol,
      name: metadata.name,
      amount,
      decimals: metadata.decimals,
      uiAmount: Number(amount) / Math.pow(10, metadata.decimals),
      tokenAccount: pubkey.toString(),
    };

    balances.push(balance);
  }

  return balances;
}

/**
 * Get a specific token balance
 * @param connection - Solana connection
 * @param address - Wallet address
 * @param tokenMint - Token mint address
 * @returns Token balance or null if not found
 */
export async function getTokenBalance(
  connection: Connection,
  address: string,
  tokenMint: string
): Promise<TokenBalance | null> {
  const balances = await getAllTokenBalances(connection, address);
  return balances.find(b => b.mint === tokenMint) || null;
}

/**
 * Get token metadata
 * @param connection - Solana connection
 * @param mint - Token mint address
 * @returns Token metadata
 */
async function getTokenMetadata(
  connection: Connection,
  mint: string
): Promise<{ symbol: string; name: string; decimals: number }> {
  // Check cache first
  if (tokenMetadataCache.has(mint)) {
    return tokenMetadataCache.get(mint)!;
  }

  try {
    // Fetch mint info to get decimals
    const mintPubkey = new PublicKey(mint);
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey);

    let decimals = 9; // Default for SPL tokens

    if (mintInfo.value?.data && 'parsed' in mintInfo.value.data) {
      decimals = mintInfo.value.data.parsed.info.decimals ?? 9;
    }

    // In production, fetch from token list or Metaplex
    const metadata = {
      symbol: shortenAddress(mint),
      name: `Token ${shortenAddress(mint)}`,
      decimals,
    };

    tokenMetadataCache.set(mint, metadata);
    return metadata;
  } catch {
    // Return defaults on error
    const metadata = {
      symbol: shortenAddress(mint),
      name: `Token ${shortenAddress(mint)}`,
      decimals: 9,
    };
    return metadata;
  }
}

/**
 * Shorten an address for display
 */
function shortenAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Set token metadata manually (useful for known tokens)
 * @param mint - Token mint address
 * @param metadata - Token metadata
 */
export function setTokenMetadata(
  mint: string,
  metadata: { symbol: string; name: string; decimals: number }
): void {
  tokenMetadataCache.set(mint, metadata);
}

/**
 * Clear the token metadata cache
 */
export function clearTokenMetadataCache(): void {
  tokenMetadataCache.clear();
}
