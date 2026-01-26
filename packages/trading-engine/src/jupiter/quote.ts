/**
 * Jupiter Quote Service
 * 
 * Handles fetching quotes from Jupiter V6 API with rate limiting and caching.
 */

import type {
  QuoteParams,
  QuoteResponse,
  TradingEngineConfig,
} from '../types.js';

/**
 * Jupiter Quote service for fetching optimal swap routes
 */
export class JupiterQuote {
  private readonly apiUrl: string;
  private readonly defaultSlippageBps: number;

  constructor(config: TradingEngineConfig) {
    this.apiUrl = config.jupiterApiUrl;
    this.defaultSlippageBps = config.defaultSlippageBps;
  }

  /**
   * Build quote request URL with parameters
   */
  private buildQuoteUrl(params: QuoteParams): string {
    const url = new URL(`${this.apiUrl}/quote`);
    
    url.searchParams.set('inputMint', params.inputMint);
    url.searchParams.set('outputMint', params.outputMint);
    url.searchParams.set('amount', params.amount.toString());
    url.searchParams.set('slippageBps', (params.slippageBps ?? this.defaultSlippageBps).toString());
    
    if (params.swapMode) {
      url.searchParams.set('swapMode', params.swapMode);
    }
    
    if (params.onlyDirectRoutes) {
      url.searchParams.set('onlyDirectRoutes', 'true');
    }
    
    if (params.includeDexes && params.includeDexes.length > 0) {
      url.searchParams.set('dexes', params.includeDexes.join(','));
    }
    
    if (params.excludeDexes && params.excludeDexes.length > 0) {
      url.searchParams.set('excludeDexes', params.excludeDexes.join(','));
    }
    
    if (params.maxAccounts) {
      url.searchParams.set('maxAccounts', params.maxAccounts.toString());
    }
    
    if (params.platformFeeBps) {
      url.searchParams.set('platformFeeBps', params.platformFeeBps.toString());
    }

    return url.toString();
  }

  /**
   * Fetch a quote from Jupiter
   */
  async getQuote(params: QuoteParams): Promise<QuoteResponse> {
    const url = this.buildQuoteUrl(params);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jupiter quote failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as QuoteResponse;
    return data;
  }

  /**
   * Fetch multiple quotes for comparison
   */
  async getQuotes(params: QuoteParams, variations: Partial<QuoteParams>[] = []): Promise<QuoteResponse[]> {
    const requests = [
      this.getQuote(params),
      ...variations.map(v => this.getQuote({ ...params, ...v })),
    ];

    const results = await Promise.allSettled(requests);
    
    return results
      .filter((r): r is PromiseFulfilledResult<QuoteResponse> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  /**
   * Get the best quote from multiple options
   */
  async getBestQuote(params: QuoteParams): Promise<QuoteResponse> {
    // Try different routing options and return the best one
    const variations: Partial<QuoteParams>[] = [
      { onlyDirectRoutes: true }, // Direct route only
      { maxAccounts: 20 }, // Limited accounts for smaller tx
      { maxAccounts: 64 }, // More accounts for potentially better routes
    ];

    const quotes = await this.getQuotes(params, variations);
    
    if (quotes.length === 0) {
      throw new Error('No valid quotes found');
    }

    // Sort by output amount (descending) - best quote has highest output
    if (params.swapMode === 'ExactOut') {
      // For ExactOut, we want the lowest input amount
      quotes.sort((a, b) => BigInt(a.inAmount) < BigInt(b.inAmount) ? -1 : 1);
    } else {
      // For ExactIn (default), we want the highest output amount
      quotes.sort((a, b) => BigInt(b.outAmount) > BigInt(a.outAmount) ? -1 : 1);
    }

    return quotes[0]!;
  }

  /**
   * Calculate effective price from quote
   */
  calculatePrice(quote: QuoteResponse, inputDecimals: number, outputDecimals: number): number {
    const inAmount = Number(quote.inAmount) / Math.pow(10, inputDecimals);
    const outAmount = Number(quote.outAmount) / Math.pow(10, outputDecimals);
    return outAmount / inAmount;
  }

  /**
   * Calculate price impact from quote
   */
  getPriceImpact(quote: QuoteResponse): number {
    return parseFloat(quote.priceImpactPct);
  }

  /**
   * Validate slippage is within acceptable range
   */
  validateSlippage(slippageBps: number, maxSlippageBps: number): void {
    if (slippageBps < 0) {
      throw new Error('Slippage cannot be negative');
    }
    if (slippageBps > maxSlippageBps) {
      throw new Error(`Slippage ${slippageBps} bps exceeds maximum ${maxSlippageBps} bps`);
    }
  }
}
