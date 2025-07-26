// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/ChainlinkClient.sol";
import "@chainlink/contracts/src/v0.8/ConfirmedOwner.sol";

/**
 * @title VaultAPYConsumer
 * @dev Consumer contract for querying vault APYs and protocol listings from DeFi protocols
 * @notice This contract allows users to get the best vault APY or a list of all protocols with their APYs
 */
contract VaultAPYConsumer is ChainlinkClient, ConfirmedOwner {
    using Chainlink for Chainlink.Request;

    // Struct to store protocol APY data
    struct ProtocolAPY {
        string protocol;
        string chain;
        uint256 apy; // APY as basis points (e.g., 500 = 5.00%)
        uint256 tvlUsd;
        string vaultAddress;
        uint256 confidence; // Confidence score 0-100
        uint256 timestamp;
        bool isValid;
    }

    // Struct to store the best vault result
    struct BestVaultResult {
        string vaultAddress;
        uint256 apy; // APY as basis points
        string protocol;
        string chain;
        uint256 tvlUsd;
        uint256 riskScore;
        uint256 confidence;
        uint256 timestamp;
        bool isValid;
    }

    // Events
    event BestVaultRequested(bytes32 indexed requestId, string asset, string riskLevel);
    event BestVaultReceived(bytes32 indexed requestId, string vaultAddress, uint256 apy);
    event ProtocolListRequested(bytes32 indexed requestId, string asset);
    event ProtocolListReceived(bytes32 indexed requestId, uint256 protocolCount);
    event RequestFailed(bytes32 indexed requestId, string error);

    // State variables
    bytes32 private jobId;
    uint256 private fee;
    
    // Storage for results
    mapping(bytes32 => BestVaultResult) public bestVaultResults;
    mapping(bytes32 => ProtocolAPY[]) public protocolLists;
    mapping(bytes32 => uint256) public protocolCounts;
    mapping(bytes32 => address) public requestOwners;
    
    // Latest results (for easy access)
    BestVaultResult public latestBestVault;
    ProtocolAPY[] public latestProtocolList;
    
    // Request tracking
    mapping(address => bytes32[]) public userRequests;
    bytes32[] public allRequests;

    /**
     * @dev Initialize the link token and target oracle
     * @param _link The address of the LINK token contract
     * @param _oracle The address of the oracle contract
     * @param _jobId The job ID for the external adapter
     * @param _fee The fee in LINK tokens (typically 0.1 LINK = 100000000000000000)
     */
    constructor(
        address _link,
        address _oracle,
        bytes32 _jobId,
        uint256 _fee
    ) ConfirmedOwner(msg.sender) {
        setChainlinkToken(_link);
        setChainlinkOracle(_oracle);
        jobId = _jobId;
        fee = _fee; // 0.1 LINK = 100000000000000000 wei
    }

    /**
     * @dev Request the best vault for a specific asset and risk level
     * @param asset The asset symbol (e.g., "USDC", "USDT", "ETH")
     * @param riskLevel The risk tolerance ("low", "medium", "high")
     * @param enhanced Whether to use enhanced APY calculations
     * @return requestId The Chainlink request ID
     */
    function requestBestVault(
        string memory asset,
        string memory riskLevel,
        bool enhanced
    ) public returns (bytes32 requestId) {
        require(LINK.balanceOf(address(this)) >= fee, "Insufficient LINK balance");
        
        Chainlink.Request memory request = buildChainlinkRequest(
            jobId,
            address(this),
            this.fulfillBestVault.selector
        );
        
        // Set request parameters
        request.add("asset", asset);
        request.add("risk_level", riskLevel);
        if (enhanced) {
            request.add("request_type", "enhanced_best_vault");
        } else {
            request.add("request_type", "best_vault");
        }
        
        // Send the request
        requestId = sendChainlinkRequest(request, fee);
        
        // Track the request
        requestOwners[requestId] = msg.sender;
        userRequests[msg.sender].push(requestId);
        allRequests.push(requestId);
        
        emit BestVaultRequested(requestId, asset, riskLevel);
        
        return requestId;
    }

    /**
     * @dev Request a list of all protocols with their APYs for a specific asset
     * @param asset The asset symbol (e.g., "USDC", "USDT", "ETH")
     * @param minTvl Minimum TVL filter in USD (0 for no filter)
     * @param maxResults Maximum number of results to return
     * @return requestId The Chainlink request ID
     */
    function requestProtocolList(
        string memory asset,
        uint256 minTvl,
        uint256 maxResults
    ) public returns (bytes32 requestId) {
        require(LINK.balanceOf(address(this)) >= fee, "Insufficient LINK balance");
        require(maxResults > 0 && maxResults <= 50, "Results must be 1-50");
        
        Chainlink.Request memory request = buildChainlinkRequest(
            jobId,
            address(this),
            this.fulfillProtocolList.selector
        );
        
        // Set request parameters for top vaults
        request.add("asset", asset);
        request.add("request_type", "top_vaults");
        request.addUint("limit", maxResults);
        if (minTvl > 0) {
            request.addUint("min_tvl", minTvl);
        }
        
        // Send the request
        requestId = sendChainlinkRequest(request, fee);
        
        // Track the request
        requestOwners[requestId] = msg.sender;
        userRequests[msg.sender].push(requestId);
        allRequests.push(requestId);
        
        emit ProtocolListRequested(requestId, asset);
        
        return requestId;
    }

    /**
     * @dev Chainlink callback for best vault requests
     * @param _requestId The request ID
     * @param _vaultAddress The vault address
     * @param _apy The APY in basis points
     * @param _protocol The protocol name
     * @param _chain The blockchain name
     * @param _tvlUsd The TVL in USD
     * @param _riskScore The risk score (0-100)
     * @param _confidence The confidence score (0-100)
     */
    function fulfillBestVault(
        bytes32 _requestId,
        string memory _vaultAddress,
        uint256 _apy,
        string memory _protocol,
        string memory _chain,
        uint256 _tvlUsd,
        uint256 _riskScore,
        uint256 _confidence
    ) public recordChainlinkFulfillment(_requestId) {
        BestVaultResult memory result = BestVaultResult({
            vaultAddress: _vaultAddress,
            apy: _apy,
            protocol: _protocol,
            chain: _chain,
            tvlUsd: _tvlUsd,
            riskScore: _riskScore,
            confidence: _confidence,
            timestamp: block.timestamp,
            isValid: true
        });
        
        bestVaultResults[_requestId] = result;
        latestBestVault = result;
        
        emit BestVaultReceived(_requestId, _vaultAddress, _apy);
    }

    /**
     * @dev Chainlink callback for protocol list requests
     * @param _requestId The request ID
     * @param _protocolCount The number of protocols returned
     */
    function fulfillProtocolList(
        bytes32 _requestId,
        uint256 _protocolCount
    ) public recordChainlinkFulfillment(_requestId) {
        protocolCounts[_requestId] = _protocolCount;
        emit ProtocolListReceived(_requestId, _protocolCount);
    }

    /**
     * @dev Add protocol data to a request (called multiple times per request)
     * @param _requestId The request ID
     * @param _protocol The protocol name
     * @param _chain The blockchain name
     * @param _apy The APY in basis points
     * @param _tvlUsd The TVL in USD
     * @param _vaultAddress The vault address
     * @param _confidence The confidence score
     */
    function addProtocolData(
        bytes32 _requestId,
        string memory _protocol,
        string memory _chain,
        uint256 _apy,
        uint256 _tvlUsd,
        string memory _vaultAddress,
        uint256 _confidence
    ) public recordChainlinkFulfillment(_requestId) {
        ProtocolAPY memory protocolData = ProtocolAPY({
            protocol: _protocol,
            chain: _chain,
            apy: _apy,
            tvlUsd: _tvlUsd,
            vaultAddress: _vaultAddress,
            confidence: _confidence,
            timestamp: block.timestamp,
            isValid: true
        });
        
        protocolLists[_requestId].push(protocolData);
        
        // Update latest list if this is the most recent request
        if (allRequests.length > 0 && allRequests[allRequests.length - 1] == _requestId) {
            latestProtocolList.push(protocolData);
        }
    }

    // View functions

    /**
     * @dev Get the best vault result for a specific request
     * @param _requestId The request ID
     * @return The best vault result
     */
    function getBestVaultResult(bytes32 _requestId) 
        public 
        view 
        returns (BestVaultResult memory) 
    {
        return bestVaultResults[_requestId];
    }

    /**
     * @dev Get the protocol list for a specific request
     * @param _requestId The request ID
     * @return The array of protocol APYs
     */
    function getProtocolList(bytes32 _requestId) 
        public 
        view 
        returns (ProtocolAPY[] memory) 
    {
        return protocolLists[_requestId];
    }

    /**
     * @dev Get all requests made by a user
     * @param user The user address
     * @return Array of request IDs
     */
    function getUserRequests(address user) 
        public 
        view 
        returns (bytes32[] memory) 
    {
        return userRequests[user];
    }

    /**
     * @dev Get the latest best vault result
     * @return The latest best vault result
     */
    function getLatestBestVault() 
        public 
        view 
        returns (BestVaultResult memory) 
    {
        return latestBestVault;
    }

    /**
     * @dev Get the latest protocol list
     * @return The latest protocol list
     */
    function getLatestProtocolList() 
        public 
        view 
        returns (ProtocolAPY[] memory) 
    {
        return latestProtocolList;
    }

    /**
     * @dev Get the count of protocols for a request
     * @param _requestId The request ID
     * @return The number of protocols
     */
    function getProtocolCount(bytes32 _requestId) 
        public 
        view 
        returns (uint256) 
    {
        return protocolLists[_requestId].length;
    }

    // Admin functions

    /**
     * @dev Update the job ID
     * @param _jobId The new job ID
     */
    function setJobId(bytes32 _jobId) public onlyOwner {
        jobId = _jobId;
    }

    /**
     * @dev Update the fee
     * @param _fee The new fee in LINK wei
     */
    function setFee(uint256 _fee) public onlyOwner {
        fee = _fee;
    }

    /**
     * @dev Update the oracle address
     * @param _oracle The new oracle address
     */
    function setOracle(address _oracle) public onlyOwner {
        setChainlinkOracle(_oracle);
    }

    /**
     * @dev Withdraw LINK tokens
     * @param _to The address to send LINK to
     * @param _amount The amount to withdraw
     */
    function withdrawLink(address _to, uint256 _amount) public onlyOwner {
        require(LINK.transfer(_to, _amount), "LINK transfer failed");
    }

    /**
     * @dev Get the current fee
     * @return The current fee in LINK wei
     */
    function getFee() public view returns (uint256) {
        return fee;
    }

    /**
     * @dev Get the current job ID
     * @return The current job ID
     */
    function getJobId() public view returns (bytes32) {
        return jobId;
    }

    /**
     * @dev Get the LINK balance of this contract
     * @return The LINK balance
     */
    function getLinkBalance() public view returns (uint256) {
        return LINK.balanceOf(address(this));
    }

    /**
     * @dev Clear the latest protocol list (admin function)
     */
    function clearLatestProtocolList() public onlyOwner {
        delete latestProtocolList;
    }
}