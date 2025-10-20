#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const envPath = process.env.SUPABASE_ENV_PATH;
if (envPath && fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath, override: true });
} else if (fs.existsSync(path.resolve(process.cwd(), '.env.local'))) {
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
} else if (fs.existsSync(path.resolve(process.cwd(), '.env'))) {
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env'), override: true });
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL environment variable.');
  process.exit(1);
}

if (!SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY environment variable.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const alterCommands = [
  "ALTER TABLE public.system_instructions ADD COLUMN IF NOT EXISTS title text",
  "UPDATE public.system_instructions SET title = COALESCE(title, 'Untitled instruction')",
  "ALTER TABLE public.system_instructions ALTER COLUMN title SET DEFAULT 'Untitled instruction'",
  "ALTER TABLE public.system_instructions ALTER COLUMN title SET NOT NULL",
];

const verificationQueries = [
  {
    description: 'Confirm title column definition:',
    query: "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'system_instructions' AND column_name = 'title'",
  },
];

async function executeSql(sql) {
  const { data, error } = await supabase.rpc('pg_execute_sql', { query: sql });
  if (error) {
    error.sql = sql;
    throw error;
  }
  return data;
}

async function main() {
  if (alterCommands.length === 0) {
    console.log('No ALTER TABLE commands defined. Exiting.');
    return;
  }

  console.log('Applying schema changes...');
  for (const sql of alterCommands) {
    console.log(`\nExecuting:\n${sql}`);
    await executeSql(sql);
  }
  console.log('\nSchema changes applied. Running verification queries...');

  for (const { description, query } of verificationQueries) {
    console.log(`\n${description}`);
    const result = await executeSql(query);
    console.dir(result, { depth: null });
  }

  console.log('\nAll operations completed successfully.');
}

main().catch((error) => {
  console.error('\nSchema migration failed.');
  console.error('SQL:', error.sql || 'N/A');
  console.error('Error:', error.message || error);
  process.exit(1);
});
