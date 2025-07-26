require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

async function checkData() {
  try {
    const client = await pool.connect();
    
    // Check vaults table
    const vaults = await client.query('SELECT * FROM vaults ORDER BY created_at DESC LIMIT 10');
    console.log('📊 Vaults in database:');
    console.table(vaults.rows);
    
    // Check latest metrics
    const metrics = await client.query(`
      SELECT v.name, v.protocol, v.chain, vm.apy, vm.tvl_usd, vm.timestamp
      FROM vault_metrics vm 
      JOIN vaults v ON vm.vault_address = v.vault_address 
      ORDER BY vm.timestamp DESC LIMIT 10
    `);
    console.log('\n📈 Latest metrics:');
    console.table(metrics.rows);
    
    client.release();
  } catch (error) {
    console.error('❌ Database check failed:', error.message);
  } finally {
    await pool.end();
  }
}

checkData();
