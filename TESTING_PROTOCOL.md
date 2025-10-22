# Testing Protocol: Backend Feature Verification

## Overview
This document provides step-by-step browser testing for two backend features:
1. **Stale Tool Call Compression** (Objective 3) - LLM context optimization
2. **Historical Context Drill-Down** (Objective 4) - `get_historical_context` MCP tool

---

## Prerequisites

### 1. Update System Instructions (One-Time Setup)

The AI needs to know about the new `get_historical_context` tool.

**Steps:**
1. Open LifeCurrents in your browser
2. Click the ⚙️ Settings button
3. Navigate to "System Instructions"
4. Find the "Empathetic Dialogue" instruction (or your active instruction)
5. Click "Edit"
6. Add the following section at the end:

```markdown
### Historical Context Tool

When you see high-level summaries (WEEK or MONTH) and need more detail, use `get_historical_context` to drill down:

**Tool:** `get_historical_context`
**Parameters:**
- `conversation_id`: Current thread ID
- `message_id`: Current branch head message ID
- `level`: One of 'MONTH', 'WEEK', or 'DAY'
- `period_start`: ISO8601 timestamp (e.g., "2025-10-01T00:00:00.000Z")

**Drill-down logic:**
- `level: 'MONTH'` → Returns all WEEK summaries within that month
- `level: 'WEEK'` → Returns all DAY summaries within that week
- `level: 'DAY'` → Returns all raw messages for that day

**Example usage:**
If you see a MONTH summary for October 2025, you can call:
```json
{
  "conversation_id": "<thread-id>",
  "message_id": "<current-message-id>",
  "level": "MONTH",
  "period_start": "2025-10-01T00:00:00.000Z"
}
```
This will return all WEEK summaries for October, allowing you to see weekly breakdowns.
```

6. Click "Save"

---

## Feature 1: Stale Tool Call Compression

### What It Does
Automatically compresses verbose tool call responses that occurred before the most recent user message, reducing LLM token usage while keeping the full response visible in the UI.

### Testing Steps

#### Setup
1. Open LifeCurrents in your browser
2. Open DevTools (F12 or Cmd+Option+I)
3. Go to the **Console** tab
4. Clear console: Click the 🚫 icon or press Cmd+K / Ctrl+L

#### Test Scenario
1. **Make some tool calls:**
   - Send a message like: "Create a graph node for 'Test Task A'"
   - Wait for the assistant to use the `patch_graph_document` tool
   - You'll see tool call UI in the chat

2. **Send another user message:**
   - Type: "Now create another node for 'Test Task B'"
   - This makes the previous tool call "stale"

3. **Check console for compression:**

**Console Search Term:** `[Compression]`

**What to look for:**
```
[Compression] ✅ Compressed 1 stale tool call(s): Array(1)
  0: {toolName: 'patch_graph_document', originalLength: 2453, compressedLength: 87}
[Compression] Total tokens saved: ~2366 characters
```

**Success Criteria:**
- ✅ Console shows compression happened
- ✅ Original tool call still visible in UI (full JSON response)
- ✅ Characters saved > 0

**If you see:** `[Compression] No stale tool calls to compress`
- This is normal if there are no tool calls before the most recent user message

---

## Feature 2: Historical Context Drill-Down

### What It Does
Allows the AI to request more detailed information when it sees high-level summaries.

### Testing Steps

#### Setup
1. Ensure you have existing conversation summaries (WEEK or MONTH level)
   - If not, have a multi-day conversation first to generate summaries
2. Open DevTools Console (F12)
3. Clear console

#### Test Scenario

**Option A: Direct Prompt (Easiest)**

Send this message to the AI:
```
Please use the get_historical_context tool to show me the weekly summaries for October 2025.
Use level='MONTH' and period_start='2025-10-01T00:00:00.000Z'
```

**Option B: Natural Prompt (Tests AI Understanding)**

Send:
```
I'd like to explore what happened during the first week of October in more detail.
Can you drill down into that week?
```

The AI should recognize it needs to:
1. First call `get_historical_context` with `level='MONTH'` to get week summaries
2. Then call again with `level='WEEK'` for a specific week to get daily summaries

#### Verify in Console

**Console Search Terms:**
- `[ChatPane][MCP] Calling tool get_historical_context`
- `get_historical_context`

**What to look for:**
```javascript
[ChatPane][MCP] Calling tool get_historical_context with args {
  conversation_id: "...",
  message_id: "...",
  level: "MONTH",
  period_start: "2025-10-01T00:00:00.000Z"
}

[ChatPane][MCP] Tool result {
  content: "{\"level\":\"MONTH\",\"period_start\":\"2025-10-01T00:00:00.000Z\",\"items\":[...]}"
}
```

**Success Criteria:**
- ✅ Console shows `get_historical_context` tool call
- ✅ `level` parameter matches request (MONTH, WEEK, or DAY)
- ✅ Tool result includes `items` array
- ✅ For MONTH: items are WEEK summaries
- ✅ For WEEK: items are DAY summaries
- ✅ For DAY: items are raw messages
- ✅ AI displays the results in natural language

