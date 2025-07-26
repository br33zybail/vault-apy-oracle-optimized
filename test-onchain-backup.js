require('dotenv').config();
const VaultOnChainCollector = require('./src/collectors/onchain/vault-onchain-collector');

async function testOnChain() {
  try {
    console.log('🔗 Testing on-chain collector...');
    
    const collector = new VaultOnChainCollector();
    
    // Test with a known Aave USDC vault on Ethereum
    const result = await collector.getVaultOnChainData(
      '0xBcca60bB61934080951369a648Fb03DF4F96263C', // aUSDC on Ethereum
      'ethereum',
      'aave'
    );
    
    if (result) {
      console.log('✅ On-chain data retrieved:');
      console.log('Name:', result.name);
      console.log('Symbol:', result.symbol);
      console.log('Total Assets:', result.total_assets);
      console.log('Asset Symbol:', result.asset_symbol);
      console.log('Block Number:', result.block_number);
    } else {
      console.log('❌ No data retrieved');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testOnChain();