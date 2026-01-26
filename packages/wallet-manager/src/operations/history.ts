/**
 * Transaction history operations
 * Fetches and parses transaction history for wallets
 */

import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
  ConfirmedSignatureInfo,
} from '@solana/web3.js';
import type {
  Transaction,
  TransactionType,
  TransactionInstructionInfo,
  TokenTransfer,
  SolTransfer,
  WalletErrorCode,
} from '../types.js';
import { WalletManagerError } from '../types.js';

/**
 * Known program IDs for transaction type identification
 */
const KNOWN_PROGRAMS = {
  SYSTEM: '11111111111111111111111111111111',
  TOKEN: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  TOKEN_2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ASSOCIATED_TOKEN: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  JUPITER: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
  RAYDIUM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  ORCA: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
};

/**
 * Get transaction history for a wallet
 * @param connection - Solana connection
 * @param address - Wallet address
 * @param limit - Maximum number of transactions to fetch
 * @param before - Fetch transactions before this signature
 * @returns Array of parsed transactions
 */
export async function getTransactionHistory(
  connection: Connection,
  address: string,
  limit: number = 50,
  before?: string
): Promise<Transaction[]> {
  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(address);
  } catch {
    throw new WalletManagerError(
      'WALLET_NOT_FOUND' as WalletErrorCode,
      'Invalid wallet address'
    );
  }

  // Get signatures
  const signatures = await connection.getSignaturesForAddress(publicKey, {
    limit,
    before,
  });

  if (signatures.length === 0) {
    return [];
  }

  // Fetch full transaction data
  const transactions: Transaction[] = [];

  // Process in batches to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < signatures.length; i += batchSize) {
    const batch = signatures.slice(i, i + batchSize);
    const signatureBatch = batch.map((s: { signature: string }) => s.signature);

    const parsedTxs = await connection.getParsedTransactions(signatureBatch, {
      maxSupportedTransactionVersion: 0,
    });

    for (let j = 0; j < batch.length; j++) {
      const sig = batch[j];
      const parsedTx = parsedTxs[j];

      if (!sig || !parsedTx) {
        continue;
      }

      const tx = parseTransaction(sig, parsedTx, address);
      if (tx) {
        transactions.push(tx);
      }
    }
  }

  return transactions;
}

/**
 * Parse a transaction into our format
 */
function parseTransaction(
  sigInfo: ConfirmedSignatureInfo,
  parsedTx: ParsedTransactionWithMeta,
  walletAddress: string
): Transaction | null {
  try {
    const { meta, transaction, blockTime, slot } = parsedTx;

    if (!meta || !transaction) {
      return null;
    }

    // Extract instructions info
    const instructions: TransactionInstructionInfo[] = transaction.message.instructions.map(
      (ix: any) => ({
        programId: ix.programId?.toString() || 'unknown',
        data: ix.data || '',
        accounts: ix.accounts?.map((a: any) => a.toString()) || [],
      })
    );

    // Determine transaction type
    const type = determineTransactionType(instructions, meta);

    // Extract SOL transfers
    const solTransfers = extractSolTransfers(parsedTx, walletAddress);

    // Extract token transfers
    const tokenTransfers = extractTokenTransfers(parsedTx, walletAddress);

    return {
      signature: sigInfo.signature,
      slot,
      blockTime: blockTime || 0,
      type,
      fee: BigInt(meta.fee),
      success: meta.err === null,
      instructions,
      tokenTransfers,
      solTransfers,
    };
  } catch {
    return null;
  }
}

/**
 * Determine the type of transaction based on instructions
 */
function determineTransactionType(
  instructions: TransactionInstructionInfo[],
  meta: any
): TransactionType {
  const programIds = instructions.map(ix => ix.programId);

  // Check for swaps (Jupiter, Raydium, Orca)
  if (
    programIds.some(p =>
      [KNOWN_PROGRAMS.JUPITER, KNOWN_PROGRAMS.RAYDIUM, KNOWN_PROGRAMS.ORCA].includes(p)
    )
  ) {
    return 'swap';
  }

  // Check for token transfers
  if (
    programIds.includes(KNOWN_PROGRAMS.TOKEN) ||
    programIds.includes(KNOWN_PROGRAMS.TOKEN_2022)
  ) {
    // Check inner instructions for minting or burning
    if (meta?.innerInstructions) {
      for (const inner of meta.innerInstructions) {
        for (const ix of inner.instructions) {
          if (ix.parsed?.type === 'mint' || ix.parsed?.type === 'mintTo') {
            return 'mint';
          }
          if (ix.parsed?.type === 'burn') {
            return 'burn';
          }
        }
      }
    }
    return 'token_transfer';
  }

  // Check for account creation
  if (programIds.includes(KNOWN_PROGRAMS.ASSOCIATED_TOKEN)) {
    return 'create_account';
  }

  // Check for simple SOL transfer
  if (
    programIds.length === 1 &&
    programIds[0] === KNOWN_PROGRAMS.SYSTEM
  ) {
    return 'transfer';
  }

  return 'unknown';
}

