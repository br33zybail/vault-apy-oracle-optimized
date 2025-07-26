// src/collectors/api/defillama-collector.js
// Updated DeFiLlama Collector - Traditional Lending Vaults Only
const axios = require('axios');

class FilteredDefiLlamaCollector {
  constructor() {
    this.baseUrl = 'https://yields.llama.fi';
    this.rateLimitDelay = 1000;
  }

  async collectAllVaults() {
    try {
      console.log('🦙 Fetching USDC vault data from DefiLlama...');

      // Parallel requests for better performance
      const [poolsResponse, yieldsResponse] = await Promise.allSettled([
        axios.get(`${this.baseUrl}/pools`, {
          timeout: 20000,
          headers: {
            'User-Agent': 'VaultAPYOracle/1.0'
          }
        }),
        // Optional: Get additional yield data if available
        axios.get(`${this.baseUrl}/yields`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'VaultAPYOracle/1.0'
          }
        }).catch(() => null) // Ignore errors for optional data
      ]);

      if (poolsResponse.status !== 'fulfilled') {
        throw new Error('Failed to fetch pools data');
      }

      const pools = poolsResponse.value.data.data;
      console.log(`📊 DefiLlama returned ${pools.length} total pools`);

      // Filter for USDC lending vaults with parallel processing
      const targetChains = ['ethereum', 'polygon', 'arbitrum', 'base', 'optimism'];
      
      // Split pools into chunks for parallel processing
      const chunkSize = Math.ceil(pools.length / 4);
      const poolChunks = [];
      for (let i = 0; i < pools.length; i += chunkSize) {
        poolChunks.push(pools.slice(i, i + chunkSize));
      }
      
      // Process chunks in parallel
      const filteredChunks = await Promise.all(
        poolChunks.map(chunk => 
          Promise.resolve(chunk.filter(pool => {
            // Must have USDC exposure
            const hasUSDC = pool.symbol?.toUpperCase().includes('USDC') ||
                           pool.underlyingTokens?.some(token =>
                             token.toLowerCase().includes('usdc'));
            if (!hasUSDC) return false;
            
            // Must be on target chains
            const isTargetChain = targetChains.includes(pool.chain?.toLowerCase());
            if (!isTargetChain) return false;
            
            // Must have reasonable TVL and APY
            const hasMinTVL = (pool.tvlUsd || 0) > 100000; // $100k min
            const hasReasonableAPY = (pool.apy || 0) > 0 && (pool.apy || 0) < 100; // 0-100% APY range
            if (!hasMinTVL || !hasReasonableAPY) return false;
            
            // Must have a valid pool ID
            const hasValidPoolId = pool.pool && typeof pool.pool === 'string';
            if (!hasValidPoolId) return false;
            
            // Exclude obvious LP pools
            const notLPPool = !this.isLiquidityPool(pool);
            if (!notLPPool) return false;
            
            return true;
          }))
        )
      );
      
      const lendingVaults = filteredChunks.flat();

      console.log(`📈 Found ${lendingVaults.length} USDC vaults from DefiLlama`);
      console.log(`📋 Protocol breakdown:`, this.getProtocolBreakdown(lendingVaults));

      // Parallel normalization
      const normalizedVaults = await Promise.all(
        lendingVaults.map(pool => Promise.resolve(this.normalizeVaultData(pool)))
      );
      
