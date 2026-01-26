/**
 * Payment Tool Handlers
 */

import { 
  DEFAULT_CATEGORY_PRICING, 
  ALWAYS_FREE_TOOLS,
  createDefaultX402Config,
  getToolPrice,
} from '../../payments/config.js';
import { allToolDefinitions } from '../index.js';

// USDC addresses by network
const USDC_ADDRESSES: Record<string, string> = {
  'base-mainnet': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'ethereum-mainnet': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'solana-mainnet': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana-devnet': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

export interface PaymentPricingResult {
  enabled: boolean;
  defaultCurrency: string;
  facilitatorUrl: string;
  pricing: {
    categories: Record<string, { price: string; currency: string }>;
    tools: Record<string, { price: string; currency: string; category: string }>;
    freeTools: string[];
  };
}

export interface ToolPriceResult {
  toolName: string;
  price: string;
  priceUsd: number;
  currency: string;
  category: string;
  isFree: boolean;
}

export interface PaymentNetworksResult {
  networks: Array<{
    name: string;
    chainId: string;
    usdcAddress: string;
    supported: boolean;
  }>;
  currentNetwork: string;
}

/**
 * Helper to determine tool category
 */
function getToolCategory(toolName: string): string {
  if (toolName.includes('wallet') || toolName.includes('fund')) {
    return 'walletOps';
  }
  if (toolName.includes('swap') || toolName.includes('buy') || toolName.includes('sell')) {
    return 'swaps';
  }
  if (toolName.includes('campaign')) {
    return 'campaigns';
  }
  if (toolName.includes('bot')) {
    return 'bots';
  }
  if (toolName.includes('token') || toolName.includes('pool') || toolName.includes('price') || 
      toolName.includes('liquidity') || toolName.includes('holder') || toolName.includes('market') ||
      toolName.includes('analyze')) {
    return 'analysis';
  }
  return 'queries';
}

/**
 * Parse price string to number
 */
function parsePriceToNumber(price: string): number {
  const cleaned = price.replace(/[$,]/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Format PriceSpec to string
 */
function formatPriceSpec(price: string | { amount: string; asset: { address: string; decimals: number; symbol: string; } }): string {
  if (typeof price === 'string') {
    return price;
  }
  // For object format, format as dollar amount
  const decimals = price.asset?.decimals || 6;
  const amount = parseFloat(price.amount) / Math.pow(10, decimals);
  return `$${amount.toFixed(4)}`;
}

/**
 * Get pricing for all tools
 */
export async function getPaymentPricing(args?: { category?: string }): Promise<PaymentPricingResult> {
  const categoryFilter = args?.category?.toLowerCase();
  const config = createDefaultX402Config(process.env.X402_PAY_TO_ADDRESS);
  
  // Build category pricing from array
  const categories: Record<string, { price: string; currency: string }> = {};
  for (const catPricing of DEFAULT_CATEGORY_PRICING) {
    if (!categoryFilter || catPricing.category.toLowerCase().includes(categoryFilter)) {
      categories[catPricing.category] = {
        price: formatPriceSpec(catPricing.price),
        currency: 'USDC',
      };
    }
  }

  // Build tool-specific pricing
  const tools: Record<string, { price: string; currency: string; category: string }> = {};
  
  for (const tool of allToolDefinitions) {
    const category = getToolCategory(tool.name);
    
    if (categoryFilter && !category.toLowerCase().includes(categoryFilter)) {
      continue;
    }

    if (ALWAYS_FREE_TOOLS.includes(tool.name)) {
      tools[tool.name] = {
        price: '$0.00',
        currency: 'USDC',
        category,
      };
    } else {
      const pricing = getToolPrice(config, tool.name, category);
      tools[tool.name] = {
        price: pricing.price,
        currency: 'USDC',
        category,
      };
    }
  }

  // Filter free tools
  const freeTools = allToolDefinitions
    .filter(t => ALWAYS_FREE_TOOLS.includes(t.name))
    .filter(t => !categoryFilter || getToolCategory(t.name).toLowerCase().includes(categoryFilter))
    .map(t => t.name);

  return {
    enabled: !!process.env.X402_PAY_TO_ADDRESS,
    defaultCurrency: 'USDC',
    facilitatorUrl: process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator',
    pricing: {
      categories,
      tools,
      freeTools,
    },
  };
}

/**
 * Get price for a specific tool
 */
export async function getToolPriceHandler(args: { tool_name: string }): Promise<ToolPriceResult> {
  const toolName = args.tool_name;
  
  // Check if tool exists
  const toolDef = allToolDefinitions.find(t => t.name === toolName);
  if (!toolDef) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const category = getToolCategory(toolName);
  const isFree = ALWAYS_FREE_TOOLS.includes(toolName);
  const config = createDefaultX402Config(process.env.X402_PAY_TO_ADDRESS);
  
  const pricing = getToolPrice(config, toolName, category);
  const priceUsd = isFree ? 0 : parsePriceToNumber(pricing.price);

  return {
    toolName,
    price: isFree ? '$0.00' : pricing.price,
    priceUsd,
    currency: 'USDC',
    category,
    isFree,
  };
}

/**
 * Get supported payment networks
 */
export async function getPaymentNetworks(): Promise<PaymentNetworksResult> {
  const currentNetwork = process.env.X402_NETWORK || 'base-mainnet';
  
  const networks: PaymentNetworksResult['networks'] = [
    {
      name: 'Base Mainnet',
      chainId: 'eip155:8453',
      usdcAddress: USDC_ADDRESSES['base-mainnet'] ?? '',
      supported: true,
    },
    {
      name: 'Base Sepolia (Testnet)',
      chainId: 'eip155:84532',
      usdcAddress: USDC_ADDRESSES['base-sepolia'] ?? '',
      supported: true,
    },
    {
      name: 'Ethereum Mainnet',
      chainId: 'eip155:1',
      usdcAddress: USDC_ADDRESSES['ethereum-mainnet'] ?? '',
      supported: true,
    },
    {
      name: 'Solana Mainnet',
      chainId: 'solana:mainnet',
      usdcAddress: USDC_ADDRESSES['solana-mainnet'] ?? '',
      supported: true,
    },
    {
      name: 'Solana Devnet',
      chainId: 'solana:devnet',
      usdcAddress: USDC_ADDRESSES['solana-devnet'] ?? '',
      supported: true,
    },
  ];

  return {
    networks,
    currentNetwork,
  };
}
