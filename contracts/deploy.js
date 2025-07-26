// Deployment script for VaultAPYConsumer contract
const { ethers } = require('hardhat');

async function main() {
    console.log('🚀 Deploying VaultAPYConsumer Contract...');
    
    // Network configuration
    const networkConfig = {
        // Ethereum Sepolia Testnet
        11155111: {
            name: 'Sepolia',
            linkToken: '0x779877A7B0D9E8603169DdbD7836e478b4624789',
            fee: ethers.parseEther('0.1'), // 0.1 LINK
        },
        // Polygon Mumbai Testnet  
        80001: {
            name: 'Mumbai',
            linkToken: '0x326C977E6efc84E512bB9C30f76E30c160eD06FB',
            fee: ethers.parseEther('0.1'),
        },
        // Ethereum Mainnet
        1: {
            name: 'Mainnet',
            linkToken: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
            fee: ethers.parseEther('0.1'),
        },
        // Polygon Mainnet
        137: {
            name: 'Polygon',
            linkToken: '0xb0897686c545045aFc77CF20eC7A532E3120E0F1',
            fee: ethers.parseEther('0.1'),
        },
        // Base Mainnet
        8453: {
            name: 'Base',
            linkToken: '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196',
            fee: ethers.parseEther('0.1'),
        }
    };
    
    // Get network info
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);
    const config = networkConfig[chainId];
    
    if (!config) {
        throw new Error(`No configuration found for chain ID ${chainId}`);
    }
    
    console.log(`📡 Deploying to ${config.name} (Chain ID: ${chainId})`);
    
    // Get deployment parameters from environment or prompt
    const ORACLE_ADDRESS = process.env.CHAINLINK_ORACLE_ADDRESS;
    const JOB_ID = process.env.CHAINLINK_JOB_ID;
    
    if (!ORACLE_ADDRESS || !JOB_ID) {
        console.error(`❌ Missing required environment variables:`);
        console.error(`   CHAINLINK_ORACLE_ADDRESS: ${ORACLE_ADDRESS || 'NOT SET'}`);
        console.error(`   CHAINLINK_JOB_ID: ${JOB_ID || 'NOT SET'}`);
        console.error(`\nPlease set these in your .env file:`);
        console.error(`   CHAINLINK_ORACLE_ADDRESS=your_chainlink_node_address`);
        console.error(`   CHAINLINK_JOB_ID=your_job_id_bytes32`);
        process.exit(1);
    }
    
    // Convert job ID to bytes32 if it's a string
    const jobIdBytes32 = JOB_ID.startsWith('0x') ? JOB_ID : ethers.id(JOB_ID);
    
    console.log(`📋 Deployment Parameters:`);
    console.log(`   LINK Token: ${config.linkToken}`);
    console.log(`   Oracle: ${ORACLE_ADDRESS}`);
    console.log(`   Job ID: ${jobIdBytes32}`);
    console.log(`   Fee: ${ethers.formatEther(config.fee)} LINK`);
    
    // Get deployer
    const [deployer] = await ethers.getSigners();
    console.log(`👤 Deployer: ${deployer.address}`);
    console.log(`💰 Balance: ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`);
    
    // Deploy contract
    const VaultAPYConsumer = await ethers.getContractFactory('VaultAPYConsumer');
    
    console.log(`⏳ Deploying contract...`);
    const vaultConsumer = await VaultAPYConsumer.deploy(
        config.linkToken,
        ORACLE_ADDRESS,
        jobIdBytes32,
        config.fee
    );
    
    await vaultConsumer.waitForDeployment();
    const contractAddress = await vaultConsumer.getAddress();
    
    console.log(`✅ VaultAPYConsumer deployed to: ${contractAddress}`);
    
    // Verify deployment
    console.log(`\n🔍 Verifying deployment...`);
    
    try {
        const fee = await vaultConsumer.getFee();
        const jobId = await vaultConsumer.getJobId();
        const linkBalance = await vaultConsumer.getLinkBalance();
        
        console.log(`✅ Fee: ${ethers.formatEther(fee)} LINK`);
        console.log(`✅ Job ID: ${jobId}`);
        console.log(`✅ LINK Balance: ${ethers.formatEther(linkBalance)} LINK`);
        
        console.log(`\n📝 Deployment Summary:`);
        console.log(`   Network: ${config.name} (${chainId})`);
        console.log(`   Contract: ${contractAddress}`);
        console.log(`   Deployer: ${deployer.address}`);
        console.log(`   Gas Used: ${(await vaultConsumer.deploymentTransaction()).gasLimit}`);
        
    } catch (error) {
        console.error(`❌ Verification failed:`, error.message);
    }
    
    // Fund with LINK if requested
    if (process.env.FUND_WITH_LINK && process.env.FUND_WITH_LINK !== '0') {
        console.log(`\n💰 Funding contract with LINK...`);
        
        try {
            const linkAmount = ethers.parseEther(process.env.FUND_WITH_LINK);
            
            // Get LINK token contract
            const linkABI = [
                'function transfer(address to, uint256 amount) returns (bool)',
                'function balanceOf(address account) view returns (uint256)'
            ];
            const linkContract = new ethers.Contract(config.linkToken, linkABI, deployer);
            
            // Check deployer's LINK balance
            const deployerLinkBalance = await linkContract.balanceOf(deployer.address);
            
            if (deployerLinkBalance < linkAmount) {
                console.error(`❌ Insufficient LINK balance. Have: ${ethers.formatEther(deployerLinkBalance)}, Need: ${ethers.formatEther(linkAmount)}`);
            } else {
                // Transfer LINK to contract
                const tx = await linkContract.transfer(contractAddress, linkAmount);
                await tx.wait();
                
                console.log(`✅ Funded contract with ${ethers.formatEther(linkAmount)} LINK`);
                console.log(`   Transaction: ${tx.hash}`);
                
                // Verify funding
                const newBalance = await vaultConsumer.getLinkBalance();
                console.log(`✅ Contract LINK balance: ${ethers.formatEther(newBalance)} LINK`);
            }
            
        } catch (error) {
            console.error(`❌ Funding failed:`, error.message);
        }
    }
    
    // Output integration info
    console.log(`\n🔧 Integration Information:`);
    console.log(`\n// Contract Address`);
    console.log(`const contractAddress = "${contractAddress}";`);
    console.log(`\n// Network Configuration`);
    console.log(`const networkConfig = {`);
    console.log(`  chainId: ${chainId},`);
    console.log(`  name: "${config.name}",`);
    console.log(`  linkToken: "${config.linkToken}",`);
    console.log(`  oracle: "${ORACLE_ADDRESS}",`);
    console.log(`  fee: "${config.fee.toString()}" // ${ethers.formatEther(config.fee)} LINK`);
    console.log(`};`);
    
    console.log(`\n📞 Usage Examples:`);
    console.log(`\n// Get best USDC vault`);
    console.log(`await contract.requestBestVault("USDC", "medium", true);`);
    console.log(`\n// Get top 20 protocols`);
    console.log(`await contract.requestProtocolList("USDC", 1000000, 20);`);
    
    if (process.env.VERIFY_ON_ETHERSCAN === 'true') {
        console.log(`\n📋 Etherscan Verification:`);
        console.log(`npx hardhat verify --network ${config.name.toLowerCase()} ${contractAddress} "${config.linkToken}" "${ORACLE_ADDRESS}" "${jobIdBytes32}" "${config.fee.toString()}"`);
    }
    
    console.log(`\n🎉 Deployment complete!`);
}

// Error handling
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(`❌ Deployment failed:`, error);
        process.exit(1);
    });