      return normalizedVaults;

    } catch (error) {
      console.error('❌ DeFiLlama lending vault collection failed:', error.message);
      return [];
    }
  }

  isLiquidityPool(pool) {
    const lpIndicators = [
      'uniswap', 'curve', 'balancer', 'sushiswap',
      'pancakeswap', 'trader-joe', 'kyberswap',
      'camelot', 'velodrome', 'aerodrome'
    ];
    
    const project = pool.project?.toLowerCase() || '';
    const symbol = pool.symbol?.toLowerCase() || '';
    
    // Check if it's a known LP protocol
    if (lpIndicators.some(indicator => project.includes(indicator))) {
      return true;
    }
    
    // Check for LP pool naming patterns
    if (symbol.includes('-') && (symbol.includes('usdc') || symbol.includes('eth'))) {
      return true;
    }
    
    // Check for multiple underlying tokens (LP characteristic)
    if (pool.underlyingTokens && pool.underlyingTokens.length > 1) {
      return true;
    }
    
    return false;
  }

  getProtocolBreakdown(vaults) {
    const breakdown = {};
    vaults.forEach(vault => {
      const protocol = vault.project;
      breakdown[protocol] = (breakdown[protocol] || 0) + 1;
    });
    return breakdown;
  }

  normalizeVaultData(pool) {
    return {
      vault_address: pool.pool,
      chain: pool.chain?.toLowerCase(),
      protocol: this.normalizeProtocolName(pool.project),
      name: `${pool.project} ${pool.symbol}`,
      asset_symbol: this.extractMainAsset(pool),
      asset_address: null,
      apy: parseFloat(pool.apy || 0),
      apr: parseFloat(pool.apyBase || 0),
      tvl_usd: parseInt(pool.tvlUsd || 0),
      utilization_rate: null,
      risk_score: null,
      data_source: 'defillama',
      reward_apy: parseFloat(pool.apyReward || 0),
      stable_coin: pool.stablecoin || false,
      il_risk: null, // Not applicable to lending vaults
      count: pool.count || null,
      mu: pool.mu || null,
      sigma: pool.sigma || null,
      vault_type: 'lending',
      raw_data: JSON.stringify(pool)
    };
  }

  normalizeProtocolName(project) {
    const mapping = {
      'aave-v3': 'aave-v3',
      'aave-v2': 'aave-v2', 
      'aave': 'aave',
      'compound-v3': 'compound-v3',
      'compound-v2': 'compound-v2',
      'compound': 'compound',
      'morpho-blue': 'morpho',
      'morpho-aave': 'morpho',
      'morpho-compound': 'morpho',
      'morpho': 'morpho',
      'euler-v2': 'euler',
      'euler': 'euler',
      'yearn-finance': 'yearn',
      'yearn': 'yearn'
    };
    
    return mapping[project?.toLowerCase()] || project;
  }

  extractMainAsset(pool) {
    if (pool.symbol?.toUpperCase().includes('USDC')) return 'USDC';
    if (pool.underlyingTokens?.some(t => t.toLowerCase().includes('usdc'))) return 'USDC';
    if (pool.symbol?.toUpperCase().includes('USDT')) return 'USDT';
    if (pool.symbol?.toUpperCase().includes('DAI')) return 'DAI';
    if (pool.symbol?.toUpperCase().includes('ETH')) return 'ETH';
    return 'UNKNOWN';
  }
}

// Updated Vaults.fyi Collector - Traditional Lending Vaults Only
class FilteredVaultsFyiCollector {
  constructor() {
    this.baseUrl = 'https://api.vaults.fyi';
    this.apiKey = process.env.VAULTS_FYI_API_KEY;
    
    // Traditional lending protocols
    this.lendingProtocols = [
      'aave', 'compound', 'morpho', 'euler', 'yearn',
      'radiant', 'venus', 'benqi', 'ionic', 'silo',
      'fluid', 'tender'
    ];
  }

  async collectAllVaults() {
    try {
      console.log('🏦 Fetching LENDING vault data from Vaults.fyi...');

      const response = await this.makeRequest('/v2/detailed-vaults', {
        allowedAssets: ['USDC'],
        allowedNetworks: ['mainnet', 'base', 'arbitrum', 'optimism', 'polygon'],
        minTvl: 100000,
        perPage: 50
      });

      const vaults = response?.data || [];
      console.log(`📊 Retrieved ${vaults.length} total vaults from Vaults.fyi`);

      // Filter for lending vaults only
      const lendingVaults = vaults.filter(vault => {
        const protocolName = vault.protocol?.name?.toLowerCase() || '';
        const isLendingProtocol = this.lendingProtocols.some(protocol => 
          protocolName.includes(protocol)
        );
        
        // Exclude obvious LP pools
        const notLPPool = !this.isLiquidityPool(vault);
        
        // Must have reasonable APY
        const apy = vault.apy?.['30day']?.total || vault.apy?.['7day']?.total || 0;
        const hasReasonableAPY = apy > 0 && apy < 100;
        
        return isLendingProtocol && notLPPool && hasReasonableAPY;
      });

      console.log(`📈 Found ${lendingVaults.length} traditional lending vaults from Vaults.fyi`);

      return lendingVaults.map(vault => this.normalizeVaultData(vault));

    } catch (error) {
      console.error('❌ Vaults.fyi lending vault collection failed:', error.message);
      return [];
    }
  }

