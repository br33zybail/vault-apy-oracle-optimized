require('dotenv').config();
const axios = require('axios');

async function testVaultsFyiBatch() {
  try {
    console.log('🧪 Testing batch lookup with Vaults.fyi vault...');
    
    // Use the Revert Lend USDC vault we saw earlier from Vaults.fyi
    const vaultAddress = "0x36AEAe0E411a1E28372e0d66f02E57744EbE7599";
    
    const response = await axios.post('http://localhost:8080/', {
      id: 'test-vaultsfyi-batch',
      data: {
        request_type: 'batch_vault_lookup',
        vault_addresses: [vaultAddress],
        asset: 'USDC'
      }
    });
    
    console.log('✅ Vaults.fyi batch response:');
    console.log(`   Found: ${response.data.data.total_found} vaults`);
    
    if (response.data.data.vaults.length > 0) {
      const vault = response.data.data.vaults[0];
      console.log(`   Vault: ${vault.name}`);
      console.log(`   APY: ${vault.apy}%`);
      console.log(`   Data Source: ${vault.data_source || 'unknown'}`);
      console.log(`   Chain: ${vault.chain}`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testVaultsFyiBatch();
