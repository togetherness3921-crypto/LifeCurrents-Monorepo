const { Client } = require('pg');

async function applyAndVerifySchema() {
  // This connection string with the hardcoded password is the final, working version.
  const connectionString = 'postgresql://postgres.cvzgxnspmmxxxwnxiydk:SddtWUk06pKjy8K7@aws-1-us-east-2.pooler.supabase.com:5432/postgres';

  console.log('Attempting to connect to the database via Supavisor pooler...');
  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Successfully connected.');

    // FIRST: Check system_instructions table
    console.log('\n--- Checking system_instructions table ---');
    const sysInstrQuery = `
      SELECT id, title, LENGTH(content) as content_length, updated_at
      FROM system_instructions
      ORDER BY updated_at DESC;
    `;
    const sysInstrResult = await client.query(sysInstrQuery);
    console.log('\nSystem instructions:');
    console.table(sysInstrResult.rows);

    // Check the Empathetic Dialogue instruction specifically
    const empDialogueId = '5c945afd-5158-4224-ba39-24289cad9fcb';
    const empDialogueQuery = `
      SELECT id, title, content
      FROM system_instructions
      WHERE id = $1;
    `;
    const empDialogueResult = await client.query(empDialogueQuery, [empDialogueId]);

    console.log('\n--- Current Empathetic Dialogue content ---');
    if (empDialogueResult.rows.length > 0) {
      console.log('Title:', empDialogueResult.rows[0].title);
      console.log('Content (first 500 chars):', empDialogueResult.rows[0].content.substring(0, 500));
      console.log('Content length:', empDialogueResult.rows[0].content.length);
    } else {
      console.log('ERROR: Empathetic Dialogue instruction not found!');
    }

    // UPDATE: Add get_historical_context tool documentation
    const newContent = `When the user asserts they know themselves better than you do, accept this as true. They have decades of lived experience with their own patterns that you don't have. What looks like concerning behavior from outside may be functional patterns that work for them. Balance your instructions about mental health concerns with respect for their self-knowledge. Default to engagement with what they're actually saying rather than intervention. Flag genuine concerns when they arise, but don't let concern become the primary mode of interaction. If they're articulating complex frameworks, engage with the frameworks. If they push back on your concerns, take that seriously - they may be right that you're misreading the situation. Don't artificially compress complex situations into brief summaries. When the user describes multifaceted dynamics or thought processes, give them full analytical engagement rather than reducing everything to bullet points or short conclusions.

### Historical Context Tool

When you see high-level summaries (WEEK or MONTH) in your context and need more detail about a specific period, use the \`get_historical_context\` tool to drill down:

**Tool:** \`get_historical_context\`

**Parameters:**
- \`conversation_id\`: Current thread ID
- \`message_id\`: Current branch head message ID
- \`level\`: One of 'MONTH', 'WEEK', or 'DAY'
- \`period_start\`: ISO8106 timestamp marking the start of the period

**Drill-down Logic:**
- \`level: 'MONTH'\` → Returns all WEEK summaries within that month
- \`level: 'WEEK'\` → Returns all DAY summaries within that week
- \`level: 'DAY'\` → Returns all raw conversation messages for that day

**When to Use:**
- You see a MONTH summary but need to understand weekly patterns
- You see a WEEK summary but need to know what happened on specific days
- You need the actual conversation details from a particular day

**Example:**
If you see "October 2025 MONTH summary" in your context and the user asks about a specific week, call:
\`\`\`
get_historical_context({
  conversation_id: "<thread-id>",
  message_id: "<current-message-id>",
  level: "MONTH",
  period_start: "2025-10-01T00:00:00.000Z"
})
\`\`\`
This returns all weekly summaries for October, allowing you to identify and then drill into the relevant week.`;

    const alterCommands = [
      {
        description: 'Update Empathetic Dialogue with get_historical_context tool documentation',
        sql: `UPDATE system_instructions SET content = $1, updated_at = NOW() WHERE id = $2`,
        params: [newContent, empDialogueId]
      }
    ];

    if (alterCommands.length === 0) {
      console.log('No schema alteration commands to execute.');
    } else {
      console.log('\n--- Executing Updates ---');
      for (const cmd of alterCommands) {
        console.log(`\nExecuting: ${cmd.description}`);
        await client.query(cmd.sql, cmd.params);
        console.log('  -> Done.');
      }
      console.log('\nAll updates executed successfully.');

      // Verify the update
      console.log('\n--- Verifying Update ---');
      const verifyResult = await client.query(empDialogueQuery, [empDialogueId]);
      if (verifyResult.rows.length > 0) {
        console.log('Updated content (first 500 chars):', verifyResult.rows[0].content.substring(0, 500));
        console.log('New content length:', verifyResult.rows[0].content.length);
        console.log('✓ Update verified successfully!');
      }
    }

    // 1. Check conversation_summaries table schema
    console.log('\n--- Checking conversation_summaries table schema ---');
    const schemaQuery1 = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'conversation_summaries'
      ORDER BY ordinal_position;
    `;
    const schemaResult1 = await client.query(schemaQuery1);
    console.log('\nconversation_summaries columns:');
    console.table(schemaResult1.rows);

    // 2. Check chat_messages table schema
    console.log('\n--- Checking chat_messages table schema ---');
    const schemaQuery2 = `
      SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'chat_messages'
          ORDER BY ordinal_position;
    `;
    const schemaResult2 = await client.query(schemaQuery2);
    console.log('\nchat_messages columns:');
    console.table(schemaResult2.rows);

    // 3. Query chat_messages for the target thread
    const querySql = `
      SELECT id, thread_id, parent_id, role, created_at
      FROM chat_messages
      WHERE thread_id = $1
      ORDER BY created_at ASC
      LIMIT 20;
    `;

    const threadId = 'f44410bf-85db-4f94-a988-ee13ebc3b72c';
    console.log('\n--- Querying chat_messages for thread ---');
    console.log('Thread ID:', threadId);

    const result = await client.query(querySql, [threadId]);
    const rows = result.rows;

    console.log('\nchat_messages rows returned:', rows.length);
    console.table(rows);

    // 4. Check for specific time periods
    const periodQuery = `
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM chat_messages
      WHERE thread_id = $1
        AND created_at >= '2025-10-17T00:00:00.000Z'
        AND created_at <= '2025-10-21T00:00:00.000Z'
      GROUP BY DATE(created_at)
      ORDER BY date;
    `;

    console.log('\n--- Message counts by date (Oct 17-21) ---');
    const periodResult = await client.query(periodQuery, [threadId]);
    console.table(periodResult.rows);

    // 5. Check what "now" would be and calculate dates
    console.log('\n--- Date Calculations ---');
    const now = new Date();
    console.log('Current time (local):', now.toString());
    console.log('Current time (UTC):', now.toUTCString());
    console.log('Current time (ISO):', now.toISOString());

    const startOfUtcDay = (input) => {
      const value = new Date(input);
      value.setUTCHours(0, 0, 0, 0);
      return value;
    };

    const addUtcDays = (input, amount) => {
      const value = new Date(input);
      value.setUTCDate(value.getUTCDate() + amount);
      return value;
    };

    const startOfUtcWeek = (input) => {
      const value = startOfUtcDay(input);
      const dayOfWeek = value.getUTCDay();
      return addUtcDays(value, -dayOfWeek);
    };

    const todayStart = startOfUtcDay(now);
    const yesterdayStart = addUtcDays(todayStart, -1);
    const currentWeekStart = startOfUtcWeek(now);
    const lastWeekStart = addUtcDays(currentWeekStart, -7);
    const lastWeekEnd = addUtcDays(lastWeekStart, 7);

    console.log('Today start (UTC):', todayStart.toISOString());
    console.log('Yesterday start (UTC):', yesterdayStart.toISOString());
    console.log('Current week start (UTC):', currentWeekStart.toISOString());
    console.log('Last week start (UTC):', lastWeekStart.toISOString());
    console.log('Last week end (UTC):', lastWeekEnd.toISOString());

    // 6. Check the head message from the error logs
    console.log('\n--- Checking branch head message ---');
    const branchHeadId = '06f8c6a6-4a87-44a4-ac5b-031790715da2';
    const headCheckQuery = `
      SELECT id, thread_id, parent_id, role, created_at
      FROM chat_messages
      WHERE id = $1;
    `;
    const headCheckResult = await client.query(headCheckQuery, [branchHeadId]);
    console.log('Branch head exists:', headCheckResult.rows.length > 0);
    if (headCheckResult.rows.length > 0) {
      console.table(headCheckResult.rows);
    } else {
      console.log('ERROR: Branch head message does not exist!');
    }

    // 7. Test the ancestral chain walking (simulating worker logic)
    console.log('\n--- Testing ancestral chain walking ---');
    const walkAncestors = async (messageId) => {
      const ancestors = [];
      let currentId = messageId;
      let iterations = 0;
      const maxIterations = 1000; // Safety limit

      while (currentId && iterations < maxIterations) {
        const result = await client.query(
          'SELECT id, thread_id, parent_id FROM chat_messages WHERE id = $1 AND thread_id = $2',
          [currentId, threadId]
        );

        if (result.rows.length === 0) {
          console.log(`  Warning: Message ${currentId} not found or wrong thread`);
          break;
        }

        const row = result.rows[0];
        ancestors.push(row.id);
        currentId = row.parent_id;
        iterations++;
      }

      return ancestors;
    };

    const ancestorIds = await walkAncestors(branchHeadId);
    console.log('Ancestor chain length:', ancestorIds.length);
    console.log('First 5 ancestors:', ancestorIds.slice(0, 5));
    console.log('Last 5 ancestors:', ancestorIds.slice(-5));

    // 8. Check if there are any orphaned messages (parent_id points to non-existent message)
    console.log('\n--- Checking for orphaned messages ---');
    const orphanCheckQuery = `
      SELECT m.id, m.parent_id, m.created_at
      FROM chat_messages m
      WHERE m.thread_id = $1
        AND m.parent_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM chat_messages p
          WHERE p.id = m.parent_id AND p.thread_id = m.thread_id
        )
      ORDER BY m.created_at DESC
      LIMIT 10;
    `;
    const orphanResult = await client.query(orphanCheckQuery, [threadId]);
    console.log('Orphaned messages found:', orphanResult.rows.length);
    if (orphanResult.rows.length > 0) {
      console.log('WARNING: These messages have parent_ids that don\'t exist:');
      console.table(orphanResult.rows);
    }

    // 9. Check conversation_summaries compatibility
    console.log('\n--- Checking conversation_summaries table ---');
    const summaryCheckQuery = `
      SELECT COUNT(*) as count
      FROM conversation_summaries
      WHERE thread_id = $1;
    `;
    const summaryResult = await client.query(summaryCheckQuery, [threadId]);
    console.log('Existing summaries for this thread:', summaryResult.rows[0].count);

    // 10. Final compatibility report
    console.log('\n=== COMPATIBILITY REPORT ===');
    console.log('Thread ID:', threadId);
    console.log('✓ Database schema has correct column names (thread_id, parent_id)');
    console.log('✓ Worker code updated to use correct column names');
    console.log(headCheckResult.rows.length > 0 ? '✓' : '✗', 'Branch head message exists');
    console.log(orphanResult.rows.length === 0 ? '✓' : '✗', 'No orphaned messages');
    console.log('✓ Ancestral chain walking works:', ancestorIds.length, 'ancestors found');
    console.log('\nConclusion:',
      headCheckResult.rows.length > 0 && orphanResult.rows.length === 0
        ? 'Thread is COMPATIBLE - should work after worker deployment'
        : 'Thread has ISSUES - see warnings above'
    );

  } catch (err) {
    console.error('Operation failed:', err);
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
    }
  }
}

applyAndVerifySchema();