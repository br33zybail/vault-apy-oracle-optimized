require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

async function testCollection() {
  try {
    console.log('🚀 Testing vault data collection and storage...');
    
    // Get USDC vaults from Vaults.fyi
    const response = await axios.get('https://api.vaults.fyi/v2/detailed-vaults', {
      headers: {
        'x-api-key': process.env.VAULTS_FYI_API_KEY,
        'Accept': '*/*'
      },
      params: {
        allowedAssets: ['USDC'],
        allowedNetworks: ['mainnet', 'base', 'arbitrum'],
        minTvl: 100000,
        perPage: 5
      }
    });
    
    const vaults = response.data.data;
    console.log(`📊 Got ${vaults.length} vaults to process`);
    
    // Save to database
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const vault of vaults) {
        const normalizedData = {
          vault_address: vault.address,
          chain: vault.network?.name?.toLowerCase(),
          protocol: vault.protocol?.name,
          name: vault.name,
          asset_symbol: vault.asset?.symbol,
          apy: parseFloat(vault.apy?.['30day']?.total || 0),
          tvl_usd: parseInt(vault.tvl?.usd || 0)
        };
        
        // Insert vault
        await client.query(`
          INSERT INTO vaults (vault_address, chain, protocol, name, asset_symbol)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (vault_address) 
          DO UPDATE SET updated_at = CURRENT_TIMESTAMP
        `, [
          normalizedData.vault_address,
          normalizedData.chain,
          normalizedData.protocol,
          normalizedData.name,
          normalizedData.asset_symbol
        ]);
        
        // Insert metrics
        await client.query(`
          INSERT INTO vault_metrics 
          (vault_address, apy, tvl_usd, data_source)
          VALUES ($1, $2, $3, $4)
        `, [
          normalizedData.vault_address,
          normalizedData.apy,
          normalizedData.tvl_usd,
          'vaultsfyi'
        ]);
        
        console.log(`✅ Saved: ${normalizedData.name} (${normalizedData.apy}% APY)`);
      }
      
      await client.query('COMMIT');
      console.log('🎉 All data saved successfully!');
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await pool.end();
  }
}

testCollection();
