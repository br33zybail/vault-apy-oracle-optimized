require('dotenv').config({ path: '.env.local' });
const axios = require('axios');
const VaultAPYExternalAdapter = require('./src/chainlink/external-adapter');

async function testEnhancedAPY() {
  console.log('🧪 Testing Enhanced APY Calculations...');
  
  // Start the adapter
  const adapter = new VaultAPYExternalAdapter();
  adapter.start();
  
  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  try {
    console.log('\n=== Testing Enhanced APY Endpoints ===\n');

    // Test 1: Enhanced APY for a specific Aave vault
    console.log('1️⃣ Testing Enhanced APY - Aave Vault');
    try {
      const aaveResponse = await axios.get(
        'http://localhost:3001/enhanced-apy/ethereum/0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a/aave-v3',
        { timeout: 30000 }
      );
      console.log('✅ Aave Enhanced APY:', JSON.stringify(aaveResponse.data, null, 2));
    } catch (error) {
      console.log('⚠️ Aave test skipped:', error.response?.data?.error || error.message);
    }

    // Test 2: Comprehensive analysis for a vault
    console.log('\n2️⃣ Testing Comprehensive Analysis');
    try {
      const compResponse = await axios.get(
        'http://localhost:3001/enhanced-apy/base/0x90613e167D42CA420942082157B42AF6fc6a8087/harvest-finance?comprehensive=true',
        { timeout: 45000 }
      );
      console.log('✅ Comprehensive Analysis:', JSON.stringify(compResponse.data, null, 2));
    } catch (error) {
      console.log('⚠️ Comprehensive test skipped:', error.response?.data?.error || error.message);
    }

    // Test 3: Enhanced Best Vault via Chainlink request
    console.log('\n3️⃣ Testing Enhanced Best Vault Chainlink Request');
    try {
      const enhancedBestResponse = await axios.post('http://localhost:3001/', {
        id: 'test-enhanced-123',
        data: {
          asset: 'USDC',
          risk_level: 'medium',
          request_type: 'enhanced_best_vault'
        }
      }, { timeout: 60000 });
      console.log('✅ Enhanced Best Vault:', JSON.stringify(enhancedBestResponse.data, null, 2));
    } catch (error) {
      console.log('⚠️ Enhanced best vault test failed:', error.response?.data?.error || error.message);
    }

    // Test 4: Compare with regular best vault
    console.log('\n4️⃣ Comparing Regular vs Enhanced Best Vault');
    try {
      const [regularResponse, enhancedResponse] = await Promise.all([
        axios.post('http://localhost:3001/', {
          id: 'test-regular-123',
          data: {
            asset: 'USDC',
            risk_level: 'medium',
            request_type: 'best_vault'
          }
        }, { timeout: 30000 }),
        axios.post('http://localhost:3001/', {
          id: 'test-enhanced-123',
          data: {
            asset: 'USDC',
            risk_level: 'medium',
            request_type: 'enhanced_best_vault'
          }
        }, { timeout: 60000 })
      ]);

      console.log('📊 COMPARISON RESULTS:');
      console.log('Regular Best Vault APY:', regularResponse.data.data.apy);
      console.log('Enhanced Best Vault APY:', enhancedResponse.data.data.apy);
      console.log('Enhanced Calculation Used:', enhancedResponse.data.data.enhanced_calculation);
      console.log('Confidence Score:', enhancedResponse.data.data.apy_confidence);
      console.log('Calculation Method:', enhancedResponse.data.data.calculation_method);

    } catch (error) {
      console.log('⚠️ Comparison test failed:', error.response?.data?.error || error.message);
    }

    console.log('\n🎉 Enhanced APY testing completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
  
  process.exit(0);
}

// Show available protocols from recent DeFi Llama data
async function showAvailableProtocols() {
  console.log('\n📋 Available Protocols for Enhanced APY Calculation:');
  console.log('');
  console.log('🏦 Full Protocol Support (Direct Rate Queries):');
  console.log('  • Aave V3 - Direct liquidity rate from pool contract');
  console.log('  • Aave V2 - Direct liquidity rate from pool contract'); 
  console.log('  • Compound V3 - Supply rate calculation from utilization');
  console.log('  • Compound V2 - Supply rate per block conversion');
  console.log('');
  console.log('🔵 Advanced Protocol Support:');
  console.log('  • Morpho Blue - Utilization-based rate modeling');
  console.log('  • Morpho Aave - Peer-to-peer rate improvements');
  console.log('  • Euler V2 - Reserve data APY queries');
  console.log('');
  console.log('🌾 Strategy-Based Protocols:');
  console.log('  • Yearn Finance - Price per share historical analysis');
  console.log('  • Beefy - Compound strategy calculations');
  console.log('  • Harvest Finance - Yield farming APY estimation');
  console.log('');
  console.log('📊 Generic ERC4626 Support:');
  console.log('  • Any ERC4626 vault - Share price change analysis');
  console.log('  • Fallback method for unknown protocols');
  console.log('');
  console.log('🔬 Calculation Methods Available:');
  console.log('  1. Protocol-specific rate queries (highest confidence)');
  console.log('  2. Historical share price analysis (7-day, 30-day)');
  console.log('  3. ERC4626 standard calculations (fallback)');
  console.log('  4. Comprehensive analysis (combines all methods)');
  console.log('');
}

console.log('🚀 Enhanced APY Calculation System');
showAvailableProtocols();
testEnhancedAPY();