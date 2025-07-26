# VaultAPYConsumer Contract

A Chainlink consumer contract that provides DeFi vault APY data and protocol listings for 0.1 LINK per query.

## 📋 Features

- **Best Vault Query**: Get the highest APY vault for a specific asset and risk level
- **Protocol Listing**: Get a list of all protocols with their APYs for an asset  
- **Enhanced Calculations**: Optional on-chain APY calculations for higher accuracy
- **Risk Management**: Built-in risk scoring and filtering
- **Multi-Chain Support**: Ethereum, Base, Arbitrum, Polygon, Optimism

## 🚀 Quick Start

### 1. Deploy the Contract

```solidity
// Constructor parameters
address linkToken = 0x326C977E6efc84E512bB9C30f76E30c160eD06FB; // LINK token address
address oracle = YOUR_CHAINLINK_NODE_ADDRESS;
bytes32 jobId = "YOUR_JOB_ID";
uint256 fee = 100000000000000000; // 0.1 LINK in wei
```

### 2. Fund with LINK

```solidity
// Transfer LINK to the contract for making requests
IERC20(linkToken).transfer(contractAddress, amount);
```

### 3. Make Requests

```solidity
// Get best vault for USDC with medium risk
bytes32 requestId = vaultConsumer.requestBestVault("USDC", "medium", true);

// Get top 20 protocols for USDC with minimum $1M TVL
bytes32 requestId = vaultConsumer.requestProtocolList("USDC", 1000000, 20);
```

## 📊 Contract Functions

### Query Functions

#### `requestBestVault(asset, riskLevel, enhanced)`
Request the best vault for a specific asset and risk level.

**Parameters:**
- `asset` (string): Asset symbol ("USDC", "USDT", "ETH", etc.)
- `riskLevel` (string): Risk tolerance ("low", "medium", "high")
- `enhanced` (bool): Use enhanced on-chain APY calculations

**Returns:** `bytes32 requestId`

**Cost:** 0.1 LINK

#### `requestProtocolList(asset, minTvl, maxResults)`
Request a list of protocols with their APYs for a specific asset.

**Parameters:**
- `asset` (string): Asset symbol 
- `minTvl` (uint256): Minimum TVL in USD (0 for no filter)
- `maxResults` (uint256): Maximum results (1-50)

**Returns:** `bytes32 requestId`

**Cost:** 0.1 LINK

### View Functions

#### `getLatestBestVault()`
Get the most recent best vault result.

**Returns:**
```solidity
struct BestVaultResult {
    string vaultAddress;    // Vault contract address
    uint256 apy;           // APY in basis points (500 = 5.00%)
    string protocol;       // Protocol name (e.g., "aave-v3")
    string chain;          // Blockchain name (e.g., "ethereum")
    uint256 tvlUsd;        // Total Value Locked in USD
    uint256 riskScore;     // Risk score 0-100 (higher = safer)
    uint256 confidence;    // Confidence score 0-100
    uint256 timestamp;     // Result timestamp
    bool isValid;          // Result validity flag
}
```

#### `getLatestProtocolList()`
Get the most recent protocol list.

**Returns:** `ProtocolAPY[]`

```solidity
struct ProtocolAPY {
    string protocol;       // Protocol name
    string chain;          // Blockchain name  
    uint256 apy;          // APY in basis points
    uint256 tvlUsd;       // TVL in USD
    string vaultAddress;  // Vault address
    uint256 confidence;   // Confidence score
    uint256 timestamp;    // Result timestamp
    bool isValid;         // Validity flag
}
```

#### `getBestVaultResult(requestId)`
Get the best vault result for a specific request ID.

#### `getProtocolList(requestId)`
Get the protocol list for a specific request ID.

#### `getUserRequests(address)`
Get all request IDs made by a user.

## 💰 Pricing

**All queries cost 0.1 LINK** regardless of complexity:

- ✅ Best vault query: 0.1 LINK
- ✅ Protocol listing (up to 50 results): 0.1 LINK  
- ✅ Enhanced APY calculations: 0.1 LINK
- ✅ Multi-chain queries: 0.1 LINK

## 🔧 Integration Examples

### Web3.js Example

