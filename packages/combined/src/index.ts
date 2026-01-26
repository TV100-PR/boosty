/**
 * @sperax/mcp-defi
 * All-in-one DeFi MCP server combining prices, wallets, and yields
 */

// Re-export everything from sub-packages
export * from '@sperax/mcp-prices';
export * from '@sperax/mcp-wallets';
export * from '@sperax/mcp-yields';

// Combined server
export { createCombinedServer, CombinedServerOptions } from './server';
