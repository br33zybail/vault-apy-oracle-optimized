require('dotenv').config();
const axios = require('axios');

async function testVaultsAPI() {
  try {
    console.log('Testing Vaults.fyi API...');
    
    const response = await axios.get('https://api.vaults.fyi/v2/detailed-vaults', {
      headers: {
        'x-api-key': process.env.VAULTS_FYI_API_KEY,
        'Accept': '*/*'
      },
      params: {
        allowedAssets: ['USDC'],
        allowedNetworks: ['mainnet', 'base', 'arbitrum'],
        minTvl: 100000,
        perPage: 10
      }
    });
    
    console.log(`✅ Got ${response.data.data.length} vaults`);
    console.log('First vault:', JSON.stringify(response.data.data[0], null, 2));
    
  } catch (error) {
    console.error('❌ API test failed:', error.response?.status, error.response?.statusText);
    console.error('Error details:', error.response?.data || error.message);
  }
}

testVaultsAPI();
