import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { Client } from 'pg';

// Applies supabase/schema.sql against DATABASE_URL. The schema is idempotent,
// so this is safe to re-run. Use the Session pooler connection string (port
// 5432) -- the transaction pooler (6543) does not support the DDL here.

const SCHEMA_PATH = 'supabase/schema.sql';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL must be set in .env.local (Supabase Session pooler URI, port 5432)');
    process.exit(1);
  }

  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

  const start = Date.now();
  await client.connect();
  try {
    await client.query(sql);
    console.log(`applied ${SCHEMA_PATH} in ${Date.now() - start}ms`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
