/**
 * DeFi MCP Server
 * Main server implementation with full MCP protocol compliance
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { allToolDefinitions, toolHandlers } from './tools/index.js';
import { allResourceTemplates } from './resources/index.js';
import * as resourceHandlers from './resources/index.js';
import { promptDefinitions, getPromptMessages } from './prompts/index.js';
import { ApiKeyAuth, RateLimiter, AuditLogger, getToolCategory } from './auth/index.js';
import { loadConfig, type ValidatedServerConfig } from './config/index.js';
import { logger, createChildLogger } from './utils/logger.js';

const serverLogger = createChildLogger('server');

export interface DeFiMCPServerOptions {
  config?: ValidatedServerConfig;
  configPath?: string;
}

export class DeFiMCPServer {
  private server: Server;
  private config: ValidatedServerConfig;
  private auth: ApiKeyAuth;
  private rateLimiter: RateLimiter;
  private auditLogger: AuditLogger;
  private isRunning: boolean = false;

  constructor(options: DeFiMCPServerOptions = {}) {
    // Load configuration
    this.config = options.config || loadConfig({ configPath: options.configPath });
    
    // Initialize auth components
    this.auth = new ApiKeyAuth({
      requireAuth: this.config.auth.requireAuth,
      apiKeyHeader: this.config.auth.apiKeyHeader,
    });
    
    this.rateLimiter = new RateLimiter(this.config.auth.rateLimits);
    this.auditLogger = new AuditLogger();

    // Create MCP server
    this.server = new Server(
      {
        name: 'defi-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
    
    serverLogger.info({ network: this.config.solana.network }, 'DeFi MCP Server initialized');
  }

  private setupHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: allToolDefinitions,
      };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const startTime = Date.now();

      // Check rate limit
      const category = getToolCategory(name);
      if (!this.rateLimiter.check(category)) {
        const resetTime = this.rateLimiter.getResetTime(category);
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Rate limit exceeded. Try again in ${Math.ceil(resetTime / 1000)} seconds.`
        );
      }

      // Find and execute handler
      const handler = toolHandlers[name];
      if (!handler) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      try {
        const result = await handler(args);
        const duration = Date.now() - startTime;

        // Audit log
        this.auditLogger.log({
          tool: name,
          params: args as Record<string, unknown>,
          result: 'success',
          duration,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Audit log error
        this.auditLogger.log({
          tool: name,
          params: args as Record<string, unknown>,
          result: 'error',
          duration,
          error: errorMessage,
        });

        throw new McpError(ErrorCode.InternalError, errorMessage);
      }
    });

    // List resources handler
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: allResourceTemplates.map(t => ({
          uri: t.uriTemplate,
          name: t.name,
          description: t.description,
          mimeType: t.mimeType,
        })),
      };
    });

    // Read resource handler
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      
      try {
        const resource = await this.resolveResource(uri);
        return {
          contents: [resource],
        };
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Resource not found: ${uri}`
        );
      }
    });

    // List prompts handler
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: promptDefinitions,
      };
    });

    // Get prompt handler
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      const prompt = promptDefinitions.find(p => p.name === name);
      if (!prompt) {
        throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${name}`);
      }

      const messages = getPromptMessages(name, args || {});
      return { messages };
    });
  }

  private async resolveResource(uri: string): Promise<{ uri: string; mimeType: string; text: string }> {
    // Parse URI
    if (uri === 'wallets://list') {
      const resource = await resourceHandlers.getWalletListResource();
      return { uri: resource.uri, mimeType: resource.mimeType, text: resource.content };
    }
    
    if (uri === 'campaigns://list') {
      const resource = await resourceHandlers.getCampaignListResource();
      return { uri: resource.uri, mimeType: resource.mimeType, text: resource.content };
    }
    
    if (uri === 'bots://list') {
      const resource = await resourceHandlers.getBotListResource();
      return { uri: resource.uri, mimeType: resource.mimeType, text: resource.content };
    }

    // Parse parameterized URIs
    const walletMatch = uri.match(/^wallets:\/\/([^/]+)$/);
    if (walletMatch) {
      const resource = await resourceHandlers.getWalletResource(walletMatch[1]);
      return { uri: resource.uri, mimeType: resource.mimeType, text: resource.content };
    }

    const walletTxMatch = uri.match(/^wallets:\/\/([^/]+)\/transactions$/);
    if (walletTxMatch) {
      const resource = await resourceHandlers.getWalletTransactionsResource(walletTxMatch[1]);
      return { uri: resource.uri, mimeType: resource.mimeType, text: resource.content };
    }

    const campaignMatch = uri.match(/^campaigns:\/\/([^/]+)$/);
    if (campaignMatch) {
      const resource = await resourceHandlers.getCampaignResource(campaignMatch[1]);
      return { uri: resource.uri, mimeType: resource.mimeType, text: resource.content };
    }

    const campaignMetricsMatch = uri.match(/^campaigns:\/\/([^/]+)\/metrics$/);
    if (campaignMetricsMatch) {
      const resource = await resourceHandlers.getCampaignMetricsResource(campaignMetricsMatch[1]);
      return { uri: resource.uri, mimeType: resource.mimeType, text: resource.content };
    }

    const botStatusMatch = uri.match(/^bots:\/\/([^/]+)\/status$/);
    if (botStatusMatch) {
      const resource = await resourceHandlers.getBotStatusResource(botStatusMatch[1]);
      return { uri: resource.uri, mimeType: resource.mimeType, text: resource.content };
    }

    const tokenInfoMatch = uri.match(/^tokens:\/\/([^/]+)\/info$/);
    if (tokenInfoMatch) {
      const resource = await resourceHandlers.getTokenInfoResource(tokenInfoMatch[1]);
      return { uri: resource.uri, mimeType: resource.mimeType, text: resource.content };
    }

    throw new Error(`Unknown resource: ${uri}`);
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      serverLogger.error({ error }, 'MCP Server error');
    };

    process.on('SIGINT', async () => {
      serverLogger.info('Received SIGINT, shutting down...');
      await this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      serverLogger.info('Received SIGTERM, shutting down...');
      await this.stop();
      process.exit(0);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      serverLogger.warn('Server is already running');
      return;
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.isRunning = true;
    
    serverLogger.info('DeFi MCP Server started on stdio');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    await this.server.close();
    this.isRunning = false;
    serverLogger.info('DeFi MCP Server stopped');
  }

  getConfig(): ValidatedServerConfig {
    return this.config;
  }

  getAuditLog(limit?: number) {
    return this.auditLogger.getEntries(limit);
  }
}

export function createServer(options?: DeFiMCPServerOptions): DeFiMCPServer {
  return new DeFiMCPServer(options);
}
