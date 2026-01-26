/**
 * Solana MCP Server
 * Model Context Protocol server for Solana DeFi operations
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  ConnectionManager,
  createConnectionManager,
  createPythOracle,
  createSwitchboardOracle,
  getTokenAccount,
  getTokenMint,
  getTokenAccountsByOwner,
  getTokenMetadataWithFallback,
  getAllATAs,
  lamportsToSol,
  isValidPublicKey,
  PythOracle,
  SwitchboardOracle,
} from './index.js';
import { logger } from './utils/logger.js';

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS: Tool[] = [
  {
    name: 'getSolanaBalance',
    description: 'Get SOL balance for a Solana wallet address',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Solana wallet address (base58)',
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'getSolanaTokens',
    description: 'Get all token holdings for a Solana wallet including metadata',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Solana wallet address (base58)',
        },
        includeToken2022: {
          type: 'boolean',
          description: 'Include Token-2022 program tokens',
          default: true,
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'getTokenPrice',
    description: 'Get real-time token price from Pyth oracle',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Price pair symbol (e.g., SOL/USD, BTC/USD, ETH/USD)',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'getMultipleTokenPrices',
    description: 'Get prices for multiple tokens at once',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of price pair symbols',
        },
      },
      required: ['symbols'],
    },
  },
  {
    name: 'getTokenMetadata',
    description: 'Get metadata for a Solana token (name, symbol, image, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        mint: {
          type: 'string',
          description: 'Token mint address',
        },
      },
      required: ['mint'],
    },
  },
  {
    name: 'getTokenMintInfo',
    description: 'Get token mint information (supply, decimals, authorities)',
    inputSchema: {
      type: 'object',
      properties: {
        mint: {
          type: 'string',
          description: 'Token mint address',
        },
      },
      required: ['mint'],
    },
  },
  {
    name: 'getCurrentSlot',
    description: 'Get the current Solana slot number',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'getTransaction',
    description: 'Get details of a Solana transaction by signature',
    inputSchema: {
      type: 'object',
      properties: {
        signature: {
          type: 'string',
          description: 'Transaction signature',
        },
      },
      required: ['signature'],
    },
  },
  {
    name: 'getRecentTransactions',
    description: 'Get recent transactions for a Solana address',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Solana wallet address',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of transactions to return',
          default: 10,
        },
      },
      required: ['address'],
    },
  },
  {
    name: 'estimatePriorityFee',
    description: 'Estimate priority fee for a transaction involving specific accounts',
    inputSchema: {
      type: 'object',
      properties: {
        accounts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of account addresses involved in the transaction',
        },
      },
      required: ['accounts'],
    },
  },
  {
    name: 'getRpcHealth',
    description: 'Get health status of all RPC endpoints',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'getAvailablePriceFeeds',
    description: 'Get list of available price feeds from oracles',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['pyth', 'switchboard', 'all'],
          default: 'all',
        },
      },
    },
  },
];

// ============================================================================
// Server Implementation
// ============================================================================

export class SolanaMCPServer {
  private server: Server;
  private connectionManager: ConnectionManager;
  private pythOracle: PythOracle;
  private switchboardOracle: SwitchboardOracle;

  constructor() {
    this.server = new Server(
      {
        name: '@defi-mcp/solana-core',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize connection manager
    this.connectionManager = createConnectionManager();
    
    // Initialize oracles
    const connection = this.connectionManager.getConnection();
    this.pythOracle = createPythOracle(connection);
    this.switchboardOracle = createSwitchboardOracle(connection);

    this.setupHandlers();
    this.setupErrorHandling();

    logger.info('Solana MCP Server initialized');
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOLS };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      try {
        const result = await this.handleToolCall(name, args || {});
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const err = error as Error;
        logger.error('Tool call failed', { name, error: err.message });
        
        throw new McpError(
          ErrorCode.InternalError,
          `Tool ${name} failed: ${err.message}`
        );
      }
    });
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      logger.error('MCP Server error', { error: String(error) });
    };

    process.on('SIGINT', async () => {
      await this.close();
      process.exit(0);
    });
  }

  private async handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    const connection = this.connectionManager.getConnection();

    switch (name) {
      case 'getSolanaBalance': {
        const address = args.address as string;
        if (!isValidPublicKey(address)) {
          throw new Error('Invalid Solana address');
        }
        const pubkey = new PublicKey(address);
        const balance = await connection.getBalance(pubkey);
        return {
          address,
          balanceLamports: balance,
          balanceSol: lamportsToSol(balance),
        };
      }

      case 'getSolanaTokens': {
        const address = args.address as string;
        const includeToken2022 = args.includeToken2022 !== false;
        
        if (!isValidPublicKey(address)) {
          throw new Error('Invalid Solana address');
        }
        
        const pubkey = new PublicKey(address);
        const allATAs = await getAllATAs(connection, pubkey, includeToken2022);
        
        const tokens = await Promise.all(
          allATAs.map(async ({ address: ataAddress, mint, program }) => {
            const account = await getTokenAccount(connection, ataAddress);
            const metadata = await getTokenMetadataWithFallback(connection, mint);
            
            return {
              mint: mint.toBase58(),
              tokenAccount: ataAddress.toBase58(),
              program: program.toBase58(),
              balance: account?.amount.toString() || '0',
              decimals: account?.decimals || 0,
              name: metadata?.name || 'Unknown',
              symbol: metadata?.symbol || 'UNKNOWN',
              image: metadata?.image,
            };
          })
        );

        return {
          address,
          tokenCount: tokens.length,
          tokens: tokens.filter(t => BigInt(t.balance) > 0),
        };
      }

      case 'getTokenPrice': {
        const symbol = (args.symbol as string).toUpperCase();
        
        // Try Pyth first
        let price = await this.pythOracle.getPrice(symbol);
        
        // Fallback to Switchboard
        if (!price) {
          price = await this.switchboardOracle.getPrice(symbol);
        }
        
        if (!price) {
          throw new Error(`Price not found for ${symbol}`);
        }

        return {
          symbol,
          price: price.price,
          confidence: price.confidence,
          source: price.source,
          publishTime: price.publishTime.toISOString(),
          status: price.status,
        };
      }

      case 'getMultipleTokenPrices': {
        const symbols = (args.symbols as string[]).map(s => s.toUpperCase());
        const prices = await this.pythOracle.getPrices(symbols);
        
        const results: Record<string, unknown> = {};
        for (const [symbol, price] of prices) {
          results[symbol] = price ? {
            price: price.price,
            confidence: price.confidence,
            source: price.source,
            status: price.status,
          } : null;
        }

        return { prices: results };
      }

      case 'getTokenMetadata': {
        const mint = args.mint as string;
        if (!isValidPublicKey(mint)) {
          throw new Error('Invalid mint address');
        }
        
        const metadata = await getTokenMetadataWithFallback(connection, new PublicKey(mint));
        
        if (!metadata) {
          throw new Error(`Metadata not found for ${mint}`);
        }

        return {
          mint,
          name: metadata.name,
          symbol: metadata.symbol,
          uri: metadata.uri,
          image: metadata.image,
          description: metadata.description,
        };
      }

      case 'getTokenMintInfo': {
        const mint = args.mint as string;
        if (!isValidPublicKey(mint)) {
          throw new Error('Invalid mint address');
        }
        
        const mintInfo = await getTokenMint(connection, new PublicKey(mint));
        
        if (!mintInfo) {
          throw new Error(`Mint not found: ${mint}`);
        }

        return {
          address: mintInfo.address.toBase58(),
          supply: mintInfo.supply.toString(),
          decimals: mintInfo.decimals,
          mintAuthority: mintInfo.mintAuthority?.toBase58() || null,
          freezeAuthority: mintInfo.freezeAuthority?.toBase58() || null,
          isInitialized: mintInfo.isInitialized,
        };
      }

      case 'getCurrentSlot': {
        const slot = await this.connectionManager.getSlot();
        return { slot };
      }

      case 'getTransaction': {
        const signature = args.signature as string;
        const tx = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });
        
        if (!tx) {
          throw new Error(`Transaction not found: ${signature}`);
        }

        return {
          signature,
          slot: tx.slot,
          blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
          fee: tx.meta?.fee,
          status: tx.meta?.err ? 'failed' : 'success',
          error: tx.meta?.err ? JSON.stringify(tx.meta.err) : null,
          computeUnitsConsumed: tx.meta?.computeUnitsConsumed,
        };
      }

      case 'getRecentTransactions': {
        const address = args.address as string;
        const limit = Math.min((args.limit as number) || 10, 100);
        
        if (!isValidPublicKey(address)) {
          throw new Error('Invalid address');
        }

        const signatures = await connection.getSignaturesForAddress(
          new PublicKey(address),
          { limit }
        );

        return {
          address,
          count: signatures.length,
          transactions: signatures.map(sig => ({
            signature: sig.signature,
            slot: sig.slot,
            blockTime: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : null,
            status: sig.err ? 'failed' : 'success',
            memo: sig.memo,
          })),
        };
      }

      case 'estimatePriorityFee': {
        const accounts = (args.accounts as string[]).map(a => new PublicKey(a));
        const fee = await this.connectionManager.estimatePriorityFee(accounts);
        
        return {
          estimatedPriorityFee: fee,
          unit: 'microLamports per compute unit',
          accounts: accounts.map(a => a.toBase58()),
        };
      }

      case 'getRpcHealth': {
        const health = await this.connectionManager.getAllEndpointHealth();
        const stats = this.connectionManager.getStats();
        
        return {
          endpoints: health.map(h => ({
            endpoint: h.endpoint,
            healthy: h.healthy,
            latencyMs: h.latencyMs,
            currentSlot: h.currentSlot,
            errors: h.errors,
            lastChecked: h.lastChecked.toISOString(),
          })),
          poolStats: stats.pool,
          activeSubscriptions: stats.subscriptions,
        };
      }

      case 'getAvailablePriceFeeds': {
        const source = (args.source as string) || 'all';
        const feeds: Array<{ symbol: string; source: string; address: string }> = [];
        
        if (source === 'all' || source === 'pyth') {
          const pythFeeds = await this.pythOracle.getAvailableFeeds();
          for (const feed of pythFeeds) {
            feeds.push({
              symbol: feed.symbol,
              source: 'pyth',
              address: feed.feedAddress.toBase58(),
            });
          }
        }
        
        if (source === 'all' || source === 'switchboard') {
          const sbFeeds = this.switchboardOracle.getAvailableFeeds();
          for (const feed of sbFeeds) {
            feeds.push({
              symbol: feed.symbol,
              source: 'switchboard',
              address: feed.feedAddress.toBase58(),
            });
          }
        }

        return { feeds };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Solana MCP Server running on stdio');
  }

  async close(): Promise<void> {
    this.pythOracle.unsubscribeAll();
    this.switchboardOracle.unsubscribeAll();
    await this.connectionManager.close();
    await this.server.close();
    logger.info('Solana MCP Server closed');
  }
}

// CLI entry point
const server = new SolanaMCPServer();
server.run().catch((error) => {
  logger.error('Failed to start server', { error: String(error) });
  process.exit(1);
});
