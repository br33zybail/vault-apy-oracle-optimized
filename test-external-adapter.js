require('dotenv').config({ path: '.env.local' });
const axios = require('axios');
const VaultAPYExternalAdapter = require('./src/chainlink/external-adapter');

async function testAdapter() {
  console.log('🚀 Starting External Adapter test...');
  
  // Start the adapter
  const adapter = new VaultAPYExternalAdapter();
  adapter.start();
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  try {
    // Test 1: Health check
    console.log('\n🔍 Testing health endpoint...');
    const health = await axios.get('http://localhost:3001/health');
    console.log('✅ Health check:', health.data);
    
    // Test 2: Best vault endpoint
    console.log('\n🏆 Testing best vault endpoint...');
    const bestVault = await axios.get('http://localhost:3001/best-vault/USDC/medium');
    console.log('✅ Best vault:', JSON.stringify(bestVault.data, null, 2));
    
    // Test 3: Chainlink-style request
    console.log('\n📡 Testing Chainlink request format...');
    const chainlinkRequest = await axios.post('http://localhost:3001/', {
      id: 'test-job-123',
      data: {
        asset: 'USDC',
        risk_level: 'medium',
        request_type: 'best_vault'
      }
    });
    console.log('✅ Chainlink response:', JSON.stringify(chainlinkRequest.data, null, 2));
    
    console.log('\n🎉 All tests passed! External adapter is working.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
  
  process.exit(0);
}

testAdapter();
