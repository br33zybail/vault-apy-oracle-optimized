require('dotenv').config();
const { ethers } = require('ethers');

async function testSimpleContract() {
  try {
    console.log('🔗 Testing simple contract call...');
    
    // Check if we have RPC URL
    if (!process.env.ALCHEMY_ETH_URL) {
      console.error('❌ Missing ALCHEMY_ETH_URL in .env file');
      return;
    }
    
    console.log('✅ RPC URL found');
    
    const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_ETH_URL);
    
    // Test provider connection
    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Connected to Ethereum, block: ${blockNumber}`);
    
    // Test with aUSDC address
    const aUSDCAddress = '0xBcca60bB61934080951369a648Fb03DF4F96263C';
    
    // Create contract with explicit ABI
    const abi = [
      "function name() view returns (string)",
      "function symbol() view returns (string)"
    ];
    
    console.log(`📞 Creating contract for ${aUSDCAddress}...`);
    const contract = new ethers.Contract(aUSDCAddress, abi, provider);
    
    console.log(`📞 Calling name()...`);
    const name = await contract.name();
    console.log(`✅ Name: ${name}`);
    
    console.log(`📞 Calling symbol()...`);
    const symbol = await contract.symbol();
    console.log(`✅ Symbol: ${symbol}`);
    
    console.log('🎉 Contract calls successful!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testSimpleContract();