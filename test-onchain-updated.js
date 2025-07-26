require('dotenv').config();
const VaultOnChainCollector = require('./src/collectors/onchain/vault-onchain-collector');

async function testUpdatedCollector() {
  try {
    console.log('🔗 Testing updated on-chain collector...');
    
    const collector = new VaultOnChainCollector();
    
    // Test with the working aUSDC address
    const result = await collector.getVaultOnChainData(
      '0xBcca60bB61934080951369a648Fb03DF4F96263C', // aUSDC 
      'ethereum',
      'aave'
    );
    
    if (result) {
      console.log('✅ On-chain data retrieved:');
      console.log('Name:', result.name);
      console.log('Symbol:', result.symbol);
      console.log('Total Supply:', result.total_supply);
      console.log('Vault Type:', result.vault_type);
      console.log('Block Number:', result.block_number);
      console.log('Data Source:', result.data_source);
    } else {
      console.log('❌ No data retrieved');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testUpdatedCollector();