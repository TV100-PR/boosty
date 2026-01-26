

## 🚀 AGENT 5: Integration, Docs & Combined Server
```
Build the combined MCP server entry point, integration tests, and documentation.

Repository: nirholas/sperax-mcp-servers
Branch: main

Assumes all packages exist: /packages/shared, /packages/prices, /packages/wallets, /packages/yields

Create:

1. /packages/combined/package.json
{
  "name": "@sperax/mcp-defi",
  "version": "0.1.0",
  "description": "All-in-one DeFi MCP server",
  "main": "./dist/index.js",
  "bin": { "sperax-mcp": "./dist/cli.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@sperax/mcp-prices": "workspace:*",
    "@sperax/mcp-wallets": "workspace:*",
    "@sperax/mcp-yields": "workspace:*"
  }
}

2. /packages/combined/src/index.ts
- Import all tools from prices, wallets, yields
- Export combined MCP server

3. /packages/combined/src/server.ts
- Create MCP server that registers ALL tools from all packages
- Single entry point for SperaxOS

4. /packages/combined/src/cli.ts
- CLI: sperax-mcp [--prices-only] [--wallets-only] [--yields-only]
- Can run combined or individual servers

5. /packages/combined/mcp-manifest.json
- Combined manifest listing all tools

6. Update root /README.md with comprehensive documentation:
- Project overview
- Installation: pnpm install
- Quick start for each package
- Environment variables needed (API keys)
- MCP integration guide for SperaxOS
- Tool reference table (all tools, inputs, outputs)
- Examples of each tool

7. /.env.example
COINGECKO_API_KEY=
ALCHEMY_API_KEY=
ETHERSCAN_API_KEY=
ARBISCAN_API_KEY=
BASESCAN_API_KEY=

8. /docs/INTEGRATION.md
- How to add to SperaxOS
- MCP manifest format
- Configuration options

9. /docs/API_REFERENCE.md
- Full documentation of every tool
- Input/output schemas
- Example requests/responses

10. Create integration tests /packages/combined/src/__tests__/integration.test.ts
- Test that all tools are registered
- Test combined server starts
- Mock API responses
- Test error handling

11. /scripts/build-all.sh
#!/bin/bash
pnpm -r build

12. /scripts/test-all.sh
#!/bin/bash
pnpm -r test

13. /.github/workflows/ci.yml
- Run tests on push
- Build all packages
- Type check

14. /CHANGELOG.md
- Initial release notes

Ensure:
- All packages build successfully
- All tests pass
- Documentation is complete
- Ready to publish to npm
```

---

## Summary

| Agent | Package | Tools |
|-------|---------|-------|
| 1 | `shared` | Cache, RateLimiter, HTTP client |
| 2 | `prices` | getTokenPrice, getGasPrices, getTopMovers, getFearGreedIndex, comparePrices |
| 3 | `wallets` | getWalletPortfolio, getTokenBalances, getNFTs, getDeFiPositions, getApprovals |
| 4 | `yields` | getTopYields, getPoolDetails, compareYields, getStablecoinYields, getRiskAssessment |
| 5 | `combined` | All tools + docs + CI |

Create the repo `nirholas/sperax-mcp-servers` and launch all 5!