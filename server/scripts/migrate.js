const fs = require('fs');
const path = require('path');
const db = require('../config/database');

const runMigrations = async () => {
  try {
    console.log('Starting database migrations...');

    // Get all migration files
    const migrationsDir = path.join(__dirname, '../migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    console.log(`Found ${migrationFiles.length} migration files`);

    // Create migrations table if it doesn't exist
    await db.executeQuery(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get already executed migrations
    const executedMigrations = await db.executeQuery(
      'SELECT filename FROM migrations'
    );
    const executedFiles = executedMigrations.map(m => m.filename);

    // Run pending migrations
    for (const file of migrationFiles) {
      if (executedFiles.includes(file)) {
        console.log(`Skipping ${file} (already executed)`);
        continue;
      }

      console.log(`Executing ${file}...`);
      
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      // Split SQL by semicolons and execute each statement
      const statements = sql.split(';').filter(stmt => stmt.trim());
      
      for (const statement of statements) {
        if (statement.trim()) {
          await db.executeQuery(statement);
        }
      }

      // Record migration as executed
      await db.executeQuery(
        'INSERT INTO migrations (filename) VALUES (?)',
        [file]
      );

      console.log(`✓ ${file} executed successfully`);
    }

    console.log('All migrations completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
};

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };
