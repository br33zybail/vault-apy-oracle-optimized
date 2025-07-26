// src/collectors/onchain/vault-onchain-collector.js
const { ethers } = require('ethers');

class VaultOnChainCollector {
  constructor() {
    this.providers = {
      ethereum: new ethers.JsonRpcProvider(process.env.ALCHEMY_ETH_URL),
      base: new ethers.JsonRpcProvider(process.env.ALCHEMY_BASE_URL),
      arbitrum: new ethers.JsonRpcProvider(process.env.ALCHEMY_ARBITRUM_URL),
      polygon: new ethers.JsonRpcProvider(process.env.ALCHEMY_POLYGON_URL),
      optimism: new ethers.JsonRpcProvider(process.env.ALCHEMY_OPTIMISM_URL),
      avalanche: new ethers.JsonRpcProvider(process.env.ALCHEMY_AVALANCHE_URL)
    };

    // Common ERC4626 Vault ABI (standardized vault interface)
    this.vaultABI = [
      "function totalAssets() external view returns (uint256)",
      "function totalSupply() external view returns (uint256)", 
      "function asset() external view returns (address)",
      "function name() external view returns (string)",
      "function symbol() external view returns (string)",
      "function decimals() external view returns (uint8)",
      "function convertToAssets(uint256 shares) external view returns (uint256)",
      "function previewWithdraw(uint256 assets) external view returns (uint256)"
    ];

    // ERC20 ABI for asset tokens
    this.erc20ABI = [
      "function balanceOf(address owner) external view returns (uint256)",
      "function decimals() external view returns (uint8)",
      "function symbol() external view returns (string)",
      "function name() external view returns (string)"
    ];

    // Protocol-specific ABIs
    this.protocolABIs = {
      aave: [
        "function getReserveData(address asset) external view returns (tuple(uint256 liquidityIndex, uint256 currentLiquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 lastUpdateTimestamp))"
      ],
      compound: [
        "function supplyRatePerBlock() external view returns (uint256)",
        "function borrowRatePerBlock() external view returns (uint256)",
        "function totalSupply() external view returns (uint256)",
        "function totalBorrows() external view returns (uint256)",
        "function getCash() external view returns (uint256)"
      ],
      yearn: [
        "function pricePerShare() external view returns (uint256)",
        "function totalAssets() external view returns (uint256)"
      ]
    };
  }

  async getVaultOnChainData(vaultAddress, chain, protocol = null) {
    try {
      console.log(`📡 Getting on-chain data for ${vaultAddress} on ${chain}`);
      
      const provider = this.providers[chain];
      if (!provider) {
        throw new Error(`No provider configured for chain: ${chain}`);
      }

      // Validate and normalize the address
      if (!vaultAddress || !vaultAddress.startsWith('0x') || vaultAddress.length !== 42) {
        throw new Error(`Invalid vault address format: ${vaultAddress}`);
      }

      // Try different approaches based on vault type
      let vaultData = {};

      // 1. Try basic ERC20 data first (most reliable)
      try {
        vaultData = await this.getBasicTokenData(vaultAddress, provider);
        vaultData.vault_type = 'basic_token';
        console.log(`✅ Got basic token data for ${vaultData.symbol}`);
      } catch (error) {
        console.log(`Basic token failed: ${error.message}`);
      }

      // 2. Try protocol-specific methods if we have protocol info
      if (protocol && (!vaultData.total_assets || vaultData.total_assets === '0.0')) {
        try {
          const protocolData = await this.getProtocolSpecificData(vaultAddress, provider, protocol);
          vaultData = { ...vaultData, ...protocolData };
          vaultData.vault_type = protocol;
          console.log(`✅ Enhanced with ${protocol} data`);
        } catch (error) {
          console.log(`Protocol-specific method failed: ${error.message}`);
        }
      }

      // 3. Try ERC4626 standard (most modern vaults)
      if (!vaultData.asset_address) {
        try {
          const erc4626Data = await this.getERC4626Data(vaultAddress, provider);
          vaultData = { ...vaultData, ...erc4626Data };
          vaultData.vault_type = 'erc4626';
          console.log(`✅ Enhanced with ERC4626 data`);
        } catch (error) {
          console.log(`ERC4626 failed: ${error.message}`);
        }
      }

      return {
        ...vaultData,
        vault_address: vaultAddress,
        chain,
        data_source: 'onchain',
        timestamp: Date.now(),
        block_number: await provider.getBlockNumber()
      };

    } catch (error) {
      console.error(`❌ On-chain data collection failed for ${vaultAddress}:`, error.message);
      return null;
    }
  }

  async getERC4626Data(vaultAddress, provider) {
    const vaultContract = new ethers.Contract(vaultAddress, this.vaultABI, provider);
    
    try {
      const [
        totalAssets,
        totalSupply,
        assetAddress,
        name,
        symbol,
        decimals
      ] = await Promise.all([
        vaultContract.totalAssets(),
        vaultContract.totalSupply(),
        vaultContract.asset(),
        vaultContract.name(),
        vaultContract.symbol(),
        vaultContract.decimals()
      ]);

      // Get asset token info
      const assetContract = new ethers.Contract(assetAddress, this.erc20ABI, provider);
      const [assetSymbol, assetDecimals] = await Promise.all([
        assetContract.symbol(),
        assetContract.decimals()
      ]);

      // Calculate share price (assets per share) - handle BigInt properly
      const sharePrice = totalSupply > 0n 
        ? Number(totalAssets) / Number(totalSupply)
        : 1;

      return {
        name,
        symbol,
        decimals: Number(decimals),
        total_assets: ethers.formatUnits(totalAssets, assetDecimals),
        total_supply: ethers.formatUnits(totalSupply, decimals),
        asset_address: assetAddress,
        asset_symbol: assetSymbol,
        asset_decimals: Number(assetDecimals),
        share_price: sharePrice,
        utilization_rate: null
      };
    } catch (error) {
      throw new Error(`ERC4626 method failed: ${error.message}`);
    }
  }

  async getProtocolSpecificData(vaultAddress, provider, protocol) {
    switch (protocol.toLowerCase()) {
      case 'aave':
      case 'aave-v3':
        return await this.getAaveData(vaultAddress, provider);
      
      case 'compound':
      case 'compound-v3':
        return await this.getCompoundData(vaultAddress, provider);
      
      case 'yearn':
        return await this.getYearnData(vaultAddress, provider);
      
      default:
        throw new Error(`Protocol ${protocol} not supported`);
    }
  }

  async getAaveData(vaultAddress, provider) {
    try {
      console.log(`📞 Calling Aave token methods for ${vaultAddress}...`);
      
      // Start with basic ERC20 calls
      const tokenContract = new ethers.Contract(vaultAddress, this.erc20ABI, provider);
      
      const name = await tokenContract.name().catch(() => 'Unknown Aave Token');
      const symbol = await tokenContract.symbol().catch(() => 'aUNKNOWN');
      const decimals = await tokenContract.decimals().catch(() => 18);
      const totalSupply = await tokenContract.totalSupply().catch(() => 0n);
      
      console.log(`✅ Aave token data: ${name} (${symbol})`);

      // Try to get underlying asset (optional for aTokens)
      let underlyingAsset = null;
      let assetSymbol = symbol.replace('a', ''); // Remove 'a' prefix as fallback
      
      try {
        const aTokenContract = new ethers.Contract(vaultAddress, [
          "function UNDERLYING_ASSET_ADDRESS() external view returns (address)"
        ], provider);
        
        underlyingAsset = await aTokenContract.UNDERLYING_ASSET_ADDRESS();
        
        if (underlyingAsset) {
          const assetContract = new ethers.Contract(underlyingAsset, this.erc20ABI, provider);
          assetSymbol = await assetContract.symbol().catch(() => assetSymbol);
        }
      } catch (error) {
        console.log(`Could not get underlying asset: ${error.message}`);
      }

      return {
        name,
        symbol,
        decimals: Number(decimals),
        total_assets: ethers.formatUnits(totalSupply, decimals),
        total_supply: ethers.formatUnits(totalSupply, decimals),
        asset_address: underlyingAsset,
        asset_symbol: assetSymbol,
        share_price: 1.0
      };
    } catch (error) {
      throw new Error(`Aave data collection failed: ${error.message}`);
    }
  }

  async getCompoundData(vaultAddress, provider) {
    const cTokenContract = new ethers.Contract(vaultAddress, [
      ...this.erc20ABI,
      ...this.protocolABIs.compound,
      "function underlying() external view returns (address)",
      "function exchangeRateStored() external view returns (uint256)"
    ], provider);

    const [
      name,
      symbol,
      decimals,
      totalSupply,
      supplyRate,
      exchangeRate,
      totalBorrows,
      cash
    ] = await Promise.all([
      cTokenContract.name(),
      cTokenContract.symbol(),
      cTokenContract.decimals(),
      cTokenContract.totalSupply(),
      cTokenContract.supplyRatePerBlock(),
      cTokenContract.exchangeRateStored(),
      cTokenContract.totalBorrows(),
      cTokenContract.getCash()
    ]);

    // Calculate utilization rate
    const totalAssets = cash + totalBorrows;
    const utilizationRate = totalAssets > 0 ? Number(totalBorrows) / Number(totalAssets) : 0;

    // Convert supply rate (per block) to APY
    const blocksPerYear = 2102400; // Ethereum blocks per year
    const supplyAPY = (Math.pow(1 + Number(supplyRate) / 1e18, blocksPerYear) - 1) * 100;

    return {
      name,
      symbol,
      decimals: Number(decimals),
      total_assets: ethers.formatEther(totalAssets),
      total_supply: ethers.formatUnits(totalSupply, decimals),
      share_price: Number(exchangeRate) / 1e18,
      supply_apy: supplyAPY,
      utilization_rate: utilizationRate,
      total_borrows: ethers.formatEther(totalBorrows)
    };
  }

  async getYearnData(vaultAddress, provider) {
    const yearnContract = new ethers.Contract(vaultAddress, [
      ...this.erc20ABI,
      ...this.protocolABIs.yearn,
      "function token() external view returns (address)"
    ], provider);

    const [
      name,
      symbol,
      decimals,
      totalSupply,
      totalAssets,
      pricePerShare,
      tokenAddress
    ] = await Promise.all([
      yearnContract.name(),
      yearnContract.symbol(),
      yearnContract.decimals(),
      yearnContract.totalSupply(),
      yearnContract.totalAssets(),
      yearnContract.pricePerShare(),
      yearnContract.token()
    ]);

    // Get underlying token info
    const tokenContract = new ethers.Contract(tokenAddress, this.erc20ABI, provider);
    const [tokenSymbol, tokenDecimals] = await Promise.all([
      tokenContract.symbol(),
      tokenContract.decimals()
    ]);

    return {
      name,
      symbol,
      decimals: Number(decimals),
      total_assets: ethers.formatUnits(totalAssets, tokenDecimals),
      total_supply: ethers.formatUnits(totalSupply, decimals),
      asset_address: tokenAddress,
      asset_symbol: tokenSymbol,
      share_price: Number(pricePerShare) / Math.pow(10, Number(decimals))
    };
  }

