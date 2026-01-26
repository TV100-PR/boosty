/**
 * x402 Payment Service
 * Core payment verification and settlement using the x402 protocol
 */

import type {
  X402Config,
  PaymentVerification,
  PaymentSettlement,
  PaymentSession,
  ToolPaymentRequirements,
  PaymentRequiredResponse,
  PaymentRequirementsList,
  PaymentEvent,
  PaymentEventHandler,
  PaymentNetwork,
} from './types.js';
import { getToolPrice, parsePrice } from './config.js';
import { logger } from '../utils/logger.js';

// USDC token addresses per network
const USDC_ADDRESSES: Record<PaymentNetwork, { address: string; decimals: number; symbol: string }> = {
  'eip155:8453': {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base USDC
    decimals: 6,
    symbol: 'USDC',
  },
  'eip155:84532': {
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia USDC
    decimals: 6,
    symbol: 'USDC',
  },
  'eip155:1': {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum USDC
    decimals: 6,
    symbol: 'USDC',
  },
  'solana:mainnet': {
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Solana USDC
    decimals: 6,
    symbol: 'USDC',
  },
  'solana:devnet': {
    address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Solana Devnet USDC
    decimals: 6,
    symbol: 'USDC',
  },
};

/**
 * x402 Payment Service
 * Handles payment verification, settlement, and session management
 */
export class X402PaymentService {
  private config: X402Config;
  private sessions: Map<string, PaymentSession> = new Map();
  private eventHandlers: PaymentEventHandler[] = [];
  
  // Lazy-loaded x402 modules (to avoid import issues if not installed)
  private resourceServer: any = null;
  private facilitatorClient: any = null;
  private initialized: boolean = false;

  constructor(config: X402Config) {
    this.config = config;
    
    if (config.enabled) {
      logger.info({ 
        payTo: config.payToAddress,
        network: config.defaultNetwork,
        facilitator: config.facilitatorUrl,
      }, 'x402 Payment Service initialized');
    }
  }

  /**
   * Initialize x402 SDK (lazy loading)
   */
  private async initializeX402(): Promise<void> {
    if (this.initialized || !this.config.enabled) {
      return;
    }

    try {
      // Dynamic imports to handle missing packages gracefully
      const { x402ResourceServer, HTTPFacilitatorClient } = await import('@x402/core/server');
      const { ExactEvmScheme } = await import('@x402/evm/exact/server');

      // Create facilitator client
      this.facilitatorClient = new HTTPFacilitatorClient({
        url: this.config.facilitatorUrl || 'https://x402.org/facilitator',
      });

      // Create resource server with EVM support
      this.resourceServer = new x402ResourceServer(this.facilitatorClient);
      
      // Register EVM schemes for supported networks
      if (this.config.defaultNetwork.startsWith('eip155:')) {
        this.resourceServer.register(this.config.defaultNetwork, new ExactEvmScheme());
      }

      // Try to add Solana support if available
      try {
        const { ExactSvmScheme } = await import('@x402/svm/exact/server');
        if (this.config.defaultNetwork.startsWith('solana:')) {
          this.resourceServer.register(this.config.defaultNetwork, new ExactSvmScheme());
        }
      } catch {
        // Solana support not available
        logger.debug('Solana x402 support not available');
      }

      this.initialized = true;
      logger.info('x402 SDK initialized successfully');
    } catch (error) {
      logger.warn({ error }, 'x402 SDK not available - payments disabled');
      this.config.enabled = false;
    }
  }

  /**
   * Check if a tool requires payment
   */
  requiresPayment(toolName: string, category?: string): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const pricing = getToolPrice(this.config, toolName, category);
    return pricing.requiresPayment;
  }

  /**
   * Get payment requirements for a tool
   */
  getPaymentRequirements(
    toolName: string,
    category?: string,
    resourceUrl?: string
  ): ToolPaymentRequirements {
    const pricing = getToolPrice(this.config, toolName, category);

    return {
      tool: toolName,
      price: pricing.price,
      network: pricing.network,
      payTo: this.config.payToAddress,
      description: `Payment for ${toolName} tool`,
      resource: resourceUrl || `tool://${toolName}`,
    };
  }

  /**
   * Build HTTP 402 Payment Required response
   */
  buildPaymentRequiredResponse(
    toolName: string,
    category?: string,
    resourceUrl?: string
  ): PaymentRequiredResponse {
    const requirements = this.getPaymentRequirements(toolName, category, resourceUrl);
    const asset = USDC_ADDRESSES[requirements.network];
    const atomicAmount = parsePrice(
      typeof requirements.price === 'string' ? requirements.price : requirements.price.amount,
      asset.decimals
    );

    const accepts: PaymentRequirementsList[] = [{
      scheme: 'exact',
      network: requirements.network,
      maxAmountRequired: atomicAmount,
      resource: requirements.resource,
      description: requirements.description,
      mimeType: 'application/json',
      payTo: requirements.payTo,
      maxTimeoutSeconds: 300,
      asset,
    }];

    this.emitEvent({
      type: 'payment_required',
      tool: toolName,
      amount: atomicAmount,
      network: requirements.network,
      timestamp: new Date(),
    });

    return {
      x402Version: 2,
      error: 'Payment Required',
      accepts,
    };
  }

  /**
   * Verify a payment from the X-PAYMENT header
   */
  async verifyPayment(
    paymentHeader: string,
    toolName: string,
    category?: string
  ): Promise<PaymentVerification> {
    if (!this.config.enabled) {
      return { isValid: true };
    }

    await this.initializeX402();

    if (!this.resourceServer) {
      logger.warn('x402 not initialized, allowing request');
      return { isValid: true };
    }

    try {
      // Decode payment payload
      const paymentPayload = JSON.parse(
        Buffer.from(paymentHeader, 'base64').toString('utf-8')
      );

      // Get requirements for this tool
      const requirements = this.getPaymentRequirements(toolName, category);
      const asset = USDC_ADDRESSES[requirements.network];
      const atomicAmount = parsePrice(
        typeof requirements.price === 'string' ? requirements.price : requirements.price.amount,
        asset.decimals
      );

      // Build payment requirements for verification
      const paymentRequirements = {
        scheme: 'exact' as const,
        network: requirements.network,
        maxAmountRequired: atomicAmount,
        payTo: requirements.payTo,
        asset,
      };

      // Verify with x402
      const result = await this.resourceServer.verifyPayment(
        paymentPayload,
        paymentRequirements
      );

      if (result.isValid) {
        // Create session for settlement
        const session: PaymentSession = {
          sessionId: this.generateSessionId(),
          payer: result.payer || 'unknown',
          tool: toolName,
          amount: atomicAmount,
          network: requirements.network,
          verified: true,
          settled: false,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 300000), // 5 minutes
        };
        this.sessions.set(session.sessionId, session);

        this.emitEvent({
          type: 'payment_verified',
          tool: toolName,
          payer: result.payer,
          amount: atomicAmount,
          network: requirements.network,
          timestamp: new Date(),
        });

        return {
          isValid: true,
          payer: result.payer,
          amount: atomicAmount,
          network: requirements.network,
        };
      }

      this.emitEvent({
        type: 'payment_failed',
        tool: toolName,
        error: result.invalidReason,
        timestamp: new Date(),
      });

      return {
        isValid: false,
        invalidReason: result.invalidReason,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, toolName }, 'Payment verification failed');

      this.emitEvent({
        type: 'payment_failed',
        tool: toolName,
        error: errorMessage,
        timestamp: new Date(),
      });

      return {
        isValid: false,
        invalidReason: errorMessage,
      };
    }
  }

  /**
   * Settle a verified payment
   */
  async settlePayment(
    paymentHeader: string,
    toolName: string,
    category?: string
  ): Promise<PaymentSettlement> {
    if (!this.config.enabled) {
      return { success: true };
    }

    await this.initializeX402();

    if (!this.resourceServer) {
      return { success: true };
    }

    try {
      // Decode payment payload
      const paymentPayload = JSON.parse(
        Buffer.from(paymentHeader, 'base64').toString('utf-8')
      );

      // Get requirements
      const requirements = this.getPaymentRequirements(toolName, category);
      const asset = USDC_ADDRESSES[requirements.network];
      const atomicAmount = parsePrice(
        typeof requirements.price === 'string' ? requirements.price : requirements.price.amount,
        asset.decimals
      );

      const paymentRequirements = {
        scheme: 'exact' as const,
        network: requirements.network,
        maxAmountRequired: atomicAmount,
        payTo: requirements.payTo,
        asset,
      };

      // Settle with x402
      const result = await this.resourceServer.settlePayment(
        paymentPayload,
        paymentRequirements
      );

      if (result.success) {
        this.emitEvent({
          type: 'payment_settled',
          tool: toolName,
          amount: atomicAmount,
          network: requirements.network,
          timestamp: new Date(),
          metadata: { transactionHash: result.transaction },
        });

        return {
          success: true,
          transactionHash: result.transaction,
          settledAt: new Date(),
        };
      }

      return {
        success: false,
        error: result.errorMessage || 'Settlement failed',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, toolName }, 'Payment settlement failed');

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Add event handler for payment events
   */
  onEvent(handler: PaymentEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit payment event to all handlers
   */
  private emitEvent(event: PaymentEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        logger.error({ error }, 'Payment event handler error');
      }
    }
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `x402_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Clean up expired sessions
   */
  cleanupSessions(): void {
    const now = new Date();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Get payment statistics
   */
  getStats(): {
    enabled: boolean;
    activeSessions: number;
    network: PaymentNetwork;
    payTo: string;
  } {
    return {
      enabled: this.config.enabled,
      activeSessions: this.sessions.size,
      network: this.config.defaultNetwork,
      payTo: this.config.payToAddress,
    };
  }
}
