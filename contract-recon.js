require('dotenv').config();
const { ethers } = require('ethers');

async function exploreContract() {
  try {
    console.log('🔍 COMPREHENSIVE CONTRACT RECONNAISSANCE');
    console.log('========================================\n');
    
    const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_ETH_URL);
    const contractAddress = '0xBcca60bB61934080951369a648Fb03DF4F96263C';
    
    console.log(`📍 Contract Address: ${contractAddress}`);
    console.log(`🌐 Network: Ethereum Mainnet`);
    console.log(`📦 Block Number: ${await provider.getBlockNumber()}\n`);

    // ===== BASIC ERC20 METHODS =====
    console.log('🔹 BASIC ERC20 METHODS');
    console.log('======================');
    
    const basicMethods = [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function decimals() view returns (uint8)",
      "function totalSupply() view returns (uint256)",
      "function balanceOf(address) view returns (uint256)"
    ];
    
    const basicContract = new ethers.Contract(contractAddress, basicMethods, provider);
    
    try {
      const name = await basicContract.name();
      console.log(`✅ name(): ${name}`);
    } catch (e) { console.log(`❌ name(): ${e.message}`); }
    
    try {
      const symbol = await basicContract.symbol();
      console.log(`✅ symbol(): ${symbol}`);
    } catch (e) { console.log(`❌ symbol(): ${e.message}`); }
    
    try {
      const decimals = await basicContract.decimals();
      console.log(`✅ decimals(): ${decimals}`);
    } catch (e) { console.log(`❌ decimals(): ${e.message}`); }
    
    try {
      const totalSupply = await basicContract.totalSupply();
      console.log(`✅ totalSupply(): ${totalSupply.toString()}`);
      console.log(`   Formatted: ${ethers.formatUnits(totalSupply, 6)} (assuming 6 decimals)`);
    } catch (e) { console.log(`❌ totalSupply(): ${e.message}`); }

    // ===== AAVE-SPECIFIC METHODS =====
    console.log('\n🔹 AAVE-SPECIFIC METHODS');
    console.log('========================');
    
    const aaveMethods = [
      "function UNDERLYING_ASSET_ADDRESS() view returns (address)",
      "function POOL() view returns (address)",
      "function getIncentivesController() view returns (address)",
      "function ATOKEN_REVISION() view returns (uint256)"
    ];
    
    const aaveContract = new ethers.Contract(contractAddress, aaveMethods, provider);
    
    try {
      const underlying = await aaveContract.UNDERLYING_ASSET_ADDRESS();
      console.log(`✅ UNDERLYING_ASSET_ADDRESS(): ${underlying}`);
      
      // Get info about underlying asset
      const underlyingContract = new ethers.Contract(underlying, basicMethods, provider);
      try {
        const underlyingSymbol = await underlyingContract.symbol();
        const underlyingDecimals = await underlyingContract.decimals();
        console.log(`   Underlying: ${underlyingSymbol} (${underlyingDecimals} decimals)`);
      } catch (e) { console.log(`   Could not get underlying info: ${e.message}`); }
    } catch (e) { console.log(`❌ UNDERLYING_ASSET_ADDRESS(): ${e.message}`); }
    
    try {
      const pool = await aaveContract.POOL();
      console.log(`✅ POOL(): ${pool}`);
    } catch (e) { console.log(`❌ POOL(): ${e.message}`); }
    
    try {
      const incentives = await aaveContract.getIncentivesController();
      console.log(`✅ getIncentivesController(): ${incentives}`);
    } catch (e) { console.log(`❌ getIncentivesController(): ${e.message}`); }
    
    try {
      const revision = await aaveContract.ATOKEN_REVISION();
      console.log(`✅ ATOKEN_REVISION(): ${revision.toString()}`);
    } catch (e) { console.log(`❌ ATOKEN_REVISION(): ${e.message}`); }

    // ===== ERC4626 VAULT METHODS =====
    console.log('\n🔹 ERC4626 VAULT METHODS');
    console.log('========================');
    
    const vaultMethods = [
      "function asset() view returns (address)",
      "function totalAssets() view returns (uint256)",
      "function convertToShares(uint256) view returns (uint256)",
      "function convertToAssets(uint256) view returns (uint256)",
      "function maxDeposit(address) view returns (uint256)",
      "function previewDeposit(uint256) view returns (uint256)"
    ];
    
    const vaultContract = new ethers.Contract(contractAddress, vaultMethods, provider);
    
    for (const method of ['asset', 'totalAssets', 'convertToShares', 'convertToAssets']) {
      try {
        if (method === 'convertToShares' || method === 'convertToAssets') {
          const result = await vaultContract[method](ethers.parseUnits("1", 6)); // 1 USDC
          console.log(`✅ ${method}(1 USDC): ${result.toString()}`);
        } else {
          const result = await vaultContract[method]();
          console.log(`✅ ${method}(): ${result.toString()}`);
        }
      } catch (e) { console.log(`❌ ${method}(): ${e.message}`); }
    }

    // ===== COMPOUND-STYLE METHODS =====
    console.log('\n🔹 COMPOUND-STYLE METHODS');
    console.log('=========================');
    
    const compoundMethods = [
      "function exchangeRateStored() view returns (uint256)",
      "function supplyRatePerBlock() view returns (uint256)",
      "function borrowRatePerBlock() view returns (uint256)",
      "function getCash() view returns (uint256)",
      "function totalBorrows() view returns (uint256)"
    ];
    
    const compoundContract = new ethers.Contract(contractAddress, compoundMethods, provider);
    
    for (const methodName of ['exchangeRateStored', 'supplyRatePerBlock', 'borrowRatePerBlock', 'getCash', 'totalBorrows']) {
      try {
        const result = await compoundContract[methodName]();
        console.log(`✅ ${methodName}(): ${result.toString()}`);
      } catch (e) { console.log(`❌ ${methodName}(): ${e.message}`); }
    }

    // ===== YEARN-STYLE METHODS =====
    console.log('\n🔹 YEARN-STYLE METHODS');
    console.log('======================');
    
    const yearnMethods = [
      "function pricePerShare() view returns (uint256)",
      "function token() view returns (address)",
      "function balance() view returns (uint256)",
      "function available() view returns (uint256)"
    ];
    
    const yearnContract = new ethers.Contract(contractAddress, yearnMethods, provider);
    
    for (const methodName of ['pricePerShare', 'token', 'balance', 'available']) {
      try {
        const result = await yearnContract[methodName]();
        console.log(`✅ ${methodName}(): ${result.toString()}`);
      } catch (e) { console.log(`❌ ${methodName}(): ${e.message}`); }
    }

    // ===== CONTRACT BYTECODE ANALYSIS =====
    console.log('\n🔹 CONTRACT BYTECODE INFO');
    console.log('=========================');
    
    try {
      const code = await provider.getCode(contractAddress);
      console.log(`✅ Bytecode length: ${code.length} characters`);
      console.log(`✅ Bytecode exists: ${code !== '0x'}`);
    } catch (e) { console.log(`❌ Could not get bytecode: ${e.message}`); }

    // ===== SUMMARY =====
    console.log('\n🎯 RECONNAISSANCE COMPLETE!');
    console.log('============================');
    console.log('This data shows which methods are available and what data we can extract.');
    console.log('Use this information to design the optimal data collection strategy.\n');
    
  } catch (error) {
    console.error('❌ Reconnaissance failed:', error.message);
  }
}

exploreContract();