```javascript
const Web3 = require('web3');
const contractABI = [...]; // Contract ABI
const contractAddress = "0x..."; // Deployed contract address

const web3 = new Web3('YOUR_RPC_URL');
const contract = new web3.eth.Contract(contractABI, contractAddress);

// Request best USDC vault
async function getBestUSDCVault() {
    const tx = await contract.methods
        .requestBestVault("USDC", "medium", true)
        .send({ from: userAddress });
        
    console.log("Request ID:", tx.events.BestVaultRequested.returnValues.requestId);
    
    // Wait for fulfillment, then check result
    setTimeout(async () => {
        const result = await contract.methods.getLatestBestVault().call();
        console.log("Best vault APY:", result.apy / 100, "%");
        console.log("Protocol:", result.protocol);
        console.log("Chain:", result.chain);
    }, 30000); // Wait 30 seconds
}

// Request protocol list
async function getProtocolList() {
    const tx = await contract.methods
        .requestProtocolList("USDC", 1000000, 20) // Min $1M TVL, max 20 results
        .send({ from: userAddress });
        
    console.log("Request ID:", tx.events.ProtocolListRequested.returnValues.requestId);
    
    // Check results after fulfillment
    setTimeout(async () => {
        const protocols = await contract.methods.getLatestProtocolList().call();
        protocols.forEach(p => {
            console.log(`${p.protocol}: ${p.apy / 100}% APY, $${p.tvlUsd.toLocaleString()} TVL`);
        });
    }, 30000);
}
```

### Ethers.js Example

```javascript
const { ethers } = require('ethers');

const provider = new ethers.providers.JsonRpcProvider('YOUR_RPC_URL');
const signer = new ethers.Wallet('YOUR_PRIVATE_KEY', provider);
const contract = new ethers.Contract(contractAddress, contractABI, signer);

// Request best vault
async function requestBestVault() {
    const tx = await contract.requestBestVault("USDC", "medium", true);
    await tx.wait();
    
    console.log("Transaction hash:", tx.hash);
    
    // Listen for fulfillment
    contract.on("BestVaultReceived", (requestId, vaultAddress, apy) => {
        console.log(`Best vault: ${vaultAddress} with ${apy / 100}% APY`);
    });
}
```

### Frontend Integration