/**
 * Extract SOL transfers from a transaction
 */
function extractSolTransfers(
  parsedTx: ParsedTransactionWithMeta,
  _walletAddress: string
): SolTransfer[] {
  const transfers: SolTransfer[] = [];
  const { meta, transaction } = parsedTx;

  if (!meta || !transaction) {
    return transfers;
  }

  const accountKeys = transaction.message.accountKeys.map((k: any) =>
    k.pubkey?.toString() || k.toString()
  );

  // Check pre and post balances
  if (meta.preBalances && meta.postBalances) {
    for (let i = 0; i < accountKeys.length; i++) {
      const preBalance = meta.preBalances[i] ?? 0;
      const postBalance = meta.postBalances[i] ?? 0;
      const diff = postBalance - preBalance;

      // Skip if no change or if this is the fee payer (first account)
      if (diff === 0) continue;

      const account = accountKeys[i];

      if (diff > 0 && account !== accountKeys[0]) {
        // Received SOL
        transfers.push({
          source: 'unknown', // Would need more parsing to determine
          destination: account,
          amount: BigInt(diff),
        });
      } else if (diff < 0 && i !== 0) {
        // Sent SOL (excluding fee)
        transfers.push({
          source: account,
          destination: 'unknown',
          amount: BigInt(-diff),
        });
      }
    }
  }

  return transfers;
}

/**
 * Extract token transfers from a transaction
 */
function extractTokenTransfers(
  parsedTx: ParsedTransactionWithMeta,
  _walletAddress: string
): TokenTransfer[] {
  const transfers: TokenTransfer[] = [];
  const { meta } = parsedTx;

  if (!meta?.preTokenBalances || !meta?.postTokenBalances) {
    return transfers;
  }

  // Create a map of account index to token info
  const preBalanceMap = new Map<number, { mint: string; amount: bigint; decimals: number }>();
  const postBalanceMap = new Map<number, { mint: string; amount: bigint; decimals: number }>();

  for (const balance of meta.preTokenBalances) {
    preBalanceMap.set(balance.accountIndex, {
      mint: balance.mint,
      amount: BigInt(balance.uiTokenAmount.amount),
      decimals: balance.uiTokenAmount.decimals,
    });
  }

  for (const balance of meta.postTokenBalances) {
    postBalanceMap.set(balance.accountIndex, {
      mint: balance.mint,
      amount: BigInt(balance.uiTokenAmount.amount),
      decimals: balance.uiTokenAmount.decimals,
    });
  }

  // Find differences
  const allIndices = new Set([...preBalanceMap.keys(), ...postBalanceMap.keys()]);

  for (const index of allIndices) {
    const pre = preBalanceMap.get(index);
    const post = postBalanceMap.get(index);

    if (!pre && post && post.amount > BigInt(0)) {
      // New token account with balance
      transfers.push({
        mint: post.mint,
        source: 'unknown',
        destination: 'unknown',
        amount: post.amount,
        decimals: post.decimals,
      });
    } else if (pre && post) {
      const diff = post.amount - pre.amount;
      if (diff !== BigInt(0)) {
        transfers.push({
          mint: pre.mint,
          source: diff < BigInt(0) ? 'self' : 'unknown',
          destination: diff > BigInt(0) ? 'self' : 'unknown',
          amount: diff > BigInt(0) ? diff : -diff,
          decimals: pre.decimals,
        });
      }
    }
  }

  return transfers;
}

/**
 * Get the latest transaction signature for a wallet
 * @param connection - Solana connection
 * @param address - Wallet address
 * @returns The latest signature or null
 */
export async function getLatestSignature(
  connection: Connection,
  address: string
): Promise<string | null> {
  const publicKey = new PublicKey(address);
  const signatures = await connection.getSignaturesForAddress(publicKey, { limit: 1 });
  return signatures[0]?.signature ?? null;
}

/**
 * Wait for a transaction to be confirmed
 * @param connection - Solana connection
 * @param signature - Transaction signature
 * @param commitment - Confirmation commitment level
 * @returns True if confirmed, false if failed
 */
export async function waitForConfirmation(
  connection: Connection,
  signature: string,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'
): Promise<boolean> {
  try {
    const result = await connection.confirmTransaction(signature, commitment);
    return result.value.err === null;
  } catch {
    return false;
  }
}
