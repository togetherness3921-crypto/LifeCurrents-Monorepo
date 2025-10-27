# LifeCurrents Job Dashboard - Complete Specification

## Architecture & Threading Model

### Thread Architecture
1. **Main Thread**: CustomTkinter UI event loop
   - Handles all UI rendering and user interactions
   - Polls update queue every 100ms
   - Window size: 1200x900 pixels

2. **Daemon Thread**: Async event loop (AsyncioThread)
   - Runs Supabase manager
   - Fetches initial jobs on startup
   - Polls database every 5 seconds
   - Sends updates to main thread via queue

3. **Background Thread Pool**: Subprocess output monitors
   - Two daemon threads monitor Worker and MCP server stdout/stderr
   - Logs output with tags [Worker] and [MCP]

### Communication Pattern
- **Queue-based**: `queue.Queue` for thread-safe async→UI communication
- **Message Types**:
  - `{'type': 'INITIAL', 'payload': [jobs]}` - Initial data load
  - `{'type': 'POLL', 'payload': [jobs]}` - Polling updates
  - `{'type': 'REALTIME', 'payload': {...}}` - Real-time events (unused)

## Job Data Model

### Job Object Structure
```python
{
    'id': 'uuid',                          # Primary key
    'title': 'string',                     # Job name
    'status': 'string',                    # See status enum below
    'pr_number': int | None,               # GitHub PR number
    'preview_url': 'string' | None,        # Deployed preview URL
    'branch_name': 'string' | None,        # Git branch name
    'base_version': 'string',              # "main@<commit-sha>"
    'verification_steps': {                # JSON object
        'steps': ['string', ...]           # Array of step descriptions
    } | None,
    'ready_for_integration': bool,         # Flag for reconciliation
    'created_at': 'timestamp',             # ISO8601 timestamp
    'updated_at': 'timestamp',             # ISO8601 timestamp
    'prompt': 'string',                    # Original job prompt (not displayed)
    'integration_summary': 'string',       # Integration context (not displayed)
    'github_run_id': 'string' | None       # GitHub Actions run ID
}
```