  isLiquidityPool(vault) {
    const name = vault.name?.toLowerCase() || '';
    const protocolName = vault.protocol?.name?.toLowerCase() || '';
    
    // Check for LP indicators
    const lpIndicators = [
      'uniswap', 'curve', 'balancer', 'sushiswap',
      'lp', 'liquidity', 'pool', '-'
    ];
    
    return lpIndicators.some(indicator => 
      name.includes(indicator) || protocolName.includes(indicator)
    );
  }

  normalizeVaultData(vault) {
    const getChainName = (vault) => {
      if (!vault.network?.name) return null;
      const networkName = String(vault.network.name).toLowerCase();
      const chainMapping = {
        'mainnet': 'ethereum',
        'ethereum': 'ethereum',
        'optimism': 'optimism',
        'arbitrum': 'arbitrum',
        'polygon': 'polygon',
        'base': 'base'
      };
      return chainMapping[networkName] || networkName;
    };

    return {
      vault_address: vault.address || `vaults-fyi-${Date.now()}`,
      chain: getChainName(vault),
      protocol: this.normalizeProtocolName(vault.protocol?.name),
      name: vault.name || 'Unknown Vault',
      asset_symbol: vault.asset?.symbol || 'UNKNOWN',
      asset_address: vault.asset?.address,
      apy: parseFloat(vault.apy?.['30day']?.total || vault.apy?.['7day']?.total || 0),
      apr: parseFloat(vault.apy?.['30day']?.base || vault.apy?.['7day']?.base || 0),
      tvl_usd: parseInt(vault.tvl?.usd || 0),
      utilization_rate: null,
      risk_score: vault.score?.vaultScore || null,
      data_source: 'vaultsfyi',
      vault_type: 'lending',
      raw_data: JSON.stringify(vault)
    };
  }

  normalizeProtocolName(protocolName) {
    if (!protocolName) return 'unknown';
    
    const name = protocolName.toLowerCase();
    if (name.includes('aave')) return 'aave';
    if (name.includes('compound')) return 'compound';
    if (name.includes('morpho')) return 'morpho';
    if (name.includes('euler')) return 'euler';
    if (name.includes('yearn')) return 'yearn';
    
    return protocolName;
  }

  async makeRequest(endpoint, params = {}) {
    const config = {
      method: 'GET',
      url: `${this.baseUrl}${endpoint}`,
      params,
      timeout: 10000,
      headers: {
        'User-Agent': 'VaultAPYOracle/1.0',
        'Accept': '*/*'
      }
    };

    if (this.apiKey) {
      config.headers['x-api-key'] = this.apiKey;
    }

    const response = await axios(config);
    return response.data;
  }
}

// Updated External Adapter with Lending-Only Focus
class LendingFocusedExternalAdapter {
  constructor() {
    // ... existing setup code ...
    
    // Use filtered collectors
    this.filteredDefiLlamaCollector = new FilteredDefiLlamaCollector();
    this.filteredVaultsFyiCollector = new FilteredVaultsFyiCollector();
    this.enhancedOnChainCollector = new EnhancedVaultOnChainCollector();
    this.riskScorer = new RiskScorer();
  }

  async collectFromLendingSources() {
    console.log('🔄 Collecting from LENDING protocols only...');
    
    const [defiLlamaVaults, vaultsFyiVaults] = await Promise.all([
      this.filteredDefiLlamaCollector.collectAllVaults(),
      this.filteredVaultsFyiCollector.collectAllVaults()
    ]);

    // Deduplicate vaults
    const vaultMap = new Map();

    defiLlamaVaults.forEach(vault => {
      const key = `${vault.vault_address}-${vault.chain}`.toLowerCase();
      vaultMap.set(key, { ...vault, source_priority: 'defillama' });
    });

    vaultsFyiVaults.forEach(vault => {
      const key = `${vault.vault_address}-${vault.chain}`.toLowerCase();
      const existing = vaultMap.get(key);

      if (!existing || vault.tvl_usd > existing.tvl_usd) {
        vaultMap.set(key, { ...vault, source_priority: 'vaultsfyi' });
      }
    });

    const lendingVaults = Array.from(vaultMap.values());
    
    console.log(`📊 Final lending vaults: ${lendingVaults.length}`);
    console.log(`📋 Protocol breakdown:`, this.getProtocolSummary(lendingVaults));
    
    return lendingVaults;
  }

