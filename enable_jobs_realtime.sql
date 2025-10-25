-- Enable Realtime for the jobs table
-- Run this in the Supabase SQL Editor

-- 1. Ensure REPLICA IDENTITY is set
ALTER TABLE jobs REPLICA IDENTITY FULL;

-- 2. Drop existing publication if it exists (to start fresh)
DROP PUBLICATION IF EXISTS supabase_realtime;

-- 3. Create publication for realtime (this is the key step)
CREATE PUBLICATION supabase_realtime FOR TABLE jobs;

-- 4. Verify the setup
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'jobs';

SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

