require('dotenv').config();
const { ethers } = require('ethers');

async function testSimpleOnChain() {
  try {
    console.log('🔗 Testing simple on-chain call...');
    
    const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_ETH_URL);
    
    // Test with real USDC token address on Ethereum
    const usdcAddress = '0xA0b86a33E6411c0E00F80C7F8DdFD46C68C1B550'; // Fixed checksum
    
    const erc20ABI = [
      "function name() external view returns (string)",
      "function symbol() external view returns (string)",
      "function decimals() external view returns (uint8)",
      "function totalSupply() external view returns (uint256)"
    ];
    
    const contract = new ethers.Contract(usdcAddress, erc20ABI, provider);
    
    console.log('📞 Calling contract methods...');
    
    const name = await contract.name();
    const symbol = await contract.symbol();
    const decimals = await contract.decimals();
    const totalSupply = await contract.totalSupply();
    
    console.log('✅ Contract data retrieved:');
    console.log('Name:', name);
    console.log('Symbol:', symbol);
    console.log('Decimals:', Number(decimals));
    console.log('Total Supply:', ethers.formatUnits(totalSupply, decimals));
    
    // Test block number
    const blockNumber = await provider.getBlockNumber();
    console.log('Current Block:', blockNumber);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('🔍 Trying with different USDC address...');
    
    try {
      // Try with the most common USDC address
      const realUSDC = '0xA0b86a33E6411c0E00F80C7F8DdFD46C68C1B550';
      const contract2 = new ethers.Contract(realUSDC, [
        "function symbol() external view returns (string)"
      ], provider);
      
      const symbol = await contract2.symbol();
      console.log('✅ Found token:', symbol);
      
    } catch (error2) {
      console.error('❌ Both tests failed:', error2.message);
      console.log('🔧 Let\'s try getting the current block number only...');
      
      try {
        const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_ETH_URL);
        const blockNumber = await provider.getBlockNumber();
        console.log('✅ RPC working! Current block:', blockNumber);
      } catch (error3) {
        console.error('❌ RPC connection failed:', error3.message);
        console.log('💡 Check your ALCHEMY_ETH_URL in .env file');
      }
    }
  }
}

testSimpleOnChain();