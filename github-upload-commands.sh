#!/bin/bash
# GitHub Upload Commands for Vault APY Oracle Optimizations

echo "=== GitHub Repository Setup Commands ==="
echo "Run these commands in your terminal after creating the repo on GitHub:"
echo ""

echo "# 1. Initialize git repository"
echo "cd /path/to/vault-apy-oracle"
echo "git init"
echo ""

echo "# 2. Add all optimized files"
echo "git add ."
echo ""

echo "# 3. Create initial commit"
echo "git commit -m \"Initial commit: Optimized vault APY oracle with Redis caching and parallel processing\""
echo ""

echo "# 4. Add your GitHub repository as remote"
echo "git remote add origin https://github.com/YOUR_USERNAME/vault-apy-oracle-optimized.git"
echo ""

echo "# 5. Push to GitHub"
echo "git branch -M main"
echo "git push -u origin main"
echo ""

echo "=== Key Files to Include ==="
echo "✅ package.json (updated with new dependencies)"
echo "✅ src/api/server.js (optimized with caching & compression)"
echo "✅ src/utils/cache-manager.js (NEW - Redis caching layer)"
echo "✅ src/utils/risk-scorer.js (optimized with parallel processing)"
echo "✅ src/collectors/api/defillama-collector.js (parallel processing)"
echo "✅ README-OPTIMIZATIONS.md (performance documentation)"
echo ""

echo "=== Files to Exclude (create .gitignore) ==="
echo "node_modules/"
echo "*.log"
echo ".env"
echo "data/*"
echo "logs/*"