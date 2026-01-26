/**
 * Payment Tools - x402 payment-related tool definitions
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const paymentToolDefinitions: Tool[] = [
  {
    name: 'get_payment_pricing',
    description: 'Get pricing information for all available tools. Shows which tools require x402 payments and their costs in USDC.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by tool category (wallet, trading, campaign, bot, analysis)',
          enum: ['wallet', 'trading', 'campaign', 'bot', 'analysis'],
        },
      },
    },
  },
  {
    name: 'get_tool_price',
    description: 'Get the price for a specific tool call',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'The name of the tool to get pricing for',
        },
      },
      required: ['tool_name'],
    },
  },
  {
    name: 'get_payment_networks',
    description: 'Get supported payment networks and their USDC contract addresses',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
