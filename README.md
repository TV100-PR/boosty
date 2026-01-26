# Sperax MCP DeFi Servers

A comprehensive suite of Model Context Protocol (MCP) servers for DeFi operations, designed to integrate with SperaxOS and other AI assistants.

## 📦 Packages

| Package | Description | Tools |
|---------|-------------|-------|
| `@sperax/mcp-shared` | Shared utilities | Cache, RateLimiter, HTTP client |
| `@sperax/mcp-prices` | Real-time price data | getTokenPrice, getGasPrices, getTopMovers, getFearGreedIndex, comparePrices |
| `@sperax/mcp-wallets` | Wallet analytics | getWalletPortfolio, getTokenBalances, getNFTs, getDeFiPositions, getApprovals |
| `@sperax/mcp-yields` | Yield discovery | getTopYields, getPoolDetails, compareYields, getStablecoinYields, getRiskAssessment |
| `@sperax/mcp-defi` | All-in-one server | All tools combined |

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0

### Installation

```bash
# Clone the repository
git clone https://github.com/nirholas/sperax-mcp-servers.git
cd sperax-mcp-servers

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Running the Combined Server

```bash
# Run the all-in-one DeFi server
pnpm --filter @sperax/mcp-defi dev

# Or run individual servers
pnpm --filter @sperax/mcp-prices dev
pnpm --filter @sperax/mcp-wallets dev
pnpm --filter @sperax/mcp-yields dev
```

### CLI Options

```bash
# Run with all tools (default)
sperax-mcp

# Run only specific tool categories
sperax-mcp --prices-only
sperax-mcp --wallets-only
sperax-mcp --yields-only

# Disable specific categories
sperax-mcp --no-prices
sperax-mcp --no-yields
```

### Development

```bash
# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint

# Clean build artifacts
pnpm clean
```

## 🔧 Environment Variables

Create a `.env` file in the root directory:

```bash
# Required for wallet data
ALCHEMY_API_KEY=your_alchemy_key

# Optional - improves rate limits
COINGECKO_API_KEY=your_coingecko_key

# Optional - for block explorer data
ETHERSCAN_API_KEY=your_etherscan_key
ARBISCAN_API_KEY=your_arbiscan_key
BASESCAN_API_KEY=your_basescan_key
```

## 🔧 Supported Chains

- Ethereum
- Arbitrum
- Base
- Polygon
- Solana

## 📖 Tool Reference

### Price Tools

| Tool | Description | Inputs |
|------|-------------|--------|
| `getTokenPrice` | Get current price and market data | `symbol`, `currency` |
| `getGasPrices` | Get gas prices for a chain | `chain` |
| `getTopMovers` | Get top gainers/losers | `limit`, `sortBy` |
| `getFearGreedIndex` | Get Fear & Greed Index | - |
| `comparePrices` | Compare multiple tokens | `symbols[]` |
| `getTokenPriceHistory` | Historical price data | `symbol`, `days` |

### Wallet Tools

| Tool | Description | Inputs |
|------|-------------|--------|
| `getWalletPortfolio` | Complete portfolio overview | `address`, `chain` |
| `getTokenBalances` | ERC20 token balances | `address`, `chain` |
| `getNFTs` | NFT holdings | `address`, `chain`, `limit` |
| `getDeFiPositions` | DeFi protocol positions | `address` |
| `getApprovals` | Token approvals | `address`, `chain` |

### Yield Tools

| Tool | Description | Inputs |
|------|-------------|--------|
| `getTopYields` | Top yield opportunities | `chain`, `minTvl`, `maxApy`, `limit` |
| `getPoolDetails` | Pool details with risk | `poolId` |
| `compareYields` | Compare pools | `poolIds[]` |
| `getStablecoinYields` | Stablecoin yields | `chain`, `minTvl`, `limit` |
| `getRiskAssessment` | Pool risk analysis | `poolId` |

## 🔌 MCP Integration

### SperaxOS Integration

Add to your SperaxOS configuration:

```json
{
  "mcpServers": {
    "sperax-defi": {
      "command": "npx",
      "args": ["@sperax/mcp-defi"],
      "env": {
        "ALCHEMY_API_KEY": "${ALCHEMY_API_KEY}"
      }
    }
  }
}
```

### Claude Desktop Integration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sperax-defi": {
      "command": "node",
      "args": ["/path/to/packages/combined/dist/cli.js"],
      "env": {
        "ALCHEMY_API_KEY": "your-key"
      }
    }
  }
}
```

## 📁 Project Structure

```
sperax-mcp-servers/
├── packages/
│   ├── shared/          # Shared utilities
│   ├── prices/          # Price MCP server
│   ├── wallets/         # Wallet MCP server
│   └── yields/          # Yields MCP server
├── package.json         # Root package.json
├── pnpm-workspace.yaml  # Workspace configuration
└── tsconfig.base.json   # Shared TypeScript config
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