#### Verify the Response Structure

Expand the tool result in console to see:
```javascript
{
  level: "MONTH",
  period_start: "2025-10-01T00:00:00.000Z",
  items: [
    {
      id: "uuid",
      summary_level: "WEEK",
      summary_period_start: "2025-10-01T00:00:00.000Z",
      content: "Week 1 summary...",
      created_at: "...",
      thread_id: "..."
    },
    // ... more WEEK summaries
  ]
}
```

---

## Advanced Testing: Full Drill-Down Chain

### Scenario: Navigate from MONTH → WEEK → DAY

1. **Start with MONTH:**
   ```
   Show me all weekly summaries for October 2025
   ```
   - Verify console shows `level: "MONTH"`
   - Verify response contains WEEK summaries

2. **Drill into a WEEK:**
   ```
   Now show me the daily summaries for the first week of October
   ```
   - Verify console shows `level: "WEEK"`
   - Verify `period_start` is the first day of the week
   - Verify response contains DAY summaries

3. **Drill into a DAY:**
   ```
   Show me the actual conversation messages from October 3rd
   ```
   - Verify console shows `level: "DAY"`
   - Verify response contains raw `chat_messages` (not summaries)
   - Messages should have `role`, `content`, `created_at` fields

---

## Network Tab Verification (Optional)

### For MCP Tool Calls

1. Open DevTools → **Network** tab
2. Filter: `XHR` or `Fetch`
3. Send a message that should trigger `get_historical_context`
4. Look for request to your worker endpoint (e.g., `https://your-worker.workers.dev`)
5. Click the request → **Payload** tab
6. Verify you see:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "get_historical_context",
    "arguments": {
      "conversation_id": "...",
      "level": "MONTH",
      ...
    }
  }
}
```

---

## Troubleshooting

### Compression Not Showing

**Issue:** No `[Compression]` logs in console

**Causes:**
1. No tool calls made yet → Make a tool call first
2. No user message after tool calls → Tool calls are only stale *after* a new user message
3. Intelligent mode not enabled → Check Settings → Context Mode = "Intelligent"

### Tool Not Found

**Issue:** Error: "Tool 'get_historical_context' not found"

**Causes:**
1. Worker not deployed → Redeploy worker with: `cd packages/worker && npm run deploy`
2. Worker code not updated → Check that worker/src/index.ts includes the new tool
3. MCP connection issue → Check Settings → MCP endpoint is correct

### No Summaries to Drill Into

**Issue:** Tool returns empty `items: []`

**Causes:**
1. No summaries exist for that period → Have longer conversations first
2. Wrong `period_start` → Verify the date matches when summaries were created
3. Branch mismatch → Summaries are branch-aware; make sure you're on the right branch

---

## Quick Reference: Console Search Terms

Copy-paste these into the console filter (🔍 icon in DevTools Console):

| Feature | Search Term |
|---------|------------|
| **Compression** | `[Compression]` |
| **Tool Calls (All)** | `[ChatPane][MCP] Calling tool` |
| **Historical Context** | `get_historical_context` |
| **Tool Results** | `[ChatPane][MCP] Tool result` |
| **Summaries** | `create_conversation_summary` |

---

## Expected Console Output Examples

### Successful Compression
```
[Compression] ✅ Compressed 2 stale tool call(s):
  [{toolName: 'patch_graph_document', originalLength: 3201, compressedLength: 94},
   {toolName: 'get_graph_structure', originalLength: 15482, compressedLength: 45}]
[Compression] Total tokens saved: ~18544 characters
```

### Successful Historical Context Call
```
[ChatPane][MCP] Calling tool get_historical_context with args {
  conversation_id: "abc-123",
  message_id: "msg-456",
  level: "WEEK",
  period_start: "2025-10-20T00:00:00.000Z"
}
[ChatPane][MCP] Tool result {content: '{"level":"WEEK","period_start":"2025-10-20T00:00:00.000Z","items":[...]}'}
```

---

## Success Checklist

Use this to verify both features are working:

### Compression
- [ ] Console shows `[Compression]` logs
- [ ] Compression happens after sending a new user message (following tool calls)
- [ ] Original tool responses still visible in UI
- [ ] Token savings reported in console

### Historical Context Tool
- [ ] System instructions updated with tool documentation
- [ ] Tool call appears in console when prompted
- [ ] MONTH level returns WEEK summaries
- [ ] WEEK level returns DAY summaries
- [ ] DAY level returns raw messages
- [ ] AI successfully drills down through multiple levels
- [ ] Results display naturally in chat

---

## Notes

- **Compression is invisible to the user** - it only affects what the LLM sees, not what you see in the UI
- **Historical context requires existing summaries** - if you have a fresh conversation with no history, there won't be anything to drill into
- **All features respect branch boundaries** - summaries and messages are filtered to the current conversation branch
