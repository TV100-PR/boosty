/**
 * Jupiter Aggregator Integration
 * Real-time swap quotes and route finding via Jupiter API
 */

import { PublicKey, VersionedTransaction, Connection } from '@solana/web3.js';
import { logger } from '../utils/logger.js';

const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';
const JUPITER_PRICE_API_URL = 'https://price.jup.ag/v6';

// Well-known token mints
export const TOKEN_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  ORCA: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  MSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  JITOSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  PYTH: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  RENDER: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',
  HNT: 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',
} as const;

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
  otherAmountThreshold: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  priceImpactPct: number;
  routePlan: RoutePlan[];
  contextSlot: number;
  timeTaken: number;
}

export interface RoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface TokenPrice {
  id: string;
  mintSymbol: string;
  vsToken: string;
  vsTokenSymbol: string;
  price: number;
  confidence?: number;
}

export interface SwapParams {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps?: number;
  swapMode?: 'ExactIn' | 'ExactOut';
  userPublicKey: PublicKey;
  onlyDirectRoutes?: boolean;
  asLegacyTransaction?: boolean;
  maxAccounts?: number;
}

export class JupiterClient {
  private readonly apiUrl: string;
  private readonly priceApiUrl: string;
  private priceCache: Map<string, { price: TokenPrice; timestamp: number }> = new Map();
  private readonly cacheTtlMs: number = 10000; // 10 seconds

  constructor(apiUrl?: string, priceApiUrl?: string) {
    this.apiUrl = apiUrl || JUPITER_API_URL;
    this.priceApiUrl = priceApiUrl || JUPITER_PRICE_API_URL;
    
    logger.info('Jupiter client initialized');
  }

  /**
   * Get swap quote from Jupiter
   */
  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps?: number;
    swapMode?: 'ExactIn' | 'ExactOut';
    onlyDirectRoutes?: boolean;
    maxAccounts?: number;
  }): Promise<SwapQuote> {
    const queryParams = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: String(params.slippageBps || 50),
      swapMode: params.swapMode || 'ExactIn',
    });

    if (params.onlyDirectRoutes) {
      queryParams.set('onlyDirectRoutes', 'true');
    }
    if (params.maxAccounts) {
      queryParams.set('maxAccounts', String(params.maxAccounts));
    }

    const response = await fetch(`${this.apiUrl}/quote?${queryParams}`);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter quote failed: ${error}`);
    }

    const quote = await response.json() as SwapQuote;
    
    logger.debug('Jupiter quote received', {
      inputMint: params.inputMint.slice(0, 8),
      outputMint: params.outputMint.slice(0, 8),
      inputAmount: params.amount,
      outputAmount: quote.outputAmount,
      priceImpact: quote.priceImpactPct,
    });

    return quote;
  }

  /**
   * Get swap transaction from Jupiter
   */
  async getSwapTransaction(
    quote: SwapQuote,
    userPublicKey: PublicKey,
    options?: {
      wrapAndUnwrapSol?: boolean;
      computeUnitPriceMicroLamports?: number;
      asLegacyTransaction?: boolean;
      dynamicComputeUnitLimit?: boolean;
    }
  ): Promise<VersionedTransaction> {
    const response = await fetch(`${this.apiUrl}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: userPublicKey.toBase58(),
        wrapAndUnwrapSol: options?.wrapAndUnwrapSol ?? true,
        computeUnitPriceMicroLamports: options?.computeUnitPriceMicroLamports,
        asLegacyTransaction: options?.asLegacyTransaction ?? false,
        dynamicComputeUnitLimit: options?.dynamicComputeUnitLimit ?? true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter swap transaction failed: ${error}`);
    }

    const { swapTransaction } = await response.json() as { swapTransaction: string };
    
    // Decode the transaction
    const transactionBuffer = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuffer);

    return transaction;
  }

  /**
   * Get token price from Jupiter
   */
  async getPrice(mintAddress: string, vsToken: string = TOKEN_MINTS.USDC): Promise<TokenPrice | null> {
    const cacheKey = `${mintAddress}-${vsToken}`;
    const cached = this.priceCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.price;
    }

    try {
      const response = await fetch(
        `${this.priceApiUrl}/price?ids=${mintAddress}&vsToken=${vsToken}`
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as { data: Record<string, TokenPrice> };
      const price = data.data[mintAddress];

      if (price) {
        this.priceCache.set(cacheKey, { price, timestamp: Date.now() });
      }

      return price || null;
    } catch (error) {
      logger.debug('Failed to get Jupiter price', { mintAddress, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Get prices for multiple tokens
   */
  async getPrices(mintAddresses: string[], vsToken: string = TOKEN_MINTS.USDC): Promise<Map<string, TokenPrice>> {
    const results = new Map<string, TokenPrice>();
    const toFetch: string[] = [];

    // Check cache first
    for (const mint of mintAddresses) {
      const cacheKey = `${mint}-${vsToken}`;
      const cached = this.priceCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
        results.set(mint, cached.price);
      } else {
        toFetch.push(mint);
      }
    }

    if (toFetch.length === 0) {
      return results;
    }

    try {
      const response = await fetch(
        `${this.priceApiUrl}/price?ids=${toFetch.join(',')}&vsToken=${vsToken}`
      );

      if (response.ok) {
        const data = await response.json() as { data: Record<string, TokenPrice> };
        
        for (const [mint, price] of Object.entries(data.data)) {
          if (price) {
            results.set(mint, price);
            this.priceCache.set(`${mint}-${vsToken}`, { price, timestamp: Date.now() });
          }
        }
      }
    } catch (error) {
      logger.debug('Failed to get Jupiter prices', { error: (error as Error).message });
    }

    return results;
  }

  /**
   * Resolve token symbol to mint address
   */
  resolveTokenMint(symbolOrMint: string): string {
    const upperSymbol = symbolOrMint.toUpperCase();
    
    // Check if it's a known symbol
    if (upperSymbol in TOKEN_MINTS) {
      return TOKEN_MINTS[upperSymbol as keyof typeof TOKEN_MINTS];
    }
    
    // Assume it's already a mint address
    return symbolOrMint;
  }

  /**
   * Get a simple swap quote with human-readable amounts
   */
  async getSimpleQuote(params: {
    inputToken: string;
    outputToken: string;
    amount: number;
    inputDecimals?: number;
    slippageBps?: number;
  }): Promise<{
    inputAmount: number;
    outputAmount: number;
    priceImpactPct: number;
    route: string[];
    minimumReceived: number;
  }> {
    const inputMint = this.resolveTokenMint(params.inputToken);
    const outputMint = this.resolveTokenMint(params.outputToken);
    const decimals = params.inputDecimals || 9;
    
    const amountRaw = BigInt(Math.floor(params.amount * Math.pow(10, decimals)));
    
    const quote = await this.getQuote({
      inputMint,
      outputMint,
      amount: amountRaw.toString(),
      slippageBps: params.slippageBps,
    });

    // Get output decimals from route
    const outputDecimals = 9; // Default, ideally fetch from token metadata

    const outputAmount = Number(quote.outputAmount) / Math.pow(10, outputDecimals);
    const minimumReceived = Number(quote.otherAmountThreshold) / Math.pow(10, outputDecimals);

    return {
      inputAmount: params.amount,
      outputAmount,
      priceImpactPct: quote.priceImpactPct,
      route: quote.routePlan.map(r => r.swapInfo.label),
      minimumReceived,
    };
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.priceCache.clear();
  }
}

/**
 * Create Jupiter client
 */
export function createJupiterClient(): JupiterClient {
  return new JupiterClient();
}
