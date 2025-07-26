// src/api/server.js
const express = require('express');
const compression = require('compression');
const { Pool } = require('pg');
const DefiLlamaCollector = require('../collectors/api/defillama-collector');
const RiskScorer = require('../utils/risk-scorer');
const CacheManager = require('../utils/cache-manager');
const cron = require('node-cron');

class VaultAPYAPIServer {
  constructor() {
    this.app = express();
    this.port = process.env.API_PORT || 3000;
    
    // Database connection with optimized pool settings
    this.pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      max: 20, // maximum number of connections
      min: 5,  // minimum number of connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Initialize components
    this.defiLlamaCollector = new DefiLlamaCollector();
    this.riskScorer = new RiskScorer();
    this.cacheManager = new CacheManager();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupCronJobs();
  }

  setupMiddleware() {
    // Enable compression for all responses
    this.app.use(compression());
    
    this.app.use(express.json());
    
    // CORS for web apps
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      next();
    });

    // Request logging with performance timing
    this.app.use((req, res, next) => {
      req.startTime = Date.now();
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${req.ip}`);
      
      // Add response time logging
      const originalSend = res.send;
      res.send = function(data) {
        const duration = Date.now() - req.startTime;
        console.log(`${req.method} ${req.path} completed in ${duration}ms`);
        originalSend.call(this, data);
      };
      
      next();
    });

    // Improved rate limiting with Redis fallback to memory
    this.app.use(async (req, res, next) => {
      try {
        const ip = req.ip;
        const now = Date.now();
        const windowMs = 60000; // 1 minute
        const maxRequests = 200; // Increased limit for better performance
        const key = `rate_limit:${ip}`;

        // Try Redis first, fallback to memory
        let rateLimitData = await this.cacheManager.getVaultData(key);
        
        if (!rateLimitData) {
          rateLimitData = { count: 0, resetTime: now + windowMs };
        }

        if (now > rateLimitData.resetTime) {
          rateLimitData = { count: 1, resetTime: now + windowMs };
        } else {
          rateLimitData.count++;
          if (rateLimitData.count > maxRequests) {
            return res.status(429).json({ 
              error: 'Rate limit exceeded', 
              retryAfter: Math.ceil((rateLimitData.resetTime - now) / 1000) 
            });
          }
        }

        await this.cacheManager.setVaultData(key, rateLimitData, 60);
        next();
      } catch (error) {
        console.error('Rate limiting error:', error.message);
        next(); // Continue on error to avoid blocking requests
      }
    });
  }

  setupRoutes() {
    // API Documentation endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Vault APY Oracle API',
        version: '1.0.0',
        description: 'Real-time vault APY data for DeFi automation agents',
        documentation: {
          endpoints: {
            'GET /': 'This documentation',
            'GET /health': 'Health check',
            'GET /api/v1/vaults/best/:asset': 'Get best vault for asset',
            'GET /api/v1/vaults/top/:asset': 'Get top vaults for asset',
            'GET /api/v1/vaults/:chain/:address': 'Get specific vault data',
            'GET /api/v1/chains': 'Get supported chains',
            'GET /api/v1/protocols': 'Get supported protocols',
            'POST /api/v1/vaults/compare': 'Compare multiple vaults'
          },
          parameters: {
            asset: 'Asset symbol (e.g., USDC, USDT)',
            risk: 'Risk tolerance: low, medium-low, medium, medium-high, high',
            chain: 'Blockchain network: ethereum, base, arbitrum, polygon',
            limit: 'Number of results to return (default: 10, max: 100)'
          }
        },
        timestamp: new Date().toISOString()
      });
    });

    // Health check
    this.app.get('/health', async (req, res) => {
      try {
        // Test database connection
        const client = await this.pool.connect();
        await client.query('SELECT 1');
        client.release();

        res.json({ 
          status: 'healthy',
          database: 'connected',
          timestamp: new Date().toISOString(),
          uptime: process.uptime()
        });
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          database: 'disconnected',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Get best vault for an asset
    this.app.get('/api/v1/vaults/best/:asset', async (req, res) => {
      try {
        const { asset } = req.params;
        const { 
          risk = 'medium', 
          chain,
          min_tvl = 100000,
          fresh = false 
        } = req.query;

        console.log(`🔍 Finding best vault for ${asset} with ${risk} risk`);

        // Use cache manager for request deduplication and caching
        const cacheKey = `best_vault:${asset}:${risk}:${chain || 'all'}:${min_tvl}`;
        
        let vaults;
        if (fresh === 'true') {
          // Get fresh data from APIs
          vaults = await this.defiLlamaCollector.collectAllVaults();
        } else {
          // Use cache with request deduplication
          vaults = await this.cacheManager.getOrSetWithDeduplication(
            cacheKey,
            async () => {
              // Try database first, then API
              let dbVaults = await this.getVaultsFromDB(asset, chain);
              if (dbVaults.length === 0) {
                console.log('📡 Cache miss - fetching from API');
                dbVaults = await this.defiLlamaCollector.collectAllVaults();
              }
              return dbVaults;
            },
            300 // 5 minute cache
          );
        }

        // Filter and score
        let filteredVaults = vaults.filter(vault => 
          vault.asset_symbol.toUpperCase() === asset.toUpperCase() &&
          vault.tvl_usd >= parseInt(min_tvl)
        );

        if (chain) {
          filteredVaults = filteredVaults.filter(vault => 
            vault.chain.toLowerCase() === chain.toLowerCase()
          );
        }

        const safeVaults = await this.riskScorer.filterByRiskTolerance(filteredVaults, risk);
        
        if (safeVaults.length === 0) {
          return res.status(404).json({
            error: 'No vaults found matching criteria',
            criteria: { asset, risk, chain, min_tvl }
          });
        }

        const bestVault = safeVaults
          .map(vault => ({
            ...vault,
            risk_adjusted_apy: this.riskScorer.getRiskAdjustedAPY(vault.apy, vault.risk_score)
          }))
          .sort((a, b) => b.risk_adjusted_apy - a.risk_adjusted_apy)[0];

        res.json({
          success: true,
          data: {
            vault_address: bestVault.vault_address,
            name: bestVault.name,
            protocol: bestVault.protocol,
            chain: bestVault.chain,
            asset: bestVault.asset_symbol,
            apy: bestVault.apy,
            risk_adjusted_apy: bestVault.risk_adjusted_apy,
            risk_score: bestVault.risk_score,
            risk_category: bestVault.risk_category,
            tvl_usd: bestVault.tvl_usd,
            data_source: bestVault.data_source
          },
          metadata: {
            total_vaults_analyzed: filteredVaults.length,
            vaults_passing_risk_filter: safeVaults.length,
            criteria: { asset, risk, chain, min_tvl },
            timestamp: new Date().toISOString()
          }
        });

      } catch (error) {
        console.error('Best vault error:', error.message);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    // Get top vaults for an asset
    this.app.get('/api/v1/vaults/top/:asset', async (req, res) => {
      try {
        const { asset } = req.params;
        const { 
          risk = 'medium', 
          chain,
          limit = 10,
          sort_by = 'risk_adjusted_apy' // or 'apy', 'tvl', 'risk_score'
        } = req.query;

        const vaults = await this.defiLlamaCollector.collectAllVaults();
        
        let filteredVaults = vaults.filter(vault => 
          vault.asset_symbol.toUpperCase() === asset.toUpperCase()
        );

        if (chain) {
          filteredVaults = filteredVaults.filter(vault => 
            vault.chain.toLowerCase() === chain.toLowerCase()
          );
        }

        const safeVaults = await this.riskScorer.filterByRiskTolerance(filteredVaults, risk);
        
        const enrichedVaults = safeVaults.map(vault => ({
          ...vault,
          risk_adjusted_apy: this.riskScorer.getRiskAdjustedAPY(vault.apy, vault.risk_score)
        }));

        // Sort based on requested criteria
        const sortFunctions = {
          'risk_adjusted_apy': (a, b) => b.risk_adjusted_apy - a.risk_adjusted_apy,
          'apy': (a, b) => b.apy - a.apy,
          'tvl': (a, b) => b.tvl_usd - a.tvl_usd,
          'risk_score': (a, b) => b.risk_score - a.risk_score
        };

        const sortedVaults = enrichedVaults
          .sort(sortFunctions[sort_by] || sortFunctions['risk_adjusted_apy'])
          .slice(0, Math.min(parseInt(limit), 100));

        res.json({
          success: true,
          data: sortedVaults.map(vault => ({
            vault_address: vault.vault_address,
            name: vault.name,
            protocol: vault.protocol,
            chain: vault.chain,
            asset: vault.asset_symbol,
            apy: vault.apy,
            risk_adjusted_apy: vault.risk_adjusted_apy,
            risk_score: vault.risk_score,
            risk_category: vault.risk_category,
            tvl_usd: vault.tvl_usd,
            data_source: vault.data_source
          })),
          metadata: {
            total_results: sortedVaults.length,
            total_analyzed: filteredVaults.length,
            sort_by,
            criteria: { asset, risk, chain, limit },
            timestamp: new Date().toISOString()
          }
        });

      } catch (error) {
        console.error('Top vaults error:', error.message);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    // Get specific vault data
    this.app.get('/api/v1/vaults/:chain/:address', async (req, res) => {
      try {
        const { chain, address } = req.params;

        // Check database first
        const client = await this.pool.connect();
        
        try {
          const result = await client.query(`
            SELECT v.*, vm.apy, vm.tvl_usd, vm.risk_score, vm.timestamp
            FROM vaults v
            LEFT JOIN vault_metrics vm ON v.vault_address = vm.vault_address
            WHERE v.vault_address = $1 AND v.chain = $2
            ORDER BY vm.timestamp DESC
            LIMIT 1
          `, [address, chain.toLowerCase()]);

          if (result.rows.length === 0) {
            return res.status(404).json({
              success: false,
              error: `Vault ${address} not found on ${chain}`
            });
          }

          const vault = result.rows[0];
          const age = Date.now() - new Date(vault.timestamp).getTime();

          res.json({
            success: true,
            data: {
              vault_address: vault.vault_address,
              name: vault.name,
              protocol: vault.protocol,
              chain: vault.chain,
              asset: vault.asset_symbol,
              apy: parseFloat(vault.apy),
              tvl_usd: parseInt(vault.tvl_usd),
              risk_score: vault.risk_score,
              last_updated: vault.timestamp,
              data_age_minutes: Math.round(age / 60000)
            },
            metadata: {
              cached: age < 15 * 60 * 1000, // Less than 15 minutes old
              timestamp: new Date().toISOString()
            }
          });

        } finally {
          client.release();
        }

      } catch (error) {
        console.error('Vault lookup error:', error.message);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    // Compare multiple vaults
    this.app.post('/api/v1/vaults/compare', async (req, res) => {
      try {
        const { vaults } = req.body; // Array of {chain, address}
        
        if (!Array.isArray(vaults) || vaults.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'Please provide an array of vaults to compare'
          });
        }

        const results = [];
        const client = await this.pool.connect();

        try {
          for (const vault of vaults) {
            const result = await client.query(`
              SELECT v.*, vm.apy, vm.tvl_usd, vm.risk_score, vm.timestamp
              FROM vaults v
              LEFT JOIN vault_metrics vm ON v.vault_address = vm.vault_address
              WHERE v.vault_address = $1 AND v.chain = $2
              ORDER BY vm.timestamp DESC
              LIMIT 1
            `, [vault.address, vault.chain.toLowerCase()]);

            if (result.rows.length > 0) {
              const vaultData = result.rows[0];
              const riskAdjustedAPY = this.riskScorer.getRiskAdjustedAPY(
                parseFloat(vaultData.apy), 
                vaultData.risk_score
              );

              results.push({
                vault_address: vaultData.vault_address,
                name: vaultData.name,
                protocol: vaultData.protocol,
                chain: vaultData.chain,
                apy: parseFloat(vaultData.apy),
                risk_adjusted_apy: riskAdjustedAPY,
                risk_score: vaultData.risk_score,
                tvl_usd: parseInt(vaultData.tvl_usd)
              });
            }
          }

          // Sort by risk-adjusted APY
          results.sort((a, b) => b.risk_adjusted_apy - a.risk_adjusted_apy);

          res.json({
            success: true,
            data: results,
            metadata: {
              requested: vaults.length,
              found: results.length,
              best_vault: results[0]?.vault_address,
              timestamp: new Date().toISOString()
            }
          });

        } finally {
          client.release();
        }

      } catch (error) {
        console.error('Compare vaults error:', error.message);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    // Get supported chains
    this.app.get('/api/v1/chains', async (req, res) => {
      try {
        const client = await this.pool.connect();
        
        try {
          const result = await client.query(`
            SELECT chain, COUNT(*) as vault_count, 
                   AVG(vm.apy) as avg_apy,
                   SUM(vm.tvl_usd) as total_tvl
            FROM vaults v
            LEFT JOIN vault_metrics vm ON v.vault_address = vm.vault_address
            WHERE vm.timestamp > NOW() - INTERVAL '1 day'
            GROUP BY chain
            ORDER BY total_tvl DESC
          `);

          res.json({
            success: true,
            data: result.rows.map(row => ({
              chain: row.chain,
              vault_count: parseInt(row.vault_count),
              avg_apy: parseFloat(row.avg_apy || 0),
              total_tvl_usd: parseInt(row.total_tvl || 0)
            })),
            metadata: {
              timestamp: new Date().toISOString()
            }
          });

        } finally {
          client.release();
        }

      } catch (error) {
        console.error('Chains error:', error.message);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });
  }

  async getVaultsFromDB(asset, chain = null) {
    const client = await this.pool.connect();
    
    try {
      let query = `
        SELECT v.*, vm.apy, vm.tvl_usd, vm.risk_score, vm.timestamp
        FROM vaults v
        LEFT JOIN vault_metrics vm ON v.vault_address = vm.vault_address
        WHERE v.asset_symbol = $1
        AND vm.timestamp > NOW() - INTERVAL '1 hour'
      `;
      
      const params = [asset.toUpperCase()];
      
      if (chain) {
        query += ' AND v.chain = $2';
        params.push(chain.toLowerCase());
      }
      
      query += ' ORDER BY vm.timestamp DESC';
      
      const result = await client.query(query, params);
      
      return result.rows.map(row => ({
        vault_address: row.vault_address,
        chain: row.chain,
        protocol: row.protocol,
        name: row.name,
        asset_symbol: row.asset_symbol,
        apy: parseFloat(row.apy || 0),
        tvl_usd: parseInt(row.tvl_usd || 0),
        risk_score: row.risk_score,
        data_source: 'database'
      }));

    } finally {
      client.release();
    }
  }

  setupCronJobs() {
    // Update vault data every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      try {
        console.log('🔄 Running scheduled vault data update...');
        const vaults = await this.defiLlamaCollector.collectAllVaults();
        
        // Add risk scores with parallel processing
        const enrichedVaults = await Promise.all(
          vaults.map(async vault => {
            const riskAnalysis = await this.riskScorer.calculateRiskScore(vault);
            return {
              ...vault,
              risk_score: riskAnalysis.riskScore,
              risk_category: riskAnalysis.riskCategory
            };
          })
        );

        // Save to database
        await this.saveVaultData(enrichedVaults.slice(0, 100)); // Limit to top 100 for performance
        console.log(`✅ Updated ${enrichedVaults.length} vaults`);
        
      } catch (error) {
        console.error('❌ Scheduled update failed:', error.message);
      }
    });
  }

  async saveVaultData(vaultDataArray) {
    if (vaultDataArray.length === 0) return;
    
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Batch insert vaults
      const vaultValues = vaultDataArray.map((vault, i) => 
        `($${i*5+1}, $${i*5+2}, $${i*5+3}, $${i*5+4}, $${i*5+5})`
      ).join(', ');
      
      const vaultParams = vaultDataArray.flatMap(vault => [
        vault.vault_address,
        vault.chain,
        vault.protocol,
        vault.name,
        vault.asset_symbol
      ]);

      await client.query(`
        INSERT INTO vaults (vault_address, chain, protocol, name, asset_symbol)
        VALUES ${vaultValues}
        ON CONFLICT (vault_address) 
        DO UPDATE SET 
          updated_at = CURRENT_TIMESTAMP,
          name = EXCLUDED.name
      `, vaultParams);

      // Batch insert metrics
      const metricsValues = vaultDataArray.map((vault, i) => 
        `($${i*6+1}, $${i*6+2}, $${i*6+3}, $${i*6+4}, $${i*6+5}, $${i*6+6})`
      ).join(', ');
      
      const metricsParams = vaultDataArray.flatMap(vault => [
        vault.vault_address,
        vault.apy,
        vault.apr || vault.apy,
        vault.tvl_usd,
        vault.risk_score,
        vault.data_source
      ]);

      await client.query(`
        INSERT INTO vault_metrics 
        (vault_address, apy, apr, tvl_usd, risk_score, data_source)
        VALUES ${metricsValues}
      `, metricsParams);

      await client.query('COMMIT');
      
      // Update cache after successful save
      const cacheUpdates = vaultDataArray.map(vault => [
        `vault:${vault.vault_address}:${vault.chain}`,
        vault
      ]);
      await this.cacheManager.setBatch(cacheUpdates, 900); // 15 minute cache
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`🚀 Vault APY API Server running on port ${this.port}`);
      console.log(`📖 API Documentation: http://localhost:${this.port}`);
      console.log(`🔍 Health check: http://localhost:${this.port}/health`);
      console.log(`🏆 Best vault example: http://localhost:${this.port}/api/v1/vaults/best/USDC?risk=medium`);
    });
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  require('dotenv').config();
  
  const server = new VaultAPYAPIServer();
  server.start();
}

module.exports = VaultAPYAPIServer;
