// src/config/setup-db.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

async function setupDatabase() {
  try {
    console.log('🔧 Setting up database schema...');

    // Create vaults table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vaults (
        id SERIAL PRIMARY KEY,
        vault_address VARCHAR(42) UNIQUE NOT NULL,
        chain VARCHAR(20) NOT NULL,
        protocol VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        asset_symbol VARCHAR(10) NOT NULL,
        asset_address VARCHAR(42),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create vault_metrics table for time-series data
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vault_metrics (
        id SERIAL PRIMARY KEY,
        vault_address VARCHAR(42) NOT NULL,
        apy DECIMAL(10,4),
        apr DECIMAL(10,4),
        tvl_usd BIGINT,
        utilization_rate DECIMAL(5,4),
        risk_score INTEGER,
        data_source VARCHAR(20) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vault_address) REFERENCES vaults(vault_address)
      );
    `);

    // Create protocols table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS protocols (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        chain VARCHAR(20) NOT NULL,
        audit_status VARCHAR(20) DEFAULT 'unknown',
        launch_date DATE,
        governance_token VARCHAR(10),
        total_tvl_usd BIGINT DEFAULT 0,
        risk_category VARCHAR(20) DEFAULT 'medium',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes for performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_metrics_timestamp 
      ON vault_metrics(timestamp DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_vault_metrics_vault_address 
      ON vault_metrics(vault_address);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_vaults_chain_protocol 
      ON vaults(chain, protocol);
    `);

    // Insert some initial protocol data
    await pool.query(`
      INSERT INTO protocols (name, chain, audit_status, launch_date, governance_token, risk_category) 
      VALUES 
        ('Aave', 'ethereum', 'audited', '2020-01-01', 'AAVE', 'low'),
        ('Aave', 'polygon', 'audited', '2021-03-01', 'AAVE', 'low'),
        ('Compound', 'ethereum', 'audited', '2018-09-01', 'COMP', 'low'),
        ('Yearn', 'ethereum', 'audited', '2020-02-01', 'YFI', 'medium')
      ON CONFLICT (name) DO NOTHING;
    `);

    console.log('✅ Database schema created successfully!');
    console.log('📊 Tables created: vaults, vault_metrics, protocols');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run setup if called directly
if (require.main === module) {
  setupDatabase();
}

module.exports = { setupDatabase };