  getProtocolSummary(vaults) {
    const summary = {};
    vaults.forEach(vault => {
      const key = `${vault.protocol}-${vault.chain}`;
      if (!summary[key]) {
        summary[key] = { count: 0, totalTVL: 0, avgAPY: 0 };
      }
      summary[key].count++;
      summary[key].totalTVL += vault.tvl_usd;
      summary[key].avgAPY += vault.apy;
    });

    // Calculate averages
    Object.keys(summary).forEach(key => {
      summary[key].avgAPY = summary[key].avgAPY / summary[key].count;
      summary[key].totalTVL = summary[key].totalTVL;
    });

    return summary;
  }

  async getBestLendingVault(asset = 'USDC', riskLevel = 'medium', chain = null) {
    console.log(`🔍 Finding best LENDING vault for ${asset} (${riskLevel} risk)${chain ? ` on ${chain}` : ''}`);

    // Get lending vaults only
    const lendingVaults = await this.collectFromLendingSources();

    // Filter by asset and chain
    let filteredVaults = lendingVaults.filter(vault =>
      vault.asset_symbol.toUpperCase() === asset.toUpperCase()
    );

    if (chain) {
      filteredVaults = filteredVaults.filter(vault =>
        vault.chain.toLowerCase() === chain.toLowerCase()
      );
    }

    console.log(`🎯 Found ${filteredVaults.length} lending vaults for ${asset}`);

    if (filteredVaults.length === 0) {
      throw new Error(`No lending vaults found for ${asset}`);
    }

    // Get enhanced calculations for top vaults
    const topVaults = filteredVaults
      .sort((a, b) => b.tvl_usd - a.tvl_usd)
      .slice(0, 5); // Top 5 for enhanced analysis

    console.log(`🔗 Running enhanced calculations on ${topVaults.length} top vaults`);

    for (const vault of topVaults) {
      try {
        const enhancedData = await this.enhancedOnChainCollector.getVaultDataWithCalculatedAPY(
          vault.vault_address,
          vault.chain,
          vault.protocol
        );

        if (enhancedData?.calculated_apy) {
          vault.calculated_apy = enhancedData.calculated_apy;
          vault.apy_confidence = enhancedData.confidence_score;
          vault.calculation_methods = enhancedData.calculation_methods;
          vault.data_source = 'enhanced_onchain';
          
          // Use calculated APY if confident
          if (enhancedData.confidence_score > 0.6) {
            vault.apy = enhancedData.calculated_apy;
          }
        }
      } catch (error) {
        console.log(`⚠️ Enhanced calculation failed for ${vault.vault_address}: ${error.message}`);
      }
    }

    // Apply risk filtering and select best
    const safeVaults = this.riskScorer.filterByRiskTolerance(filteredVaults, riskLevel);
    const bestVault = safeVaults
      .map(vault => ({
        ...vault,
        risk_adjusted_apy: this.riskScorer.getRiskAdjustedAPY(vault.apy, vault.risk_score)
      }))
      .sort((a, b) => b.risk_adjusted_apy - a.risk_adjusted_apy)[0];

    return {
      vault_address: bestVault.vault_address,
      apy: bestVault.apy,
      calculated_apy: bestVault.calculated_apy || null,
      apy_confidence: bestVault.apy_confidence || 0,
      calculation_methods: bestVault.calculation_methods || [],
      risk_adjusted_apy: bestVault.risk_adjusted_apy,
      risk_score: bestVault.risk_score,
      tvl_usd: bestVault.tvl_usd,
      protocol: bestVault.protocol,
      chain: bestVault.chain,
      name: bestVault.name,
      vault_type: 'lending',
      data_source: bestVault.data_source,
      value: Math.round(bestVault.apy * 100),
      timestamp: Date.now()
    };
  }
}

module.exports = {
  FilteredDefiLlamaCollector,
  FilteredVaultsFyiCollector, 
  LendingFocusedExternalAdapter
};
