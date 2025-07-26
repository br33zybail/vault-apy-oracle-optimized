require('dotenv').config();
const { ethers } = require('ethers');

async function testWithCorrectAddress() {
  try {
    console.log('🔗 Testing with correct USDC address...');
    
    const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_ETH_URL);
    
    // Real USDC address on Ethereum mainnet (correct checksum)
    const usdcAddress = '0xA0b86a33E6411c0E00F80C7F8DdFD46C68C1B550';
    
    // Test connection
    const blockNumber = await provider.getBlockNumber();
    console.log('✅ Connected! Current block:', blockNumber);
    
    // Use ethers.getAddress() to fix checksum
    const correctAddress = ethers.getAddress(usdcAddress);
    console.log('Fixed address:', correctAddress);
    
    const erc20ABI = [
      "function name() external view returns (string)",
      "function symbol() external view returns (string)",
      "function decimals() external view returns (uint8)",
      "function totalSupply() external view returns (uint256)"
    ];
    
    const contract = new ethers.Contract(correctAddress, erc20ABI, provider);
    
    console.log('📞 Calling contract methods...');
    
    const symbol = await contract.symbol();
    console.log('✅ Symbol:', symbol);
    
    const name = await contract.name();
    console.log('✅ Name:', name);
    
    const decimals = await contract.decimals();
    console.log('✅ Decimals:', Number(decimals));
    
    const totalSupply = await contract.totalSupply();
    console.log('✅ Total Supply:', ethers.formatUnits(totalSupply, decimals));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    // Let's try with the most common USDC address
    try {
      console.log('🔄 Trying with different USDC address...');
      const realUSDC = '0xA0b86a33E6411c0E00F80C7F8DdFD46C68C1B550';
      const fixed = ethers.getAddress(realUSDC);
      console.log('Trying address:', fixed);
      
    } catch (err) {
      console.log('❌ Address fix failed:', err.message);
      console.log('💡 Let\'s use a known working address...');
      
      // Use Aave USDC (from your original test)
      const aaveUSDC = '0xBcca60bB61934080951369a648Fb03DF4F96263C';
      const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_ETH_URL);
      const contract = new ethers.Contract(aaveUSDC, [
        "function name() view returns (string)",
        "function symbol() view returns (string)"
      ], provider);
      
      const name = await contract.name();
      const symbol = await contract.symbol();
      console.log('✅ Aave token found:', name, symbol);
    }
  }
}

testWithCorrectAddress();