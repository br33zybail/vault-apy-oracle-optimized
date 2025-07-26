const express = require('express');
const { Pool } = require('pg');
const { FilteredDefiLlamaCollector } = require('../collectors/api/defillama-collector');
const VaultsFyiCollector = require('../collectors/api/vaults-fyi-collector');
const VaultOnChainCollector = require('../collectors/onchain/vault-onchain-collector');
const EnhancedVaultOnChainCollector = require('../collectors/onchain/enhanced-vault-collector');
const RiskScorer = require('../utils/risk-scorer');

class VaultAPYExternalAdapter {
  constructor() {
    this.app = express();
    this.port = process.env.ADAPTER_PORT || 8080;
    
    // Database connection
    this.pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
    });

    // Initialize components
    this.vaultsFyiCollector = new VaultsFyiCollector();
    this.defiLlamaCollector = new FilteredDefiLlamaCollector();
    this.onChainCollector = new VaultOnChainCollector();
    this.enhancedOnChainCollector = new EnhancedVaultOnChainCollector();
    this.riskScorer = new RiskScorer();
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Check if address is a real Ethereum address vs DeFi Llama UUID
   */
  isEthereumAddress(address) {
    return address && 
           typeof address === 'string' && 
           address.startsWith('0x') && 
           address.length === 42;
  }

  setupMiddleware() {
    this.app.use(express.json());
    
    // CORS for Chainlink node
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

    // Main Chainlink external adapter endpoint
    this.app.post('/', async (req, res) => {
      try {
        const { data } = req.body;
        console.log('📨 Chainlink request received:', JSON.stringify(data, null, 2));
        
        const result = await this.handleChainlinkRequest(data);
        
        res.json({
          jobRunID: data.id,
          data: result,
          result: result.value,
          statusCode: 200
        });
        
      } catch (error) {
        console.error('❌ Adapter error:', error.message);
        
        res.status(500).json({
          jobRunID: req.body.data?.id,
          status: 'errored',
          error: error.message,
          statusCode: 500
        });
      }
    });

    // Direct API endpoints for testing
    this.app.get('/best-vault/:asset/:riskLevel?', async (req, res) => {
      try {
        const { asset, riskLevel } = req.params;
        const result = await this.getBestVault(asset, riskLevel || 'medium');
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/vault-apy/:chain/:address', async (req, res) => {
      try {
        const { chain, address } = req.params;
        const result = await this.getVaultAPY(chain, address);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Enhanced APY calculation endpoint
    this.app.get('/enhanced-apy/:chain/:address/:protocol?', async (req, res) => {
      try {
        const { chain, address, protocol } = req.params;
        const { comprehensive } = req.query;
        
        if (comprehensive === 'true') {
          const result = await this.getComprehensiveVaultAnalysis(chain, address, protocol);
          res.json(result);
        } else {
          const result = await this.getEnhancedVaultAPY(chain, address, protocol);
          res.json(result);
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  async collectFromAllSources() {
    console.log('🔄 Collecting from DefiLlama and Vaults.fyi...');
    const [defiLlamaVaults, vaultsFyiVaults] = await Promise.all([
      this.defiLlamaCollector.collectAllVaults(),
      this.vaultsFyiCollector.collectAllVaults()
    ]);

    // Deduplicate vaults by vault_address + chain
    const vaultMap = new Map();

    // Add DefiLlama vaults first
    defiLlamaVaults.forEach(vault => {
      const key = `${vault.vault_address}-${vault.chain}`.toLowerCase();
      vaultMap.set(key, { ...vault, source_priority: 'defillama' });
    });

    // Add Vaults.fyi vaults (will override if better data)
    vaultsFyiVaults.forEach(vault => {
      const key = `${vault.vault_address}-${vault.chain}`.toLowerCase();
      const existing = vaultMap.get(key);
    
      // Prefer Vaults.fyi if it has more complete data or higher TVL
      if (!existing || 
          vault.tvl_usd > existing.tvl_usd || 
          (vault.risk_score && !existing.risk_score)) {
        vaultMap.set(key, { ...vault, source_priority: 'vaultsfyi' });
      }
    });

    const vaults = Array.from(vaultMap.values());
    console.log(`📊 Deduplicated: ${defiLlamaVaults.length} DefiLlama + ${vaultsFyiVaults.length} Vaults.fyi → ${vaults.length} unique vaults`);
  
    return vaults;
  }

  // Add this method to your VaultAPYExternalAdapter class
  async collectFromAllSourcesWithOnChain() {
  console.log('🔄 Collecting from APIs + On-chain validation...');
  
  // Step 1: Get API data (your existing logic)
  const apiVaults = await this.collectFromAllSources();
  
  // Step 2: Select high-value vaults for on-chain validation (only real addresses)
  const highValueVaults = apiVaults
    .filter(vault => 
      vault.tvl_usd > (process.env.ONCHAIN_VALIDATION_MIN_TVL || 10000000) && // $10M+ TVL default
      vault.vault_address && 
      vault.vault_address.startsWith('0x') && // Real contract addresses only
      vault.vault_address.length === 42 // Valid Ethereum address length
    )
    .sort((a, b) => b.tvl_usd - a.tvl_usd) // Sort by TVL desc
    .slice(0, 20); // Top 20 to avoid rate limits
  
  console.log(`🔗 Validating ${highValueVaults.length} high-value vaults on-chain...`);
  
  if (highValueVaults.length === 0) {
    console.log('⚠️ No vaults meet on-chain validation criteria, returning API data only');
    return apiVaults.map(vault => ({
      ...vault,
      data_confidence: 'api_only',
      validation_score: 0
    }));
  }
  
  // Step 3: Get on-chain data for validation
  try {
    const onChainData = await this.onChainCollector.batchGetVaultData(
      highValueVaults.map(vault => ({
        vault_address: vault.vault_address,
        chain: vault.chain,
        protocol: vault.protocol
      }))
    );

    console.log(`📊 Retrieved on-chain data for ${onChainData.length}/${highValueVaults.length} vaults`);

    // Step 4: Enrich API data with on-chain validation
    const enrichedVaults = apiVaults.map(apiVault => {
      const onChainMatch = onChainData.find(onChain => 
        onChain.vault_address.toLowerCase() === apiVault.vault_address.toLowerCase() &&
        onChain.chain === apiVault.chain
      );

      if (onChainMatch) {
        const validation = this.validateVaultData(onChainMatch, apiVault);
        
        return {
          ...apiVault,
          on_chain_data: {
            name: onChainMatch.name,
            symbol: onChainMatch.symbol,
            total_assets: onChainMatch.total_assets,
            asset_symbol: onChainMatch.asset_symbol,
            share_price: onChainMatch.share_price,
            block_number: onChainMatch.block_number,
            vault_type: onChainMatch.vault_type
          },
          validation_score: this.calculateValidationScore(validation),
          data_confidence: this.getConfidenceLevel(validation),
          validation_details: validation
        };
      }

      return {
        ...apiVault,
        data_confidence: 'api_only',
        validation_score: 0
      };
    });

    console.log(`📊 Final: ${enrichedVaults.length} vaults (${onChainData.length} with on-chain validation)`);
    
    return enrichedVaults;
    
  } catch (error) {
    console.error('❌ On-chain validation failed:', error.message);
    console.log('📊 Falling back to API data only');
    
    return apiVaults.map(vault => ({
      ...vault,
      data_confidence: 'api_only',
      validation_score: 0
    }));
  }
  }

  // Helper method to validate API data against on-chain data
  validateVaultData(onChainData, apiData) {
  const validations = {
    name_similarity: false,
    asset_match: false,
    tvl_reasonable: false,
    data_freshness: 'unknown',
    has_real_address: false
  };

  try {
    // Check if vault has a real contract address
    validations.has_real_address = onChainData.vault_address && 
      onChainData.vault_address.startsWith('0x') && 
      onChainData.vault_address.length === 42;

    // Check name similarity (loose matching)
    if (onChainData.name && apiData.name) {
      const onChainName = onChainData.name.toLowerCase();
      const apiName = apiData.name.toLowerCase();
      
      // Check if they share common words or patterns
      validations.name_similarity = 
        onChainName.includes(apiData.protocol?.toLowerCase() || '') ||
        apiName.includes(onChainData.symbol?.toLowerCase() || '') ||
        this.calculateStringSimilarity(onChainName, apiName) > 0.3;
    }

    // Check asset symbol match
    if (onChainData.asset_symbol && apiData.asset_symbol) {
      validations.asset_match = onChainData.asset_symbol.toLowerCase() === 
        apiData.asset_symbol.toLowerCase();
    }

    // Check if TVL is in reasonable range (don't expect exact match due to different data sources)
    if (onChainData.total_assets && apiData.tvl_usd) {
      const onChainTVL = parseFloat(onChainData.total_assets);
      const apiTVL = apiData.tvl_usd;
      
      // Consider reasonable if within 50% (API data can be USD value, on-chain is token amount)
      if (onChainTVL > 0 && apiTVL > 0) {
        const ratio = Math.min(onChainTVL, apiTVL) / Math.max(onChainTVL, apiTVL);
        validations.tvl_reasonable = ratio > 0.5 || 
          (onChainTVL > 1000 && apiTVL > 100000) || // Different units but both substantial
          (onChainTVL > 100000 && apiTVL > 1000000); // Different scales but both large
      }
    }

    // Data freshness (block age)
    if (onChainData.timestamp) {
      const blockAge = Date.now() - onChainData.timestamp;
      if (blockAge < 300000) validations.data_freshness = 'fresh'; // < 5 minutes
      else if (blockAge < 3600000) validations.data_freshness = 'recent'; // < 1 hour  
      else validations.data_freshness = 'stale';
    }

  } catch (error) {
    console.error('Validation error:', error.message);
  }

  return validations;
  }

  // Helper method to calculate string similarity
  calculateStringSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = this.levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
  }

  // Simple Levenshtein distance implementation
  levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
  }

  // Calculate validation score (0-100)
  calculateValidationScore(validation) {
  let score = 0;
  
  if (validation.has_real_address) score += 30; // Most important
  if (validation.asset_match) score += 25;      // Very important
  if (validation.name_similarity) score += 20;  // Important
  if (validation.tvl_reasonable) score += 15;   // Somewhat important
  
  // Freshness bonus
  if (validation.data_freshness === 'fresh') score += 10;
  else if (validation.data_freshness === 'recent') score += 5;
  
  return Math.min(score, 100);
  }

  // Get confidence level based on validation
  getConfidenceLevel(validation) {
  const score = this.calculateValidationScore(validation);
  
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium-high';
  if (score >= 40) return 'medium';
  if (score >= 20) return 'medium-low';
  return 'low';
  }

  async handleChainlinkRequest(data) {
    const {
      asset = 'USDC',
      risk_level = 'medium',
      chain,
      vault_address,
      vault_addresses, // NEW
      criteria, // NEW
      request_type = 'best_vault'
    } = data;

    switch (request_type) {
      case 'best_vault':
        return await this.getBestVault(asset, risk_level, chain);
    
      case 'vault_apy':
        if (!vault_address) throw new Error('vault_address required for vault_apy request');
        return await this.getVaultAPY(chain, vault_address);
    
      case 'top_vaults':
        const limit = data.limit || 10;
        const minTvl = data.min_tvl || 0;
        return await this.getTopVaults(asset, risk_level, chain, limit, minTvl);
    
      case 'batch_vault_lookup': // NEW
        return await this.getBatchVaultData(vault_addresses, criteria);
    
      case 'custom_search': // NEW
        return await this.getCustomVaultSearch(criteria);
    
      case 'compare_vaults': // NEW
        return await this.compareSpecificVaults(vault_addresses);

      case 'enhanced_best_vault': // NEW - Enhanced APY calculation
        return await this.getBestVaultWithCalculatedAPY(asset, risk_level, chain);
    
      default:
        throw new Error(`Unknown request_type: ${request_type}`);
    }
  }

  async getBestVault(asset = 'USDC', riskLevel = 'medium', chain = null) {
    try {
      console.log(`🔍 Finding best vault for ${asset} with ${riskLevel} risk${chain ? ` on ${chain}` : ''}`);
      
      // Get fresh data from BOTH sources
      const vaults = process.env.ENABLE_ONCHAIN_VALIDATION === 'true'
        ? await this.collectFromAllSourcesWithOnChain()
        : await this.collectFromAllSources();

      // Filter by asset and chain if specified
      let filteredVaults = vaults.filter(vault => 
        vault.asset_symbol.toUpperCase() === asset.toUpperCase()
      );
      
      if (chain) {
        filteredVaults = filteredVaults.filter(vault => 
          vault.chain.toLowerCase() === chain.toLowerCase()
        );
      }

      // Apply risk filtering
      const safeVaults = this.riskScorer.filterByRiskTolerance(filteredVaults, riskLevel);
      
      if (safeVaults.length === 0) {
        throw new Error(`No vaults found for ${asset} with ${riskLevel} risk level`);
      }

      // Sort by risk-adjusted APY
      const bestVault = safeVaults
        .map(vault => ({
          ...vault,
          risk_adjusted_apy: this.riskScorer.getRiskAdjustedAPY(vault.apy, vault.risk_score)
        }))
        .sort((a, b) => {
          const confidenceA = a.validation_score || 0;
          const confidenceB = b.validation_score || 0;
          
          if (Math.abs(confidenceA-confidenceB) >20) {
            return confidenceB - confidenceA;
          }
          
          return b.risk_adjusted_apy - a.risk_adjusted_apy;
        })[0];

      // Save to database
      await this.saveVaultData([bestVault]);

      return {
        vault_address: bestVault.vault_address,
        apy: bestVault.apy,
        risk_adjusted_apy: bestVault.risk_adjusted_apy,
        risk_score: bestVault.risk_score,
        risk_category: bestVault.risk_category,
        tvl_usd: bestVault.tvl_usd,
        protocol: bestVault.protocol,
        chain: bestVault.chain,
        name: bestVault.name,
        value: bestVault.apy * 100, // Chainlink often expects integer values
        timestamp: Date.now()
      };

    } catch (error) {
      console.error('getBestVault error:', error.message);
      throw error;
    }
  }

  async getVaultAPY(chain, vaultAddress) {
    try {
      console.log(`📊 Getting APY for vault ${vaultAddress} on ${chain}`);
      
      // First check database for recent data
      const client = await this.pool.connect();
      
      try {
        const result = await client.query(`
          SELECT v.*, vm.apy, vm.tvl_usd, vm.risk_score, vm.timestamp
          FROM vaults v
          LEFT JOIN vault_metrics vm ON v.vault_address = vm.vault_address
          WHERE v.vault_address = $1 AND v.chain = $2
          ORDER BY vm.timestamp DESC
          LIMIT 1
        `, [vaultAddress, chain.toLowerCase()]);

        if (result.rows.length > 0) {
          const vault = result.rows[0];
          const age = Date.now() - new Date(vault.timestamp).getTime();
          
          // Use cached data if less than 15 minutes old
          if (age < 15 * 60 * 1000) {
            return {
              vault_address: vault.vault_address,
              apy: parseFloat(vault.apy),
              tvl_usd: parseInt(vault.tvl_usd),
              risk_score: vault.risk_score,
              protocol: vault.protocol,
              chain: vault.chain,
              name: vault.name,
              value: parseFloat(vault.apy) * 100,
              cached: true,
              timestamp: vault.timestamp
            };
          }
        }

        // Get fresh data from BOTH sources
       console.log('🔄 Collecting from both DefiLlama and Vaults.fyi...');
       const vaults = await this.collectFromAllSources();
       console.log('📊 Got ${vaults.length} total vaults from combined sources');
        const targetVault = vaults.find(v => 
          v.vault_address.toLowerCase() === vaultAddress.toLowerCase() &&
          v.chain.toLowerCase() === chain.toLowerCase()
        );

        if (!targetVault) {
          throw new Error('Vault ${vaultAddress} not found on ${chain}');
        }

        // Calculate risk score
        const riskAnalysis = this.riskScorer.calculateRiskScore(targetVault);
        const enrichedVault = {
          ...targetVault,
          risk_score: riskAnalysis.riskScore,
          risk_category: riskAnalysis.riskCategory
        };

        // Save fresh data
        await this.saveVaultData([enrichedVault]);

        return {
          vault_address: enrichedVault.vault_address,
          apy: enrichedVault.apy,
          tvl_usd: enrichedVault.tvl_usd,
          risk_score: enrichedVault.risk_score,
          risk_category: enrichedVault.risk_category,
          protocol: enrichedVault.protocol,
          chain: enrichedVault.chain,
          name: enrichedVault.name,
          value: enrichedVault.apy * 100,
          cached: false,
          timestamp: new Date().toISOString()
        };

      } finally {
        client.release();
      }

    } catch (error) {
      console.error('getVaultAPY error:', error.message);
      throw error;
    }
  }

  async getTopVaults(asset = 'USDC', riskLevel = 'medium', chain = null, limit = 10, minTvl = 0) {
    try {
      // Get fresh data from BOTH sources
      console.log('🔄 Collecting from both DefiLlama and Vaults.fyi...');
      const vaults = await this.collectFromAllSources();
      console.log(`📊 Got ${vaults.length} total vaults from combined sources`);
      
      let filteredVaults = vaults.filter(vault => 
        vault.asset_symbol.toUpperCase() === asset.toUpperCase()
      );
      
      if (chain) {
        filteredVaults = filteredVaults.filter(vault => 
          vault.chain.toLowerCase() === chain.toLowerCase()
        );
      }

      // Apply minimum TVL filter
      if (minTvl > 0) {
        filteredVaults = filteredVaults.filter(vault => 
          vault.tvl_usd >= minTvl
        );
      }

      const safeVaults = this.riskScorer.filterByRiskTolerance(filteredVaults, riskLevel);
      
      const topVaults = safeVaults
        .map(vault => ({
          ...vault,
          risk_adjusted_apy: this.riskScorer.getRiskAdjustedAPY(vault.apy, vault.risk_score)
        }))
        .sort((a, b) => b.risk_adjusted_apy - a.risk_adjusted_apy)
        .slice(0, limit);

      return {
        vaults: topVaults.map(vault => ({
          vault_address: vault.vault_address,
          apy: vault.apy,
          apy_percentage: vault.apy * 100,
          risk_adjusted_apy: vault.risk_adjusted_apy,
          risk_score: vault.risk_score,
          tvl_usd: vault.tvl_usd,
          protocol: vault.protocol,
          chain: vault.chain,
          name: vault.name,
          confidence: vault.validation_score || 50, // Default confidence
          data_source: vault.data_source || 'api'
        })),
        count: topVaults.length,
        timestamp: Date.now(),
        value: topVaults[0]?.apy * 100 || 0 // Return best APY as value
      };

    } catch (error) {
      console.error('getTopVaults error:', error.message);
      throw error;
    }
  }

  async saveVaultData(vaultDataArray) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      for (const vaultData of vaultDataArray) {
        // Upsert vault
        await client.query(`
          INSERT INTO vaults (vault_address, chain, protocol, name, asset_symbol)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (vault_address) 
          DO UPDATE SET 
            updated_at = CURRENT_TIMESTAMP,
            name = EXCLUDED.name
        `, [
          vaultData.vault_address,
          vaultData.chain,
          vaultData.protocol,
          vaultData.name,
          vaultData.asset_symbol
        ]);

        // Insert metrics
        await client.query(`
          INSERT INTO vault_metrics 
          (vault_address, apy, apr, tvl_usd, risk_score, data_source)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          vaultData.vault_address,
          vaultData.apy,
          vaultData.apr || vaultData.apy,
          vaultData.tvl_usd,
          vaultData.risk_score,
          vaultData.data_source
        ]);
      }

      await client.query('COMMIT');
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  async getBatchVaultData(vaultAddresses, criteria = {}) {
    try {
      console.log(`🔍 Batch lookup for ${vaultAddresses.length} vaults`);
    
      const results = [];
      const client = await this.pool.connect();
    
      try {
        // Get fresh data for vaults not in DB or outdated
        const freshVaults = await this.collectFromAllSources();
        console.log(`📊 Got ${freshVaults.length} total vaults from combined sources`);
      
        for (const vaultAddress of vaultAddresses) {
          try {
            // First check database
            const dbResult = await client.query(`
              SELECT v.*, vm.apy, vm.tvl_usd, vm.risk_score, vm.timestamp
              FROM vaults v
              LEFT JOIN vault_metrics vm ON v.vault_address = vm.vault_address
              WHERE v.vault_address = $1
              ORDER BY vm.timestamp DESC
              LIMIT 1
            `, [vaultAddress]);

            let vaultData;
          
            if (dbResult.rows.length > 0) {
              const vault = dbResult.rows[0];
              const age = Date.now() - new Date(vault.timestamp).getTime();
            
              // Use cached data if less than 15 minutes old
              if (age < 15 * 60 * 1000) {
                vaultData = {
                  vault_address: vault.vault_address,
                  name: vault.name,
                  protocol: vault.protocol,
                  chain: vault.chain,
                  apy: parseFloat(vault.apy),
                  tvl_usd: parseInt(vault.tvl_usd),
                  risk_score: vault.risk_score,
                  cached: true
                };
              }
            }
          
            // If no cached data, get from fresh API data
            if (!vaultData) {
              const freshVault = freshVaults.find(v => 
                v.vault_address.toLowerCase() === vaultAddress.toLowerCase()
              );
              
              if (freshVault) {
                const riskAnalysis = this.riskScorer.calculateRiskScore(freshVault);
                vaultData = {
                  vault_address: freshVault.vault_address,
                  name: freshVault.name,
                  protocol: freshVault.protocol,
                  chain: freshVault.chain,
                  apy: freshVault.apy,
                  tvl_usd: freshVault.tvl_usd,
                  risk_score: riskAnalysis.riskScore,
                  risk_category: riskAnalysis.riskCategory,
                  cached: false
                };
              
                // Save fresh data
                await this.saveVaultData([{...freshVault, risk_score: riskAnalysis.riskScore}]);
              }
            }
          
            if (vaultData) {
              // Apply criteria filters if specified
              if (this.matchesCriteria(vaultData, criteria)) {
                results.push({
                  ...vaultData,
                  risk_adjusted_apy: this.riskScorer.getRiskAdjustedAPY(vaultData.apy, vaultData.risk_score)
                });
              }
            } else {
              results.push({
                vault_address: vaultAddress,
                error: 'Vault not found',
                found: false
              });
            }
          
          } catch (error) {
            results.push({
              vault_address: vaultAddress,
              error: error.message,
              found: false
            });
          }
        }
      
        // Sort results by risk-adjusted APY (highest first)
        const validResults = results.filter(r => r.found !== false);
        const errorResults = results.filter(r => r.found === false);
      
        validResults.sort((a, b) => (b.risk_adjusted_apy || 0) - (a.risk_adjusted_apy || 0));
      
        return {
          vaults: validResults,
          errors: errorResults,
          total_requested: vaultAddresses.length,
          total_found: validResults.length,
          best_vault: validResults[0] || null,
          value: validResults[0]?.apy * 100 || 0, // Return best APY as primary value
          timestamp: Date.now()
        };
      
      } finally {
        client.release();
      }
    
    } catch (error) {
      console.error('Batch vault lookup error:', error.message);
      throw error;
    }
  }

  async getCustomVaultSearch(criteria) {
    try {
      console.log(`🔍 Custom search with criteria:`, criteria);
    
      const {
        asset = 'USDC',
        min_apy = 0,
        max_apy = 1000,
        min_tvl = 0,
        max_tvl = 10000000000,
        risk_min = 0,
        risk_max = 100,
        protocols = [],
        chains = [],
        exclude_protocols = [],
        limit = 10
      } = criteria;
    
      // Get fresh data from BOTH sources
      console.log('🔄 Collecting from both DefiLlama and Vaults.fyi...');
      const vaults = await this.collectFromAllSources();
    
      // Apply filters
      let filteredVaults = vaults.filter(vault => {
        // Asset filter
        if (vault.asset_symbol.toUpperCase() !== asset.toUpperCase()) return false;
      
        // APY range
        if (vault.apy < min_apy || vault.apy > max_apy) return false;
      
        // TVL range
        if (vault.tvl_usd < min_tvl || vault.tvl_usd > max_tvl) return false;
      
        // Protocol filters
        if (protocols.length > 0 && !protocols.includes(vault.protocol)) return false;
        if (exclude_protocols.length > 0 && exclude_protocols.includes(vault.protocol)) return false;
      
        // Chain filters
        if (chains.length > 0 && !chains.includes(vault.chain)) return false;
      
        return true;
      });
    
      // Add risk scores and filter by risk
      const enrichedVaults = filteredVaults.map(vault => {
        const riskAnalysis = this.riskScorer.calculateRiskScore(vault);
        return {
          ...vault,
          risk_score: riskAnalysis.riskScore,
          risk_category: riskAnalysis.riskCategory,
          risk_adjusted_apy: this.riskScorer.getRiskAdjustedAPY(vault.apy, riskAnalysis.riskScore)
        };
      }).filter(vault => 
        vault.risk_score >= risk_min && vault.risk_score <= risk_max
      );
    
      // Sort by risk-adjusted APY and limit results
      const topVaults = enrichedVaults
        .sort((a, b) => b.risk_adjusted_apy - a.risk_adjusted_apy)
        .slice(0, limit);
    
      return {
        vaults: topVaults.map(vault => ({
          vault_address: vault.vault_address,
          name: vault.name,
          protocol: vault.protocol,
          chain: vault.chain,
          apy: vault.apy,
          risk_adjusted_apy: vault.risk_adjusted_apy,
          risk_score: vault.risk_score,
          tvl_usd: vault.tvl_usd
        })),
        total_matching: enrichedVaults.length,
        criteria_applied: criteria,
        best_vault: topVaults[0] || null,
        value: topVaults[0]?.apy * 100 || 0,
        timestamp: Date.now()
      };
    
    } catch (error) {
      console.error('Custom search error:', error.message);
      throw error;
    }
  }

  async compareSpecificVaults(vaultAddresses) {
    try {
      console.log(`⚖️ Comparing ${vaultAddresses.length} specific vaults`);
    
      const batchResult = await this.getBatchVaultData(vaultAddresses);
      const validVaults = batchResult.vaults;
    
      if (validVaults.length === 0) {
        throw new Error('No valid vaults found for comparison');
      }
    
      // Calculate comparison metrics
      const comparison = {
        vaults: validVaults.map(vault => ({
          vault_address: vault.vault_address,
          name: vault.name,
          protocol: vault.protocol,
          chain: vault.chain,
          apy: vault.apy,
          risk_adjusted_apy: vault.risk_adjusted_apy,
          risk_score: vault.risk_score,
          tvl_usd: vault.tvl_usd,
          rank_by_apy: 0, // Will fill these below
          rank_by_risk_adjusted: 0,
          rank_by_safety: 0
        })),
        summary: {
          highest_apy: Math.max(...validVaults.map(v => v.apy)),
          lowest_apy: Math.min(...validVaults.map(v => v.apy)),
          highest_risk_adjusted_apy: Math.max(...validVaults.map(v => v.risk_adjusted_apy)),
          safest_vault: validVaults.reduce((prev, current) => 
            (prev.risk_score > current.risk_score) ? prev : current
          ),
          recommendation: null // Will set below
        }
      };
    
      // Add rankings
      const sortedByAPY = [...comparison.vaults].sort((a, b) => b.apy - a.apy);
      const sortedByRiskAdjusted = [...comparison.vaults].sort((a, b) => b.risk_adjusted_apy - a.risk_adjusted_apy);
      const sortedBySafety = [...comparison.vaults].sort((a, b) => b.risk_score - a.risk_score);
    
      comparison.vaults.forEach(vault => {
        vault.rank_by_apy = sortedByAPY.findIndex(v => v.vault_address === vault.vault_address) + 1;
        vault.rank_by_risk_adjusted = sortedByRiskAdjusted.findIndex(v => v.vault_address === vault.vault_address) + 1;
        vault.rank_by_safety = sortedBySafety.findIndex(v => v.vault_address === vault.vault_address) + 1;
      });
    
      // Set recommendation (best risk-adjusted APY)
      comparison.summary.recommendation = sortedByRiskAdjusted[0];
    
      return {
        comparison,
        total_compared: validVaults.length,
        best_vault: comparison.summary.recommendation,
        value: comparison.summary.recommendation.apy * 100,
        timestamp: Date.now()
      };
    
    } catch (error) {
      console.error('Vault comparison error:', error.message);
      throw error;
    }
  }

  matchesCriteria(vaultData, criteria) {
    if (!criteria || Object.keys(criteria).length === 0) return true;
  
    const {
      min_apy = 0,
      max_apy = 1000,
      min_risk = 0,
      max_risk = 100,
      required_chains = [],
      required_protocols = []
    } = criteria;
  
    if (vaultData.apy < min_apy || vaultData.apy > max_apy) return false;
    if (vaultData.risk_score < min_risk || vaultData.risk_score > max_risk) return false;
    if (required_chains.length > 0 && !required_chains.includes(vaultData.chain)) return false;
    if (required_protocols.length > 0 && !required_protocols.includes(vaultData.protocol)) return false;
  
    return true;
  }

  /**
   * Enhanced APY calculation for a specific vault
   */
  async getEnhancedVaultAPY(chain, vaultAddress, protocol = null) {
    try {
      console.log(`🔬 Enhanced APY calculation for ${vaultAddress} on ${chain}`);
      
      // If no protocol provided, try to determine from vault data
      if (!protocol) {
        const vaults = await this.collectFromAllSources();
        const matchingVault = vaults.find(v => 
          v.vault_address.toLowerCase() === vaultAddress.toLowerCase() &&
          v.chain.toLowerCase() === chain.toLowerCase()
        );
        protocol = matchingVault?.protocol || 'unknown';
      }

      const enhancedData = await this.enhancedOnChainCollector.getVaultDataWithCalculatedAPY(
        vaultAddress, 
        chain, 
        protocol
      );

      if (!enhancedData) {
        throw new Error('Failed to get enhanced vault data');
      }

      return {
        vault_address: vaultAddress,
        chain: chain,
        protocol: protocol,
        calculated_apy: enhancedData.calculated_apy,
        apy_percentage: enhancedData.calculated_apy ? (enhancedData.calculated_apy * 100) : null,
        calculation_method: enhancedData.apy_calculation_method,
        confidence_score: enhancedData.confidence_score,
        calculation_details: enhancedData.calculation_details,
        on_chain_data: {
          name: enhancedData.name,
          symbol: enhancedData.symbol,
          total_assets: enhancedData.total_assets,
          share_price: enhancedData.share_price
        },
        timestamp: enhancedData.calculation_timestamp || Date.now(),
        enhanced_calculation: true
      };

    } catch (error) {
      console.error(`❌ Enhanced APY calculation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Comprehensive vault analysis with multiple APY calculation methods
   */
  async getComprehensiveVaultAnalysis(chain, vaultAddress, protocol = null) {
    try {
      console.log(`📊 Comprehensive analysis for ${vaultAddress} on ${chain}`);
      
      if (!protocol) {
        const vaults = await this.collectFromAllSources();
        const matchingVault = vaults.find(v => 
          v.vault_address.toLowerCase() === vaultAddress.toLowerCase() &&
          v.chain.toLowerCase() === chain.toLowerCase()
        );
        protocol = matchingVault?.protocol || 'unknown';
      }

      const comprehensiveData = await this.enhancedOnChainCollector.getComprehensiveVaultAnalysis(
        vaultAddress, 
        chain, 
        protocol
      );

      if (!comprehensiveData) {
        throw new Error('Failed to get comprehensive vault analysis');
      }

      return {
        vault_address: vaultAddress,
        chain: chain,
        protocol: protocol,
        
        // Best APY calculation
        best_apy: comprehensiveData.calculated_apy,
        best_apy_percentage: comprehensiveData.calculated_apy ? (comprehensiveData.calculated_apy * 100) : null,
        confidence_score: comprehensiveData.confidence_score,
        
        // All calculation methods
        calculation_methods: comprehensiveData.calculation_methods,
        
        // Individual calculations
        protocol_specific: comprehensiveData.protocol_apy ? {
          apy: comprehensiveData.protocol_apy.calculated_apy,
          apy_percentage: comprehensiveData.protocol_apy.calculated_apy * 100,
          method: comprehensiveData.protocol_apy.method,
          confidence: comprehensiveData.protocol_apy.confidence_score
        } : null,
        
        weekly_historical: comprehensiveData.weekly_apy ? {
          apy: comprehensiveData.weekly_apy.calculated_apy,
          apy_percentage: comprehensiveData.weekly_apy.calculated_apy * 100,
          method: comprehensiveData.weekly_apy.method,
          confidence: comprehensiveData.weekly_apy.confidence_score
        } : null,
        
        monthly_historical: comprehensiveData.monthly_apy ? {
          apy: comprehensiveData.monthly_apy.calculated_apy,
          apy_percentage: comprehensiveData.monthly_apy.calculated_apy * 100,
          method: comprehensiveData.monthly_apy.method,
          confidence: comprehensiveData.monthly_apy.confidence_score
        } : null,
        
        // On-chain data
        on_chain_data: {
          name: comprehensiveData.name,
          symbol: comprehensiveData.symbol,
          total_assets: comprehensiveData.total_assets,
          share_price: comprehensiveData.share_price,
          vault_type: comprehensiveData.vault_type
        },
        
        analysis_timestamp: comprehensiveData.analysis_timestamp,
        comprehensive_analysis: true
      };

    } catch (error) {
      console.error(`❌ Comprehensive analysis failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Enhanced version of getBestVault that uses calculated APYs
   */
  async getBestVaultWithCalculatedAPY(asset = 'USDC', riskLevel = 'medium', chain = null) {
    try {
      console.log(`🎯 Finding best vault with calculated APY for ${asset} (${riskLevel} risk)`);
      
      // Get fresh data from sources
      const vaults = process.env.ENABLE_ONCHAIN_VALIDATION === 'true'
        ? await this.collectFromAllSourcesWithOnChain()
        : await this.collectFromAllSources();

      // Filter by asset and chain
      let filteredVaults = vaults.filter(vault => 
        vault.asset_symbol.toUpperCase() === asset.toUpperCase()
      );
      
      if (chain) {
        filteredVaults = filteredVaults.filter(vault => 
          vault.chain.toLowerCase() === chain.toLowerCase()
        );
      }

      // Apply risk filtering
      const safeVaults = this.riskScorer.filterByRiskTolerance(filteredVaults, riskLevel);
      
      if (safeVaults.length === 0) {
        throw new Error(`No vaults found for ${asset} with ${riskLevel} risk level`);
      }

      // Separate real addresses from UUIDs for different processing
      const realAddressCandidates = safeVaults.filter(vault => this.isEthereumAddress(vault.vault_address));
      const uuidCandidates = safeVaults.filter(vault => !this.isEthereumAddress(vault.vault_address));

      console.log(`📊 Found ${realAddressCandidates.length} real addresses and ${uuidCandidates.length} UUID vaults`);

      // Get top candidates from each category
      const topRealAddresses = realAddressCandidates
        .sort((a, b) => b.tvl_usd - a.tvl_usd)
        .slice(0, 3); // Top 3 real addresses

      const topUUIDs = uuidCandidates
        .sort((a, b) => b.tvl_usd - a.tvl_usd)
        .slice(0, 3); // Top 3 UUIDs

      const topCandidates = [...topRealAddresses, ...topUUIDs];
      console.log(`🔬 Calculating enhanced APYs for ${topCandidates.length} top candidates (${topRealAddresses.length} real + ${topUUIDs.length} UUID)`);

      const enhancedCandidates = [];
      for (const vault of topCandidates) {
        try {
          const enhancedData = await this.enhancedOnChainCollector.getSmartCalculatedAPY(
            vault.vault_address,
            vault.chain,
            vault.protocol
          );

          if (enhancedData && enhancedData.calculated_apy) {
            enhancedCandidates.push({
              ...vault,
              calculated_apy: enhancedData.calculated_apy,
              apy_confidence: enhancedData.confidence_score,
              calculation_method: enhancedData.method,
              enhanced_apy: true
            });
          } else {
            // Fallback to API APY
            enhancedCandidates.push({
              ...vault,
              enhanced_apy: false
            });
          }
        } catch (error) {
          console.log(`⚠️ Enhanced APY failed for ${vault.vault_address}: ${error.message}`);
          enhancedCandidates.push({
            ...vault,
            enhanced_apy: false
          });
        }
      }

      // Sort by calculated APY (prefer enhanced calculations)
      const bestVault = enhancedCandidates
        .map(vault => ({
          ...vault,
          final_apy: vault.calculated_apy || vault.apy,
          risk_adjusted_apy: this.riskScorer.getRiskAdjustedAPY(
            vault.calculated_apy || vault.apy, 
            vault.risk_score
          )
        }))
        .sort((a, b) => {
          // Prefer enhanced calculations
          if (a.enhanced_apy && !b.enhanced_apy) return -1;
          if (!a.enhanced_apy && b.enhanced_apy) return 1;
          
          // Then sort by confidence and APY
          const confidenceA = a.apy_confidence || 0;
          const confidenceB = b.apy_confidence || 0;
          
          if (Math.abs(confidenceA - confidenceB) > 0.2) {
            return confidenceB - confidenceA;
          }
          
          return b.risk_adjusted_apy - a.risk_adjusted_apy;
        })[0];

      return {
        vault_address: bestVault.vault_address,
        apy: bestVault.final_apy,
        calculated_apy: bestVault.calculated_apy || null,
        apy_confidence: bestVault.apy_confidence || 0,
        calculation_method: bestVault.calculation_method || 'api_only',
        enhanced_calculation: bestVault.enhanced_apy,
        risk_adjusted_apy: bestVault.risk_adjusted_apy,
        risk_score: bestVault.risk_score,
        risk_category: bestVault.risk_category,
        tvl_usd: bestVault.tvl_usd,
        protocol: bestVault.protocol,
        chain: bestVault.chain,
        name: bestVault.name,
        value: Math.round((bestVault.calculated_apy || bestVault.apy) * 100),
        timestamp: Date.now()
      };

    } catch (error) {
      console.error(`❌ Enhanced best vault calculation failed: ${error.message}`);
      throw error;
    }
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`🚀 Vault APY External Adapter running on port ${this.port}`);
      console.log(`📡 Chainlink endpoint: http://localhost:${this.port}`);
      console.log(`🔍 Health check: http://localhost:${this.port}/health`);
    });
  }
}

// Start the adapter if this file is run directly
if (require.main === module) {
  require('dotenv').config({ path: '.env.local' });
  
  const adapter = new VaultAPYExternalAdapter();
  adapter.start();
}

module.exports = VaultAPYExternalAdapter;