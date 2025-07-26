require('dotenv').config();

console.log('Environment variables loaded:');
console.log('VAULTS_FYI_API_KEY:', process.env.VAULTS_FYI_API_KEY ? 'Found' : 'NOT FOUND');
console.log('Key length:', process.env.VAULTS_FYI_API_KEY?.length || 0);
console.log('First 10 chars:', process.env.VAULTS_FYI_API_KEY?.substring(0, 10) || 'None');
