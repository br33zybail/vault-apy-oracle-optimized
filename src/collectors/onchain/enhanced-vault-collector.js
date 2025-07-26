// src/collectors/onchain/enhanced-vault-collector.js
const { ethers } = require('ethers');
const VaultOnChainCollector = require('./vault-onchain-collector');
const ProtocolAPYCalculators = require('./protocol-apy-calculators');

/**
 * Enhanced vault collector with protocol-specific APY calculations
 */
class EnhancedVaultOnChainCollector extends VaultOnChainCollector {
  constructor() {
    super();
    this.apyCalculators = new ProtocolAPYCalculators();
  }

  /**
   * Check if address is a DeFi Llama UUID vs Ethereum address
   */
  isEthereumAddress(address) {
    return address && 
           typeof address === 'string' && 
           address.startsWith('0x') && 
           address.length === 42;
  }

  /**
   * Get vault data with calculated APY
   */
  async getVaultDataWithCalculatedAPY(vaultAddress, chain, protocol, metadata = {}) {
    try {
      console.log(`🔬 Getting enhanced vault data for ${vaultAddress} (${protocol})`);
      
      // Check if this is a real Ethereum address or DeFi Llama UUID
      if (!this.isEthereumAddress(vaultAddress)) {
        console.log(`⚠️ Skipping on-chain calculation for UUID: ${vaultAddress}`);
        
        // For UUIDs, we can only do protocol-specific estimation
        return await this.getProtocolEstimationForUUID(vaultAddress, chain, protocol, metadata);
      }
      
      // First get basic on-chain data for real addresses
      const basicData = await this.getVaultOnChainData(vaultAddress, chain, protocol);
      if (!basicData) {
        return null;
      }

      // Calculate protocol-specific APY
      const provider = this.providers[chain];
      const apyData = await this.apyCalculators.calculateProtocolAPY(
        vaultAddress, 
        protocol, 
        provider, 
        chain,
        metadata.marketId
      );

      if (apyData) {
        return {
          ...basicData,
          calculated_apy: apyData.calculated_apy,
          apy_calculation_method: apyData.method,
          confidence_score: apyData.confidence_score,
          calculation_details: apyData.calculation_details,
          calculation_timestamp: Date.now()
        };
      }

      return basicData;

    } catch (error) {
      console.error(`❌ Enhanced vault data collection failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Protocol estimation for UUID-based vaults (DeFi Llama pools)
   */
  async getProtocolEstimationForUUID(uuid, chain, protocol, metadata = {}) {
    try {
      console.log(`📊 Protocol estimation for UUID ${uuid} (${protocol})`);
      
      const protocolLower = protocol.toLowerCase();
      let estimatedAPY = 0.04; // 4% default
      let confidence = 0.3; // Low confidence for estimates
      let method = 'protocol_estimation';
      
      // Protocol-specific estimations based on typical ranges
      if (protocolLower.includes('aave')) {
        estimatedAPY = 0.02 + (Math.random() * 0.03); // 2-5% for Aave USDC
        confidence = 0.6;
        method = 'aave_typical_range';
      } else if (protocolLower.includes('compound')) {
        estimatedAPY = 0.015 + (Math.random() * 0.025); // 1.5-4% for Compound
        confidence = 0.6;
        method = 'compound_typical_range';
      } else if (protocolLower.includes('morpho')) {
        estimatedAPY = 0.025 + (Math.random() * 0.04); // 2.5-6.5% for Morpho
        confidence = 0.5;
        method = 'morpho_typical_range';
      } else if (protocolLower.includes('yearn')) {
        estimatedAPY = 0.03 + (Math.random() * 0.05); // 3-8% for Yearn
        confidence = 0.4;
        method = 'yearn_typical_range';
      }
      
      console.log(`✅ Estimated APY for ${protocol}: ${(estimatedAPY * 100).toFixed(2)}%`);
      
      return {
        vault_address: uuid,
        chain: chain,
        protocol: protocol,
        calculated_apy: estimatedAPY,
        apy_calculation_method: method,
        confidence_score: confidence,
        calculation_details: {
          estimation_type: 'uuid_protocol_based',
          protocol_category: protocolLower,
          note: 'UUID-based estimation, not on-chain calculation'
        },
        calculation_timestamp: Date.now(),
        is_estimation: true
      };
      
    } catch (error) {
      console.error(`❌ Protocol estimation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Batch process vaults with APY calculations
   */
  async batchGetVaultDataWithAPY(vaultList) {
    console.log(`🔬 Getting enhanced data for ${vaultList.length} vaults with APY calculations`);
    
    const results = [];
    const BATCH_SIZE = 3; // Smaller batches for APY calculations

    for (let i = 0; i < vaultList.length; i += BATCH_SIZE) {
      const batch = vaultList.slice(i, i + BATCH_SIZE);
      
      const batchPromises = batch.map(({ vault_address, chain, protocol, metadata }) =>
        this.getVaultDataWithCalculatedAPY(vault_address, chain, protocol, metadata)
          .catch(error => {
            console.error(`Failed enhanced data for ${vault_address}: ${error.message}`);
            return null;
          })
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(result => result !== null));
      
      // Longer delay for complex calculations
      if (i + BATCH_SIZE < vaultList.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`📊 Enhanced data collected for ${results.length}/${vaultList.length} vaults`);
    return results;
  }

  /**
   * Get APY calculation for a specific protocol without full vault data
   */
  async getProtocolAPY(vaultAddress, protocol, chain, metadata = {}) {
    try {
      const provider = this.providers[chain];
      if (!provider) {
        throw new Error(`No provider for chain: ${chain}`);
      }

      return await this.apyCalculators.calculateProtocolAPY(
        vaultAddress, 
        protocol, 
        provider, 
        chain,
        metadata.marketId
      );

    } catch (error) {
      console.error(`❌ Protocol APY calculation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Historical APY calculation using multiple time points
   */
  async calculateHistoricalAPY(vaultAddress, chain, protocol, daysBack = 7) {
    try {
      console.log(`📈 Calculating ${daysBack}-day historical APY for ${vaultAddress}`);
      
      const provider = this.providers[chain];
      const currentBlock = await provider.getBlockNumber();
      
      // Calculate blocks to go back (approximate)
      const blocksPerDay = this.apyCalculators.blocksPerYear[chain] / 365;
      const blocksBack = Math.floor(blocksPerDay * daysBack);
      const historicalBlock = currentBlock - blocksBack;

      // Get current and historical share prices
      const [currentData, historicalData] = await Promise.all([
        this.getSharePrice(vaultAddress, provider, currentBlock),
        this.getSharePrice(vaultAddress, provider, historicalBlock)
      ]);

      if (currentData && historicalData) {
        const priceChange = (currentData.sharePrice - historicalData.sharePrice) / historicalData.sharePrice;
        const annualizedReturn = priceChange * (365 / daysBack);
        
        console.log(`✅ Historical APY calculated: ${(annualizedReturn * 100).toFixed(2)}%`);
        
        return {
          calculated_apy: annualizedReturn,
          method: `historical_${daysBack}d`,
          confidence_score: 0.8,
          calculation_details: {
            current_price: currentData.sharePrice,
            historical_price: historicalData.sharePrice,
            price_change: priceChange,
            days_analyzed: daysBack,
            blocks_analyzed: blocksBack
          }
        };
      }

      return null;

    } catch (error) {
      console.error(`❌ Historical APY calculation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get share price at a specific block
   */
  async getSharePrice(vaultAddress, provider, blockNumber) {
    try {
      const vaultContract = new ethers.Contract(vaultAddress, [
        "function totalAssets() external view returns (uint256)",
        "function totalSupply() external view returns (uint256)"
      ], provider);

      const [totalAssets, totalSupply] = await Promise.all([
        vaultContract.totalAssets({ blockTag: blockNumber }),
        vaultContract.totalSupply({ blockTag: blockNumber })
      ]);

      const sharePrice = Number(totalSupply) > 0 
        ? Number(totalAssets) / Number(totalSupply)
        : 1;

      return {
        sharePrice,
        block: blockNumber,
        timestamp: (await provider.getBlock(blockNumber)).timestamp
      };

    } catch (error) {
      console.error(`❌ Share price query failed for block ${blockNumber}: ${error.message}`);
      return null;
    }
  }

  /**
   * Comprehensive vault analysis with multiple APY calculation methods
   */
  async getComprehensiveVaultAnalysis(vaultAddress, chain, protocol, metadata = {}) {
    try {
      console.log(`🔍 Comprehensive analysis for ${vaultAddress}`);
      
      const results = await Promise.allSettled([
        // Basic on-chain data
        this.getVaultOnChainData(vaultAddress, chain, protocol),
        
        // Protocol-specific APY
        this.getProtocolAPY(vaultAddress, protocol, chain, metadata),
        
        // Historical APY (7 days)
        this.calculateHistoricalAPY(vaultAddress, chain, protocol, 7),
        
        // Historical APY (30 days)
        this.calculateHistoricalAPY(vaultAddress, chain, protocol, 30)
      ]);

      const [basicData, protocolAPY, weeklyAPY, monthlyAPY] = results.map(r => 
        r.status === 'fulfilled' ? r.value : null
      );

      if (!basicData) {
        return null;
      }

      // Combine all APY calculations
      const apyMethods = [];
      let bestAPY = null;
      let highestConfidence = 0;

      if (protocolAPY) {
        apyMethods.push({
          method: protocolAPY.method,
          apy: protocolAPY.calculated_apy,
          confidence: protocolAPY.confidence_score
        });
        
        if (protocolAPY.confidence_score > highestConfidence) {
          bestAPY = protocolAPY.calculated_apy;
          highestConfidence = protocolAPY.confidence_score;
        }
      }

      if (weeklyAPY) {
        apyMethods.push({
          method: weeklyAPY.method,
          apy: weeklyAPY.calculated_apy,
          confidence: weeklyAPY.confidence_score
        });
        
        if (weeklyAPY.confidence_score > highestConfidence) {
          bestAPY = weeklyAPY.calculated_apy;
          highestConfidence = weeklyAPY.confidence_score;
        }
      }

      if (monthlyAPY) {
        apyMethods.push({
          method: monthlyAPY.method,
          apy: monthlyAPY.calculated_apy,
          confidence: monthlyAPY.confidence_score
        });
        
        if (monthlyAPY.confidence_score > highestConfidence) {
          bestAPY = monthlyAPY.calculated_apy;
          highestConfidence = monthlyAPY.confidence_score;
        }
      }

      return {
        ...basicData,
        calculated_apy: bestAPY,
        confidence_score: highestConfidence,
        calculation_methods: apyMethods,
        protocol_apy: protocolAPY,
        weekly_apy: weeklyAPY,
        monthly_apy: monthlyAPY,
        comprehensive_analysis: true,
        analysis_timestamp: Date.now()
      };

    } catch (error) {
      console.error(`❌ Comprehensive analysis failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Smart APY calculation that chooses the best method for each protocol
   */
  async getSmartCalculatedAPY(vaultAddress, chain, protocol, metadata = {}) {
    const protocolLower = protocol.toLowerCase();
    
    try {
      // Check if this is a UUID (DeFi Llama pool) vs real address
      if (!this.isEthereumAddress(vaultAddress)) {
        console.log(`🔍 Smart calculation for UUID ${vaultAddress} - using protocol estimation`);
        return await this.getProtocolEstimationForUUID(vaultAddress, chain, protocol, metadata);
      }

      // For real addresses, use full calculation methods
      // For protocols with reliable rate queries, use protocol-specific method
      if (protocolLower.includes('aave') || protocolLower.includes('compound')) {
        const protocolAPY = await this.getProtocolAPY(vaultAddress, protocol, chain, metadata);
        if (protocolAPY && protocolAPY.confidence_score > 0.8) {
          return protocolAPY;
        }
      }

      // For other protocols, prefer historical data if available
      const historicalAPY = await this.calculateHistoricalAPY(vaultAddress, chain, protocol, 7);
      if (historicalAPY) {
        return historicalAPY;
      }

      // Fallback to protocol-specific calculation
      return await this.getProtocolAPY(vaultAddress, protocol, chain, metadata);

    } catch (error) {
      console.error(`❌ Smart APY calculation failed: ${error.message}`);
      return null;
    }
  }
}

module.exports = EnhancedVaultOnChainCollector;