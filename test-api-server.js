require('dotenv').config();
const axios = require('axios');
const VaultAPYAPIServer = require('./src/api/server');

async function testAPIServer() {
  console.log('🚀 Starting API Server test...');
  
  // Start the server
  const server = new VaultAPYAPIServer();
  server.start();
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  try {
    // Test 1: Documentation
    console.log('\n📖 Testing documentation endpoint...');
    const docs = await axios.get('http://localhost:3000/');
    console.log('✅ Documentation available');
    
    // Test 2: Health check
    console.log('\n🔍 Testing health endpoint...');
    const health = await axios.get('http://localhost:3000/health');
    console.log('✅ Health check:', health.data.status);
    
    // Test 3: Best vault API
    console.log('\n🏆 Testing best vault API...');
    const bestVault = await axios.get('http://localhost:3000/api/v1/vaults/best/USDC?risk=medium&limit=1');
    console.log('✅ Best vault API response:');
    console.log(`   Vault: ${bestVault.data.data.name}`);
    console.log(`   APY: ${bestVault.data.data.apy}%`);
    console.log(`   Risk Score: ${bestVault.data.data.risk_score}/100`);
    console.log(`   Chain: ${bestVault.data.data.chain}`);
    
    // Test 4: Top vaults API
    console.log('\n📊 Testing top vaults API...');
    const topVaults = await axios.get('http://localhost:3000/api/v1/vaults/top/USDC?risk=medium&limit=3');
    console.log(`✅ Top vaults API: Found ${topVaults.data.data.length} vaults`);
    topVaults.data.data.forEach((vault, i) => {
      console.log(`   ${i+1}. ${vault.name}: ${vault.apy}% APY (Risk: ${vault.risk_score})`);
    });
    
    // Test 5: Chains API
    console.log('\n🌐 Testing chains API...');
    const chains = await axios.get('http://localhost:3000/api/v1/chains');
    console.log(`✅ Chains API: Found ${chains.data.data.length} chains`);
    
    console.log('\n🎉 All API tests passed! Your oracle is ready for DeFi automation agents!');
    
    console.log('\n📋 Quick Reference for Automation Agents:');
    console.log('   Best vault: GET /api/v1/vaults/best/USDC?risk=medium');
    console.log('   Top vaults: GET /api/v1/vaults/top/USDC?risk=low&limit=5');
    console.log('   Specific vault: GET /api/v1/vaults/ethereum/0x...');
    console.log('   Compare vaults: POST /api/v1/vaults/compare');
    
  } catch (error) {
    console.error('❌ API test failed:', error.response?.data || error.message);
  }
  
  process.exit(0);
}

testAPIServer();
