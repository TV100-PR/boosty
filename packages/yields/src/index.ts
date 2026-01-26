/**
 * @sperax/mcp-yields
 * MCP server for DeFi yield discovery and comparison
 */

// Server
export { createYieldsServer, YieldsServer } from './server';

// Tools
export { getTopYields } from './tools/getTopYields';
export { getPoolDetails } from './tools/getPoolDetails';
export { getYieldHistory } from './tools/getYieldHistory';
export { compareYields } from './tools/compareYields';
export { getStablecoinYields } from './tools/getStablecoinYields';
export { getLPYields } from './tools/getLPYields';
export { estimateReturns } from './tools/estimateReturns';
export { getRiskAssessment } from './tools/getRiskAssessment';

// APIs
export { DefiLlamaClient } from './apis/defillama';

// Utils
export { calculateRiskScore, RiskFactors, RiskAssessment } from './utils/risk';

// Types
export * from './types';
