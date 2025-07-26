require('dotenv').config();
const DefiLlamaCollector = require('./src/collectors/api/defillama-collector');
const RiskScorer = require('./src/utils/risk-scorer');

async function testRiskScoring() {
  try {
    console.log('🎯 Testing Risk Scoring System...');
    
    // Get some vault data
    const collector = new DefiLlamaCollector();
    const vaults = await collector.collectAllVaults();
    
    // Initialize risk scorer
    const riskScorer = new RiskScorer();
    
    console.log('\n📊 Risk Analysis of Top Vaults:');
    console.log('=' * 80);
    
    // Test on a variety of vaults
    const testVaults = [
      ...vaults.filter(v => v.protocol.includes('aave')).slice(0, 2),
      ...vaults.filter(v => v.protocol.includes('aerodrome')).slice(0, 2),
      ...vaults.filter(v => v.apy > 100).slice(0, 2),
      ...vaults.filter(v => v.tvl_usd > 100000000).slice(0, 2)
    ].slice(0, 8);

    testVaults.forEach(vault => {
      const riskAnalysis = riskScorer.calculateRiskScore(vault);
      const riskAdjustedAPY = riskScorer.getRiskAdjustedAPY(vault.apy, riskAnalysis.riskScore);
      
      console.log(`\n🏦 ${vault.name}`);
      console.log(`   Protocol: ${vault.protocol} | Chain: ${vault.chain}`);
      console.log(`   📈 APY: ${vault.apy.toFixed(2)}% | 💰 TVL: $${(vault.tvl_usd/1000000).toFixed(1)}M`);
      console.log(`   🛡️  Risk Score: ${riskAnalysis.riskScore}/100 (${riskAnalysis.riskCategory})`);
      console.log(`   ⚖️  Risk-Adjusted APY: ${riskAdjustedAPY.toFixed(2)}%`);
      console.log(`   📋 Breakdown: Protocol=${riskAnalysis.breakdown.protocol}, TVL=${riskAnalysis.breakdown.tvl}, APY=${riskAnalysis.breakdown.apy}`);
    });

    // Test filtering by risk tolerance
    console.log('\n\n🔒 SAFE VAULTS ONLY (Risk Score ≥ 70):');
    console.log('=' * 50);
    
    const safeVaults = riskScorer.filterByRiskTolerance(vaults.slice(0, 50), 'medium-low');
    
    safeVaults.slice(0, 10).forEach(vault => {
      const riskAdjustedAPY = riskScorer.getRiskAdjustedAPY(vault.apy, vault.risk_score);
      console.log(`${vault.name}: ${vault.apy.toFixed(2)}% APY → ${riskAdjustedAPY.toFixed(2)}% (Risk: ${vault.risk_score})`);
    });

    console.log(`\n📈 Summary: Found ${safeVaults.length} safe vaults out of ${vaults.length} total`);
    
  } catch (error) {
    console.error('❌ Risk scoring test failed:', error.message);
  }
}

testRiskScoring();