  async getBasicTokenData(vaultAddress, provider) {
    try {
      console.log(`📞 Creating contract for ${vaultAddress}...`);
      
      // Create contract with minimal ABI first
      const minimalABI = [
        "function name() view returns (string)",
        "function symbol() view returns (string)", 
        "function decimals() view returns (uint8)",
        "function totalSupply() view returns (uint256)"
      ];
      
      const tokenContract = new ethers.Contract(vaultAddress, minimalABI, provider);
      
      console.log(`📞 Contract created, calling methods...`);
      
      // Test connection first
      try {
        const decimals = await tokenContract.decimals();
        console.log(`✅ Contract responsive, decimals: ${decimals}`);
      } catch (error) {
        console.log(`❌ Contract test failed: ${error.message}`);
        throw new Error(`Contract not responsive: ${error.message}`);
      }
      
      // Call methods individually with detailed error handling
      let name, symbol, decimals, totalSupply;
      
      try {
        name = await tokenContract.name();
        console.log(`✅ Got name: ${name}`);
      } catch (error) {
        console.log(`⚠️ Name failed: ${error.message}`);
        name = 'Unknown Token';
      }
      
      try {
        symbol = await tokenContract.symbol();
        console.log(`✅ Got symbol: ${symbol}`);
      } catch (error) {
        console.log(`⚠️ Symbol failed: ${error.message}`);
        symbol = 'UNKNOWN';
      }
      
      try {
        decimals = await tokenContract.decimals();
        console.log(`✅ Got decimals: ${decimals}`);
      } catch (error) {
        console.log(`⚠️ Decimals failed: ${error.message}`);
        decimals = 18n;
      }
      
      try {
        totalSupply = await tokenContract.totalSupply();
        console.log(`✅ Got totalSupply: ${totalSupply}`);
      } catch (error) {
        console.log(`⚠️ TotalSupply failed: ${error.message}`);
        totalSupply = 0n;
      }

      console.log(`✅ Basic token data: ${name} (${symbol})`);

      return {
        name,
        symbol,
        decimals: Number(decimals),
        total_supply: ethers.formatUnits(totalSupply, decimals),
        total_assets: ethers.formatUnits(totalSupply, decimals),
        asset_symbol: symbol,
        share_price: 1.0
      };
    } catch (error) {
      console.error(`❌ Basic token data failed: ${error.message}`);
      throw new Error(`Basic token data failed: ${error.message}`);
    }
  }

  async batchGetVaultData(vaultList) {
    console.log(`📡 Getting on-chain data for ${vaultList.length} vaults`);
    
    const results = [];
    const BATCH_SIZE = 5; // Avoid rate limiting

    for (let i = 0; i < vaultList.length; i += BATCH_SIZE) {
      const batch = vaultList.slice(i, i + BATCH_SIZE);
      
      const batchPromises = batch.map(({ vault_address, chain, protocol }) =>
        this.getVaultOnChainData(vault_address, chain, protocol)
          .catch(error => {
            console.error(`Failed to get data for ${vault_address}: ${error.message}`);
            return null;
          })
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(result => result !== null));
      
      // Rate limiting delay
      if (i + BATCH_SIZE < vaultList.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`📊 Successfully collected on-chain data for ${results.length}/${vaultList.length} vaults`);
    return results;
  }

  // Validate on-chain data against API data
  validateData(onChainData, apiData) {
    const validations = {
      tvl_match: false,
      name_match: false,
      asset_match: false,
      data_freshness: 'unknown'
    };

    try {
      // Check if TVL is reasonably close (within 10%)
      if (onChainData.total_assets && apiData.tvl_usd) {
        const onChainTVL = parseFloat(onChainData.total_assets);
        const apiTVL = apiData.tvl_usd;
        const difference = Math.abs(onChainTVL - apiTVL) / apiTVL;
        validations.tvl_match = difference < 0.1; // Within 10%
      }

      // Check name similarity
      if (onChainData.name && apiData.name) {
        validations.name_match = onChainData.name.toLowerCase().includes(
          apiData.name.toLowerCase().split(' ')[0]
        );
      }

      // Check asset symbol match
      if (onChainData.asset_symbol && apiData.asset_symbol) {
        validations.asset_match = onChainData.asset_symbol.toLowerCase() === 
          apiData.asset_symbol.toLowerCase();
      }

      // Data freshness (block age)
      const blockAge = Date.now() - onChainData.timestamp;
      if (blockAge < 300000) validations.data_freshness = 'fresh'; // < 5 minutes
      else if (blockAge < 3600000) validations.data_freshness = 'recent'; // < 1 hour  
      else validations.data_freshness = 'stale';

    } catch (error) {
      console.error('Data validation failed:', error.message);
    }

    return validations;
  }
}

module.exports = VaultOnChainCollector;