```html
<!DOCTYPE html>
<html>
<head>
    <title>Vault APY Oracle</title>
    <script src="https://cdn.jsdelivr.net/npm/web3@latest/dist/web3.min.js"></script>
</head>
<body>
    <h1>DeFi Vault APY Oracle</h1>
    
    <div>
        <h2>Get Best Vault</h2>
        <select id="asset">
            <option value="USDC">USDC</option>
            <option value="USDT">USDT</option>
            <option value="DAI">DAI</option>
        </select>
        <select id="risk">
            <option value="low">Low Risk</option>
            <option value="medium">Medium Risk</option>
            <option value="high">High Risk</option>
        </select>
        <button onclick="getBestVault()">Get Best Vault (0.1 LINK)</button>
    </div>
    
    <div>
        <h2>Get Protocol List</h2>
        <input type="number" id="maxResults" placeholder="Max Results (1-50)" value="20">
        <button onclick="getProtocolList()">Get Protocols (0.1 LINK)</button>
    </div>
    
    <div id="results"></div>
    
    <script>
        const contractAddress = "YOUR_CONTRACT_ADDRESS";
        const contractABI = [...]; // Your contract ABI
        
        let web3, contract, userAccount;
        
        async function connectWallet() {
            if (window.ethereum) {
                web3 = new Web3(window.ethereum);
                await ethereum.request({ method: 'eth_requestAccounts' });
                const accounts = await web3.eth.getAccounts();
                userAccount = accounts[0];
                contract = new web3.eth.Contract(contractABI, contractAddress);
                
                console.log("Connected to:", userAccount);
            } else {
                alert("Please install MetaMask!");
            }
        }
        
        async function getBestVault() {
            if (!contract) await connectWallet();
            
            const asset = document.getElementById('asset').value;
            const risk = document.getElementById('risk').value;
            
            try {
                const tx = await contract.methods
                    .requestBestVault(asset, risk, true)
                    .send({ from: userAccount });
                    
                document.getElementById('results').innerHTML = 
                    `<p>Request submitted! Transaction: ${tx.transactionHash}</p>
                     <p>Waiting for oracle response...</p>`;
                     
                // Poll for results
                pollForResults();
                
            } catch (error) {
                console.error("Error:", error);
                document.getElementById('results').innerHTML = 
                    `<p style="color: red;">Error: ${error.message}</p>`;
            }
        }
        
        async function getProtocolList() {
            if (!contract) await connectWallet();
            
            const maxResults = document.getElementById('maxResults').value || 20;
            
            try {
                const tx = await contract.methods
                    .requestProtocolList("USDC", 0, parseInt(maxResults))
                    .send({ from: userAccount });
                    
                document.getElementById('results').innerHTML = 
                    `<p>Protocol list requested! Transaction: ${tx.transactionHash}</p>
                     <p>Waiting for oracle response...</p>`;
                     
                pollForResults();
                
            } catch (error) {
                console.error("Error:", error);
                document.getElementById('results').innerHTML = 
                    `<p style="color: red;">Error: ${error.message}</p>`;
            }
        }
        
        async function pollForResults() {
            let attempts = 0;
            const maxAttempts = 12; // 60 seconds max
            
            const poll = setInterval(async () => {
                attempts++;
                
                try {
                    // Check for best vault result
                    const bestVault = await contract.methods.getLatestBestVault().call();
                    if (bestVault.isValid && bestVault.timestamp > Date.now() / 1000 - 120) {
                        document.getElementById('results').innerHTML = `
                            <h3>Best Vault Result</h3>
                            <p><strong>Vault:</strong> ${bestVault.vaultAddress}</p>
                            <p><strong>APY:</strong> ${(bestVault.apy / 100).toFixed(2)}%</p>
                            <p><strong>Protocol:</strong> ${bestVault.protocol}</p>
                            <p><strong>Chain:</strong> ${bestVault.chain}</p>
                            <p><strong>TVL:</strong> $${bestVault.tvlUsd.toLocaleString()}</p>
                            <p><strong>Confidence:</strong> ${bestVault.confidence}%</p>
                        `;
                        clearInterval(poll);
                        return;
                    }
                    
                    // Check for protocol list
                    const protocols = await contract.methods.getLatestProtocolList().call();
                    if (protocols.length > 0) {
                        let html = "<h3>Protocol List</h3><table border='1'>";
                        html += "<tr><th>Protocol</th><th>Chain</th><th>APY</th><th>TVL</th></tr>";
                        
                        protocols.forEach(p => {
                            html += `<tr>
                                <td>${p.protocol}</td>
                                <td>${p.chain}</td>
                                <td>${(p.apy / 100).toFixed(2)}%</td>
                                <td>$${parseInt(p.tvlUsd).toLocaleString()}</td>
                            </tr>`;
                        });
                        
                        html += "</table>";
                        document.getElementById('results').innerHTML = html;
                        clearInterval(poll);
                        return;
                    }
                    
                } catch (error) {
                    console.error("Polling error:", error);
                }
                
                if (attempts >= maxAttempts) {
                    document.getElementById('results').innerHTML = 
                        "<p>Timeout waiting for oracle response. Please check back later.</p>";
                    clearInterval(poll);
                }
            }, 5000); // Check every 5 seconds
        }
        
        // Auto-connect on page load
        window.addEventListener('load', connectWallet);
    </script>
</body>
</html>
```

## 🎯 Use Cases

1. **DeFi Aggregators**: Get real-time best APY data for routing user funds
2. **Portfolio Managers**: Monitor protocol performance across chains
3. **Risk Assessment**: Evaluate vault safety with confidence scores
4. **Yield Farming**: Find optimal farming opportunities with risk adjustment
5. **DeFi Analytics**: Track protocol APY trends and TVL changes

## 🔒 Security Features

- **Owner Controls**: Admin functions protected by ownership
- **Request Tracking**: All requests logged with user attribution  
- **Confidence Scoring**: APY calculations include confidence metrics
- **Risk Filtering**: Built-in risk assessment and filtering
- **Chainlink Security**: Leverages Chainlink's proven oracle infrastructure

## 🛠️ Contract Admin Functions

- `setJobId(bytes32)`: Update the Chainlink job ID
- `setFee(uint256)`: Update the LINK fee amount
- `setOracle(address)`: Update the oracle contract address
- `withdrawLink(address, uint256)`: Withdraw LINK tokens
- `clearLatestProtocolList()`: Clear cached protocol data

## 📞 Support

For integration support or custom requirements, please refer to the external adapter documentation and Chainlink node setup guides.