const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class DatabaseManager {
  constructor() {
    this.sqliteDb = null;
    this.initializeConnections();
  }

  async initializeConnections() {
    try {
      // SQLite Connection as primary database
      const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, '../database.sqlite');
      const dbDir = path.dirname(sqlitePath);
      
      // Ensure directory exists
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.sqliteDb = new sqlite3.Database(sqlitePath, (err) => {
        if (err) {
          console.error('SQLite connection error:', err);
          throw err;
        } else {
          console.log('SQLite connected successfully at:', sqlitePath);
          // Enable foreign keys
          this.sqliteDb.run('PRAGMA foreign_keys = ON');
        }
      });

    } catch (error) {
      console.error('Database initialization error:', error);
      throw error;
    }
  }

  async executeQuery(query, params = []) {
    return new Promise((resolve, reject) => {
      // Convert MySQL syntax to SQLite where needed
      const sqliteQuery = this.convertToSQLiteQuery(query);
      
      if (sqliteQuery.toLowerCase().trim().startsWith('select')) {
        this.sqliteDb.all(sqliteQuery, params, (err, rows) => {
          if (err) {
            console.error('SQLite query error:', err);
            reject(err);
          } else {
            resolve(rows);
          }
        });
      } else {
        this.sqliteDb.run(sqliteQuery, params, function(err) {
          if (err) {
            console.error('SQLite query error:', err);
            reject(err);
          } else {
            resolve({ 
              insertId: this.lastID, 
              affectedRows: this.changes,
              changes: this.changes 
            });
          }
        });
      }
    });
  }

  convertToSQLiteQuery(query) {
    // Convert MySQL specific syntax to SQLite
    return query
      .replace(/AUTO_INCREMENT/gi, 'AUTOINCREMENT')
      .replace(/INT\s+AUTO_INCREMENT/gi, 'INTEGER')
      .replace(/CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP/gi, 'CURRENT_TIMESTAMP')
      .replace(/ENUM\([^)]+\)/gi, 'TEXT')
      .replace(/VARCHAR\((\d+)\)/gi, 'TEXT')
      .replace(/TEXT\(\d+\)/gi, 'TEXT')
      .replace(/DECIMAL\([\d,\s]+\)/gi, 'REAL')
      .replace(/BOOLEAN/gi, 'INTEGER')
      .replace(/TRUE/gi, '1')
      .replace(/FALSE/gi, '0')
      .replace(/ON DUPLICATE KEY UPDATE[^;]*/gi, '');
  }

  async beginTransaction() {
    return new Promise((resolve, reject) => {
      this.sqliteDb.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(this.sqliteDb);
        }
      });
    });
  }

  async commitTransaction() {
    return new Promise((resolve, reject) => {
      this.sqliteDb.run('COMMIT', (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async rollbackTransaction() {
    return new Promise((resolve, reject) => {
      this.sqliteDb.run('ROLLBACK', (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async closeConnections() {
    if (this.sqliteDb) {
      return new Promise((resolve) => {
        this.sqliteDb.close((err) => {
          if (err) {
            console.error('Error closing SQLite database:', err);
          } else {
            console.log('SQLite database connection closed');
          }
          resolve();
        });
      });
    }
  }
}

module.exports = new DatabaseManager();
