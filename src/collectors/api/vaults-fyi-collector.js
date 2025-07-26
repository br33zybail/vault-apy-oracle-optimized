// src/collectors/api/vaults-fyi-collector.js
const axios = require('axios');

class VaultsFyiCollector {
  constructor() {
    this.baseUrl = 'https://api.vaults.fyi';
    this.apiKey = process.env.VAULTS_FYI_API_KEY; // Add to .env if needed
  }

  async collectAllVaults() {
    try {
      console.log('🏦 Fetching vault data from Vaults.fyi...');
    
      const response = await this.makeRequest('/v2/detailed-vaults', {
        allowedAssets: ['USDC'],
        allowedNetworks: ['mainnet', 'base', 'arbitrum', 'optimism', 'polygon'],
        minTvl: 100000,
        perPage: 25 // Increase to get more vaults
      });
    
      const vaults = response?.data || [];
    
      if (vaults.length === 0) {
        console.log('⚠️ No vaults returned from /v2/detailed-vaults endpoint');
        return [];
      }

      console.log(`📊 Retrieved ${vaults.length} total vaults from Vaults.fyi`);

      // Filter for USDC vaults on target chains
      const targetChains = ['ethereum', 'optimism', 'arbitrum', 'polygon', 'base'];

      const usdcVaults = vaults
        .map(vault => this.normalizeVaultData(vault))
        .filter(normalizedVault => {
          const hasUSDC = normalizedVault.asset_symbol?.toUpperCase().includes('USDC');
          const isTargetChain = targetChains.includes(normalizedVault.chain);
          const hasMinTVL = normalizedVault.tvl_usd >= 100000;

          return hasUSDC && isTargetChain && hasMinTVL;
        });

      console.log(`📈 Found ${usdcVaults.length} qualifying USDC vaults from Vaults.fyi`);
    
      return usdcVaults;
    
    } catch (error) {
      console.error('❌ Vaults.fyi collection failed:', error.message);
      return [];
    }
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

    // Add API key using x-api-key header
    if (this.apiKey) {
      config.headers['x-api-key'] = this.apiKey;
    }

    const response = await axios(config);
    return response.data;
  }

  normalizeVaultData(vault) {
  // Handle network name mapping - Vaults.fyi uses different names than DefiLlama
    const getChainName = (vault) => {
      if (!vault.network?.name) return null;
    
      const networkName = String(vault.network.name).toLowerCase();
    
      // Map Vaults.fyi network names to standard chain names
      const chainMapping = {
        'mainnet': 'ethereum',
        'ethereum': 'ethereum',
        'optimism': 'optimism', 
        'arbitrum': 'arbitrum',
        'polygon': 'polygon',
        'gnosis': 'gnosis',
        'base': 'base',
        'unichain': 'unichain',
        'swellchain': 'swellchain',
        'celo': 'celo',
        'worldchain': 'worldchain',
        'berachain': 'berachain',
        'ink': 'ink',
        'bsc': 'bsc',
        // Handle CAIP format (eip155:1, eip155:10, etc.)
        'eip155:1': 'ethereum',
        'eip155:10': 'optimism',
        'eip155:42161': 'arbitrum',
        'eip155:137': 'polygon',
        'eip155:100': 'gnosis',
        'eip155:8453': 'base',
        'eip155:56': 'bsc'
      };
    
      return chainMapping[networkName] || networkName;
    };

    const safeNumber = (value, fallback = 0) => {
      const num = parseFloat(value);
      return isNaN(num) ? fallback : num;
    };

    const safeInt = (value, fallback = 0) => {
      const num = parseInt(value);
      return isNaN(num) ? fallback : num;
    };

    return {
      vault_address: vault.address || `vaults-fyi-${Date.now()}`,
      chain: getChainName(vault),
      protocol: vault.protocol?.name || 'unknown',
      name: vault.name || 'Unknown Vault',
      asset_symbol: vault.asset?.symbol || 'UNKNOWN',
      asset_address: vault.asset?.address,
      apy: safeNumber(vault.apy?.['30day']?.total || vault.apy?.['7day']?.total || vault.apy?.['1day']?.total),
      apr: safeNumber(vault.apy?.['30day']?.base || vault.apy?.['7day']?.base || vault.apy?.['1day']?.base),
      tvl_usd: safeInt(vault.tvl?.usd),
      utilization_rate: null, // Not provided in this format
      risk_score: vault.score?.vaultScore || null,
      data_source: 'vaultsfyi',
      is_transactional: vault.isTransactional || false,
      is_app_featured: vault.isAppFeatured || false,
      tags: vault.tags || [],
      holders_count: vault.holdersData?.totalCount || 0,
      protocol_url: vault.protocol?.protocolUrl,
      vault_url: vault.protocolVaultUrl,
      raw_data: JSON.stringify(vault)
    };
  }

  // Method to test API connectivity
  async testConnection() {
    try {
      console.log('🔧 Testing Vaults.fyi API connection...');
      
      const testEndpoints = [
        '/v1/health',
        '/health',
        '/status',
        '/ping'
      ];

      for (const endpoint of testEndpoints) {
        try {
          await this.makeRequest(endpoint);
          console.log(`✅ API is responsive at ${endpoint}`);
          return true;
        } catch (error) {
          continue;
        }
      }

      // If no health endpoints work, try main endpoints
      await this.makeRequest('/vaults');
      console.log('✅ API connection successful');
      return true;
      
    } catch (error) {
      console.error('❌ Vaults.fyi API connection failed:', error.message);
      console.log('📝 Please check:');
      console.log('   - API endpoint URL');
      console.log('   - API key (if required)');
      console.log('   - Network connectivity');
      return false;
    }
  }
}

module.exports = VaultsFyiCollector;
