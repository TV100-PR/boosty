/**
 * DeFi MCP Server - Main Entry Point
 */

// Server
export { DeFiMCPServer, createServer, type DeFiMCPServerOptions } from './server.js';

// Configuration
export { loadConfig, createDevConfig, ServerConfigSchema } from './config/index.js';
export type { ValidatedServerConfig } from './config/index.js';

// Types
export * from './types.js';

// Tools
export { allToolDefinitions, toolHandlers } from './tools/index.js';
export * from './tools/wallet-tools.js';
export * from './tools/trading-tools.js';
export * from './tools/campaign-tools.js';
export * from './tools/analysis-tools.js';
export * from './tools/bot-tools.js';

// Resources
export { allResourceTemplates } from './resources/index.js';

// Prompts
export { promptDefinitions, getPromptMessages } from './prompts/index.js';

// Auth
export { ApiKeyAuth, RateLimiter, AuditLogger, getToolCategory } from './auth/index.js';

// Utils
export { logger, createChildLogger } from './utils/index.js';
