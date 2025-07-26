// src/utils/risk-scorer.js
const CacheManager = require('./cache-manager');

class RiskScorer {
  constructor() {
    this.cacheManager = new CacheManager();
    
    // Known protocol risk ratings (lower = safer)
    this.protocolRiskScores = {
      // Ultra Safe (90-100)
      'aave-v3': 95,
      'aave-v2': 92,
      'compound-v3': 94,
      'compound-v2': 90,
      
      // Safe (80-89)
      'yearn': 85,
      'convex': 83,
      'curve': 87,
      'lido': 88,
      'maker': 89,
      
      // Medium Risk (60-79)
      'uniswap-v3': 75,
      'sushiswap': 72,
      'balancer': 78,
      'morpho-blue': 82,
      'fluid-lending': 75,
      
      // Higher Risk (40-59)
      'aerodrome-slipstream': 45, // Those crazy APYs we saw
      'pancakeswap': 65,
      'trader-joe': 68,
      
      // Unknown protocols start at 50
      'default': 50
    };

    // Chain risk multipliers
    this.chainRiskMultipliers = {
      'ethereum': 1.0,    // Safest, most established
      'base': 0.95,       // Coinbase L2, very safe
      'arbitrum': 0.9,    // Established L2
      'polygon': 0.85,    // Established but some risks
      'optimism': 0.9,    // Established L2
      'avalanche': 0.8,   // Less established
      'bsc': 0.7          // Higher risk
    };
  }

  async calculateRiskScore(vaultData) {
    try {
      // Check cache first
      const cacheKey = `${vaultData.vault_address}-${vaultData.protocol}-${vaultData.tvl_usd}`;
      const cached = await this.cacheManager.getRiskScore(cacheKey);
      if (cached) {
        return cached;
      }
      
      let score = 0;
      let maxScore = 0;

      // 1. Protocol Risk (40% weight)
      const protocolScore = this.getProtocolScore(vaultData.protocol);
      score += protocolScore * 0.4;
      maxScore += 100 * 0.4;

      // 2. TVL Risk (25% weight) - Higher TVL = Lower Risk
      const tvlScore = this.getTVLScore(vaultData.tvl_usd);
      score += tvlScore * 0.25;
      maxScore += 100 * 0.25;

      // 3. APY Reasonableness (20% weight) - Too high APY = Higher Risk
      const apyScore = this.getAPYScore(vaultData.apy);
      score += apyScore * 0.2;
      maxScore += 100 * 0.2;

      // 4. Chain Risk (10% weight)
      const chainScore = this.getChainScore(vaultData.chain);
      score += chainScore * 0.1;
      maxScore += 100 * 0.1;

      // 5. Data Source Reliability (5% weight)
      const sourceScore = this.getSourceScore(vaultData.data_source);
      score += sourceScore * 0.05;
      maxScore += 100 * 0.05;

      // Normalize to 0-100 scale
      const finalScore = Math.round((score / maxScore) * 100);
      
      const result = {
        riskScore: Math.max(0, Math.min(100, finalScore)),
        breakdown: {
          protocol: Math.round(protocolScore),
          tvl: Math.round(tvlScore),
          apy: Math.round(apyScore),
          chain: Math.round(chainScore),
          source: Math.round(sourceScore)
        },
        riskCategory: this.getRiskCategory(finalScore)
      };
      
      // Cache the result
      await this.cacheManager.setRiskScore(cacheKey, result, 3600); // 1 hour cache
      
      return result;

    } catch (error) {
      console.error('Risk scoring failed:', error.message);
      return {
        riskScore: 50, // Default medium risk
        breakdown: {},
        riskCategory: 'medium'
      };
    }
  }

  getProtocolScore(protocol) {
    if (!protocol) return 30;
    
    const protocolKey = protocol.toLowerCase().replace(/\s+/g, '-');
    return this.protocolRiskScores[protocolKey] || this.protocolRiskScores['default'];
  }

  getTVLScore(tvlUsd) {
    if (!tvlUsd || tvlUsd <= 0) return 20;
    
    // TVL scoring - logarithmic scale
    if (tvlUsd >= 100000000) return 95;      // $100M+ = Ultra safe
    if (tvlUsd >= 50000000) return 90;       // $50M+ = Very safe  
    if (tvlUsd >= 10000000) return 85;       // $10M+ = Safe
    if (tvlUsd >= 5000000) return 75;        // $5M+ = Good
    if (tvlUsd >= 1000000) return 65;        // $1M+ = Medium
    if (tvlUsd >= 500000) return 55;         // $500k+ = Moderate risk
    if (tvlUsd >= 100000) return 45;         // $100k+ = Higher risk
    return 30;                               // <$100k = High risk
  }

  getAPYScore(apy) {
    if (!apy || apy <= 0) return 20;
    
    // APY scoring - suspicious if too high
    if (apy <= 5) return 95;           // 0-5% = Very reasonable
    if (apy <= 10) return 90;          // 5-10% = Reasonable  
    if (apy <= 20) return 80;          // 10-20% = Good but watch
    if (apy <= 50) return 60;          // 20-50% = Moderate risk
    if (apy <= 100) return 40;         // 50-100% = High risk
    if (apy <= 200) return 25;         // 100-200% = Very high risk
    return 10;                         // >200% = Extreme risk (like those 1342% we saw!)
  }

  getChainScore(chain) {
    if (!chain) return 50;
    
    const multiplier = this.chainRiskMultipliers[chain.toLowerCase()] || 0.7;
    return multiplier * 100;
  }

  getSourceScore(source) {
    const sourceScores = {
      'vaultsfyi': 90,     // Specialized vault data
      'defillama': 85,     // Established aggregator
      'onchain': 95,       // Direct from contracts
      'default': 70
    };
    
    return sourceScores[source] || sourceScores['default'];
  }

  getRiskCategory(score) {
    if (score >= 85) return 'low';
    if (score >= 70) return 'medium-low';
    if (score >= 55) return 'medium';
    if (score >= 40) return 'medium-high';
    return 'high';
  }

  // Filter vaults by risk tolerance with parallel processing
  async filterByRiskTolerance(vaults, maxRiskLevel = 'medium') {
    const riskLevelScores = {
      'low': 85,
      'medium-low': 70,
      'medium': 55,
      'medium-high': 40,
      'high': 0
    };

    const minScore = riskLevelScores[maxRiskLevel] || 55;
    
    // Process vaults in parallel for better performance
    const enrichedVaults = await Promise.all(
      vaults.map(async vault => {
        const riskAnalysis = await this.calculateRiskScore(vault);
        return {
          ...vault,
          risk_score: riskAnalysis.riskScore,
          risk_category: riskAnalysis.riskCategory,
          risk_breakdown: riskAnalysis.breakdown
        };
      })
    );
    
    return enrichedVaults
      .filter(vault => vault.risk_score >= minScore)
      .sort((a, b) => b.risk_score - a.risk_score); // Sort by safest first
  }

  // Get risk-adjusted APY (APY weighted by risk)
  getRiskAdjustedAPY(apy, riskScore) {
    // Simple risk adjustment: higher risk = lower effective APY
    const riskMultiplier = riskScore / 100;
    return apy * riskMultiplier;
  }
}

module.exports = RiskScorer;