### Status Enum
- `'active'` → Display: "IN-PROGRESS" → Color: Blue (#337ab7)
- `'waiting_for_review'` → Display: "REVIEW PENDING" → Color: Green (#5cb85c)
- `'failed'` → Display: "FAILED" → Color: Red (#d9534f)
- `'cancelled'` → Display: "CANCELLED" → Color: Gray (#777777)
- `'integrated_and_complete'` → Display: "INTEGRATED" → Color: Green (#5cb85c)

## UI Components & Layout

### Main Window (1200x900)
```
┌─────────────────────────────────────────────────────────────┐
│  Header Frame                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  "Job Queue" (16pt bold)    [Mark N as Ready...]    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Scrollable Frame (fills remaining space)                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Group Frame (base_version: "main@abc123")          │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │  Job Card 1                                    │  │  │
│  │  │  Job Card 2                                    │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  │                                                       │  │
│  │  Group Frame (base_version: "main@xyz789")          │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │  Job Card 3                                    │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Job Card Layout
```
┌─────────────────────────────────────────────────────────────┐
│ ● [Status Dot]                                              │
│                                                              │
│   Title (bold)                                              │
│                                                              │
│   Verification Steps ▼ (collapsible, gray text)            │
│   ┌──────────────────────────────────────────────────────┐ │
│   │ 1. Step one (white text on dark bg)                 │ │
│   │ 2. Step two                                          │ │
│   └──────────────────────────────────────────────────────┘ │
│                                                              │
│                     [STATUS BADGE]                          │
│                                                              │
│   [View Preview] [Mark for Integration] [Remove]           │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Grid layout:
- Column 0: Status indicator (12x12 circle)
- Column 1: Details frame (weight=1, expandable)
- Column 2: Status label frame (centered)
- Column 3: Actions frame (right-aligned buttons)
```

## Business Logic & Rules

### Job Grouping
1. Group jobs by `base_version` field
2. Sort groups by **most recent job** within each group (descending)
3. Sort jobs within group by `created_at` (descending)
4. Display group header with `base_version` string

### Mark for Integration Button Visibility
**Shows when**: `status == 'waiting_for_review' AND preview_url != None`

**Button States**:
- Not marked: Blue (#337ab7), text "Mark for Integration"
- Marked: Green (#5cb85c), text "Marked ✓"

**Behavior**:
- Click toggles `ready_for_integration` flag
- Updates internal `selected_jobs` set
- Updates header button count: "Mark N as Ready for Integration"
- Header button disabled when N=0

### View Preview Button Visibility
**Shows when**: `preview_url != None`

**Behavior**: Opens URL in system default browser

### Remove Button
**Always shows**, styled red (#d9534f)

**Behavior**:
1. Optimistic UI removal (instant)
2. Async deletion from Supabase
3. Full UI re-render

### Verification Steps Section
**Shows when**: `verification_steps` exists and has `steps` array

**Behavior**:
- Initially collapsed: "Verification Steps ▼"
- Expanded: "Verification Steps ▲"
- Click to toggle
- Dark background (#333), white text
- Wrapped at 400px width

## Sound Notifications

### Completion Sound
- **File**: `microwave-ding-104123.mp3`
- **Trigger**: Job transitions TO `waiting_for_review` (detected by status change)
- **Timing**: Only on polling updates, NOT on initial load
- **Focus**: Plays ALWAYS (regardless of window focus)

### New Job Sound
- **File**: `ui-sounds-pack-2-sound-1-358893.mp3`
- **Trigger**: New job ID appears in data
- **Timing**: Only on polling updates, NOT on initial load
- **Focus**: Plays ALWAYS (regardless of window focus)

### Implementation Notes
- Uses pygame.mixer
- Sounds loaded on init
- Graceful degradation if files missing

## Smart Update System

### Change Detection
Compares current jobs dict with new jobs dict to find:
1. **Added jobs**: IDs in new but not in old
2. **Removed jobs**: IDs in old but not in new
3. **Changed jobs**: IDs in both, but data differs

### Update Strategy

**For text/color changes only**:
- Call `widget.update_job_data(new_job)` - NO widget recreation
- Updates labels, colors, button states in place
- Preserves user interactions (button states, scroll position)

**For structural changes**:
- Preview URL appears/disappears
- Mark button needs to appear/disappear
- Full re-render required

**Always full re-render when**:
- Jobs added or removed
- Structural changes detected

### State Tracking
- `self.jobs`: Current job dict
- `self.previous_job_states`: Map of job_id → status (for change detection)
- `self.selected_jobs`: Set of job IDs marked for integration
- `self.job_widgets`: Map of job_id → widget instance

## Subprocess Management

### Worker Process
- **Command**: `npm run dev --workspace=packages/worker -- --port 8787`
- **Port**: 8787 (local development)
- **Purpose**: Runs Cloudflare Worker locally for MCP tools

### MCP Server Process
- **Command**: `node packages/mcp-server/build/index.js`
- **Purpose**: Provides MCP tools for Cursor IDE integration

### Lifecycle
1. **Startup**: Launched via `subprocess.Popen` with shell=True
2. **Monitoring**: Stdout/stderr captured and logged
3. **Cleanup**: On exit, terminate gracefully (5s timeout), then kill if needed
4. **Error Handling**: Process crashes logged to console

## Supabase Integration

### Connection
- **URL**: `https://cvzgxnspmmxxxwnxiydk.supabase.co`
- **Key**: Anon key (hardcoded in main.py)
- **Client**: Async client (`acreate_client`)

### Operations
1. **fetch_initial_jobs()**: Query all jobs, ordered by created_at desc
2. **fetch_all_jobs()**: Same as above, used for polling
3. **mark_jobs_as_ready(job_ids)**: Update `ready_for_integration=True` for multiple jobs
4. **delete_job(job_id)**: Delete single job by ID

### Polling Interval
- **Frequency**: Every 5 seconds
- **Method**: `asyncio.sleep(5)` in infinite loop
- **Thread**: Runs in daemon asyncio thread

## Graceful Shutdown Sequence

1. Set `is_closing = True` flag (stops queue processing)
2. Stop asyncio thread via `shutdown_event.set()`
3. Join asyncio thread (3s timeout)
4. Terminate Worker and MCP processes (via `atexit` cleanup)
5. Quit pygame mixer
6. Destroy tkinter window

## Known Limitations & Design Decisions

### Why Polling Instead of Realtime?
- Simpler implementation
- More reliable than Supabase realtime subscriptions
- 5-second latency acceptable for use case
- Avoids websocket connection management

### Why Queue-Based Threading?
- Canonical pattern for tkinter + asyncio
- Thread-safe communication
- Avoids `call_soon_threadsafe` complexity
- Clear separation of concerns

### Why Smart Updates?
- Prevents disruption during user interaction
- Maintains scroll position
- Preserves button states (marked/unmarked)
- Better UX than full re-render on every poll

### Why Optimistic UI Updates?
- Instant feedback for user actions
- Backend updates asynchronously
- Polling will correct any inconsistencies within 5s

## Testing & Debugging

### Console Logging
All operations tagged with brackets:
- `[Main]`: Application lifecycle
- `[Init]`: Initialization steps
- `[Async]`: Asyncio thread operations
- `[Async→Queue]`: Messages sent to queue
- `[Queue→UI]`: Messages processed from queue
- `[UI]`: UI operations and renders
- `[Supabase]`: Database operations
- `[Sound]`: Sound playback
- `[Worker]` / `[MCP]`: Subprocess output
- `[Shutdown]`: Cleanup steps

### Key Metrics
- Queue size (after messages added)
- Job counts (initial, added, removed, changed)
- Render triggers (full vs incremental)
- Sound playback confirmations

