const mysql = require('mysql2/promise');

let pool;

async function initDb() {
  pool = mysql.createPool({
    host:     process.env.MYSQL_HOST || 'mysql',
    port:     process.env.MYSQL_PORT || 3306,
    user:     'root',
    password: process.env.MYSQL_ROOT_PASSWORD,
    database: process.env.DB_NAME || 'auth_db',
    waitForConnections: true,
    connectionLimit: 10,
  });
  await pool.query('SELECT 1');
  console.log('Auth DB connected');
}

function getPool() {
  return pool;
}

module.exports = { initDb, getPool };
