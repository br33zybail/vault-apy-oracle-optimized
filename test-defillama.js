require('dotenv').config();
const DefiLlamaCollector = require('./src/collectors/api/defillama-collector');

async function testDefiLlama() {
  try {
    console.log('🦙 Testing DefiLlama collector...');
    
    const collector = new DefiLlamaCollector();
    const vaults = await collector.collectAllVaults();
    
    console.log(`\n📊 Results:`);
    console.log(`Total vaults found: ${vaults.length}`);
    
    if (vaults.length > 0) {
      console.log('\n🏆 Top 5 vaults by APY:');
      const topAPY = vaults
        .sort((a, b) => b.apy - a.apy)
        .slice(0, 5);
      
      topAPY.forEach(vault => {
        console.log(`  ${vault.name}: ${vault.apy.toFixed(2)}% APY | $${(vault.tvl_usd/1000000).toFixed(1)}M TVL | ${vault.chain}`);
      });
      
      console.log('\n💰 Top 5 vaults by TVL:');
      const topTVL = vaults
        .sort((a, b) => b.tvl_usd - a.tvl_usd)
        .slice(0, 5);
      
      topTVL.forEach(vault => {
        console.log(`  ${vault.name}: $${(vault.tvl_usd/1000000).toFixed(1)}M TVL | ${vault.apy.toFixed(2)}% APY | ${vault.chain}`);
      });
    }
    
  } catch (error) {
    console.error('❌ DefiLlama test failed:', error.message);
  }
}

testDefiLlama();
