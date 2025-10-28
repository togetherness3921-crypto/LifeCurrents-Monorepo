# LifeCurrents Project: Comprehensive Technical Context

## Overview

LifeCurrents is an AI-assisted personal journaling and reflection platform built as a monorepo. This document provides complete technical context for making changes to the application's core functionality.

**Key Principle:** This is a living application with users. All changes must maintain backward compatibility and existing functionality unless explicitly redesigning a feature.

---

## Architecture Overview

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interactions                        │
└──────────────┬────────────────────────┬─────────────────────────┘
               │                        │
       ┌───────▼────────┐      ┌───────▼────────┐
       │   Frontend      │      │  Dashboard-Py   │
       │ (React/Vite)    │      │ (CustomTkinter) │
       │                 │      │                 │
       │ - Chat UI       │      │ - Job Queue     │
       │ - Reflection    │      │ - Job Status    │
       │ - History       │      │ - Verification  │
       └────────┬────────┘      └────────┬────────┘
                │                        │
                │                        ├─── Supabase (polling)
                │                        │
                │                        └─── Local Worker (subprocess)
                │                             Local MCP (subprocess)
                │
                └────────────┬───────────────────┐
                             │                   │
                    ┌────────▼────────┐  ┌──────▼──────┐
                    │  Cloudflare     │  │   Supabase   │
                    │    Worker       │  │   Database   │
                    │  (API Backend)  │  │              │
                    │                 │  │ - users      │
                    │ - /api/chat     │  │ - chats      │
                    │ - /api/reflect  │  │ - messages   │
                    │ - /api/jobs     │  │ - jobs       │
                    │ - Auth          │  │ - graphs     │
                    └─────────────────┘  └──────────────┘
```

---

## Monorepo Structure

```
LifeCurrents/
├── packages/
│   ├── frontend/          # React/TypeScript web application
│   ├── worker/            # Cloudflare Workers backend API
│   ├── dashboard-py/      # Python desktop dashboard for job management
│   └── mcp-server/        # Model Context Protocol server (TypeScript)
├── supabase/
│   ├── migrations/        # Database schema migrations
│   └── config.toml        # Supabase configuration
├── synced_files/
│   └── system_instructions/  # AI system prompts (synced to DB)
├── .cursor/rules/         # Cursor IDE rules for development
└── scripts/               # Utility scripts
```

**Important:** The project root is `C:\LifeCurrents` (Windows development environment).

---

## Database Schema (Supabase/PostgreSQL)

### Core Tables

#### `users`
- `id` (uuid, PK)
- `email` (text, unique)
- `created_at` (timestamp)
- User authentication and profile data

#### `chats`
- `id` (uuid, PK)
- `user_id` (uuid, FK → users)
- `title` (text)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- Represents conversation threads

#### `chat_messages`
- `id` (uuid, PK)
- `chat_id` (uuid, FK → chats)
- `role` (text: 'user' | 'assistant' | 'system')
- `content` (text)
- `created_at` (timestamp)
- Stores individual messages in conversations

#### `jobs` ⭐ **Central to job management system**
- `id` (uuid, PK)
- `title` (text) - Job description
- `prompt` (text) - Full implementation instructions for Claude Code
- `integration_summary` (text) - Context for integration/reconciliation
- `verification_steps` (jsonb) - Steps to verify the job completed correctly
- `status` (text) - State machine: `'active' | 'waiting_for_review' | 'failed' | 'cancelled' | 'integrated_and_complete'`
- `pr_number` (integer) - GitHub PR number
- `preview_url` (text) - Deployment preview URL
- `branch_name` (text) - Git branch name
- `base_version` (text) - Format: `"branch@sha"` (e.g., `"main@abc1234"`)
- `is_verified` (boolean) - User has verified the changes
- `ready_for_integration` (boolean) - Ready to be merged
- `created_at` (timestamp)
- `updated_at` (timestamp)

#### `graph_documents` and `graph_relationships`
- Knowledge graph storage for AI memory system
- `graph_documents`: Nodes with embeddings
- `graph_relationships`: Edges between nodes

---

## Frontend Application (`packages/frontend/`)

### Technology Stack
- **React 18** with TypeScript
- **Vite** for build tooling
- **Tailwind CSS** for styling
- **React Router** for navigation
- **Zustand** for state management

### Key Files and Structure

```
packages/frontend/src/
├── components/
│   ├── Chat.tsx              # Main chat interface
│   ├── MessageList.tsx       # Message display component
│   ├── InputArea.tsx         # User input component
│   ├── Reflection.tsx        # Reflection/journaling interface
│   ├── History.tsx           # Chat history sidebar
│   └── Calendar.tsx          # Calendar view component
├── stores/
│   ├── chatStore.ts          # Chat state management (Zustand)
│   └── authStore.ts          # Authentication state
├── lib/
│   ├── supabase.ts           # Supabase client initialization
│   └── api.ts                # Worker API client
├── App.tsx                   # Root component with routing
└── main.tsx                  # Entry point
```

### Data Flow in Frontend

1. **User Input** → InputArea component
2. **API Call** → Worker backend (`/api/chat` or `/api/reflect`)
3. **Response Handling** → Update Zustand store
4. **UI Update** → React re-render with new messages
5. **Persistence** → Automatic save to Supabase via Worker

### Authentication Flow
- Uses Supabase Auth
- JWT tokens stored in browser
- Auth state managed in `authStore.ts`
- Protected routes check auth before rendering

### Key Patterns
- **Optimistic UI**: Updates shown immediately, rolled back on error
- **Real-time**: Supabase Realtime subscriptions for multi-device sync
- **Error Boundaries**: Graceful error handling throughout

---

## Backend Worker (`packages/worker/`)

### Technology Stack
- **Cloudflare Workers** (serverless edge computing)
- **TypeScript**
- **Hono** framework (lightweight Express-like)
- **Supabase JS Client**
- **Claude API** (Anthropic)

### Key Files

```
packages/worker/src/
├── index.ts              # Main entry point, request routing
├── handlers/
│   ├── chat.ts           # /api/chat - Chat message handling
│   ├── reflect.ts        # /api/reflect - Reflection processing
│   ├── jobs.ts           # Job management endpoints
│   └── auth.ts           # Authentication middleware
├── lib/
│   ├── claude.ts         # Claude API wrapper
│   ├── supabase.ts       # Supabase client
│   └── memory.ts         # AI memory/context retrieval
└── types.ts              # TypeScript type definitions
```

### Environment Variables (`.dev.vars`)
```
SUPABASE_URL=https://cvzgxnspmmxxxwnxiydk.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_KEY=eyJhbGci... (server-side)
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_PAT=ghp_... (for GitHub API access)
GITHUB_OWNER=togetherness3921-crypto
GITHUB_REPO=LifeCurrents-Monorepo
CLOUDFLARE_API_TOKEN=... (for API calls)
WORKER_BASE_URL=http://localhost:8787 (dev) or https://worker.domain.com (prod)
```

### API Endpoints

#### `POST /api/chat`
- Handles conversational chat messages
- Retrieves relevant memory/context from knowledge graph
- Calls Claude API with system instructions
- Saves messages to database
- Returns streaming response

#### `POST /api/reflect`
- Processes reflection/journaling entries
- More introspective system prompt
- Extracts insights for knowledge graph
- Similar flow to chat endpoint

#### `POST /api/dispatch-job`
- Creates new job in database
- Fetches latest commit SHA from GitHub
- Triggers GitHub Actions workflow for Claude Code execution
- Used by MCP server (called from Cursor IDE)

#### `POST /api/job-result`
- Webhook called by GitHub Actions when job completes
- Updates job status to `'waiting_for_review'`
- Sets PR number and preview URL

#### `GET /api/get-ready-jobs`
- Fetches jobs marked `ready_for_integration: true` and `status: 'waiting_for_review'`
- Returns job diffs from GitHub API
- Used by MCP integration tools

#### `POST /api/mark-jobs-integrated`
- Updates job status to `'integrated_and_complete'`
- Called after successful merge

### Authentication Middleware
```typescript
// Extracts JWT from Authorization header
// Validates with Supabase
// Attaches user_id to request context
```

### Error Handling
- All endpoints return standardized JSON errors
- HTTP status codes: 200 (success), 400 (bad request), 401 (unauthorized), 500 (server error)
- Detailed error messages in development, sanitized in production

---

## Python Dashboard (`packages/dashboard-py/`)

### Purpose
Desktop application for managing code generation jobs. Displays job queue, verification steps, and allows marking jobs ready for integration.

### Technology Stack
- **Python 3.12**
- **CustomTkinter** (modern Tkinter wrapper)
- **Supabase Python Client** (async)
- **asyncio** for concurrent operations
- **pygame** for sound notifications

### Architecture Pattern: **Multi-threaded with Message Queue**

```
┌──────────────────────────────────────────────────────────┐
│              Main Thread (CustomTkinter UI)              │
│  - Renders UI                                            │
│  - Handles user input                                    │
│  - Processes queue.Queue messages every 100ms            │
└─────────────┬────────────────────────────────────────────┘
              │
              │ queue.Queue (thread-safe)
              │
┌─────────────▼────────────────────────────────────────────┐
│        Asyncio Thread (Daemon, Background)               │
│  - Manages asyncio event loop                            │
│  - Polls Supabase every 5 seconds                        │
│  - Handles database operations (async)                   │
│  - Puts updates in queue                                 │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│           Subprocess 1: Cloudflare Worker                │
│  - npm run dev --workspace=packages/worker               │
│  - Runs on http://localhost:8787                         │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│           Subprocess 2: MCP Server                       │
│  - node packages/mcp-server/build/index.js               │
│  - Exposes tools to Cursor IDE                           │
└──────────────────────────────────────────────────────────┘
```

### Key Files

```
packages/dashboard-py/
├── main.py                   # ⭐ Main application entry
├── ui_components.py          # ⭐ ModernJobCard, ModernGroupHeader widgets
├── supabase_client.py        # Async Supabase manager
├── requirements.txt          # Python dependencies
├── start-dashboard.bat       # Windows launcher
└── [sound files]             # Notification sounds
```

### `main.py` - Core Application

**Key Classes:**

#### `AsyncioThread(threading.Thread)`
- Daemon thread running asyncio event loop
- Initializes `SupabaseManager`
- Methods:
  - `run()`: Entry point, creates loop and runs `async_main()`
  - `async_main()`: Fetches initial jobs, starts polling
  - `handle_polling_update(jobs)`: Callback, puts jobs in queue
  - `delete_job(job_id)`: Thread-safe job deletion
  - `mark_as_ready(job_ids)`: Thread-safe ready marking

#### `JobDashboard(ctk.CTk)`
Main application window.

**State Variables:**
- `self.jobs`: Dict[str, dict] - Job data keyed by job ID
- `self.job_widgets`: Dict[str, ModernJobCard] - Widget references
- `self.previous_job_states`: Dict[str, str] - For detecting status changes
- `self.update_queue`: queue.Queue - Thread-safe message passing
- `self.async_thread`: AsyncioThread - Background thread reference

**Key Methods:**
- `__init__()`: Initializes UI, starts threads, starts queue processing
- `start_subprocesses()`: Launches Worker and MCP Server with correct `cwd`
- `start_async_thread()`: Starts asyncio thread
- `process_queue()`: **Canonical polling pattern** - checks queue every 100ms
- `handle_initial_data(jobs, is_initial)`: Updates `self.jobs`, triggers render
- `render_all_jobs()`: **Smart UI diffing** - only re-renders changed jobs
- `on_toggle_ready(job_id, is_ready)`: Verification callback, marks job ready immediately
- `delete_job(job_id)`: Optimistic UI delete, triggers async deletion
- `on_closing()`: Graceful shutdown - stops threads, kills subprocesses

**Critical Pattern: Queue Processing**
```python
def process_queue(self):
    """Polls queue every 100ms, processes messages, updates UI."""
    while not self.update_queue.empty():
        message = self.update_queue.get()
        if message['type'] == 'INITIAL':
            self.handle_initial_data(message['payload'], is_initial=True)
        elif message['type'] == 'POLL':
            self.handle_initial_data(message['payload'], is_initial=False)
    
    if not self.is_closing:
        self.after(100, self.process_queue)  # Reschedule
```

**UI Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  Header: "Job Queue" + job count badge                      │
├─────────────────────────────────────────────────────────────┤
│  Scrollable Job List:                                        │
│    Group Header (base_version: main@abc1234) - 3 jobs       │
│      ┌─────────────────────────────────────────────────┐    │
│      │ [STATUS] Job Title                    [Actions] │    │
│      │ 🕐 date  PR #123  📎 sha                        │    │
│      │ 📋 Verification Steps (3) ▼                     │    │
│      └─────────────────────────────────────────────────┘    │
│    (more jobs...)                                            │
└─────────────────────────────────────────────────────────────┘
```

### `ui_components.py` - Job Card Widgets

#### `ModernJobCard(ctk.CTkFrame)`
Displays individual job with verification system.

**Layout Structure:**
- Grid with 3 columns: `[Status Badge] [Content] [Actions]`
- Content expands (column weight=1)

**Key Features:**
1. **Selectable Text**: All text uses `CTkTextbox` in `state="disabled"` for copy/paste
2. **Verification Steps with Checkboxes**:
   - Each step has: number badge, checkbox, selectable text
   - Checkboxes bidirectionally synced with verified state
3. **"Verified?" Button**:
   - Default: Yellow (#f39c12), text "Verified?"
   - Verified: Green, text "Verified ✓"
   - Clicking toggles all checkboxes
   - Checking all boxes triggers verification
4. **Verification → Auto-mark Ready**: When verified, immediately calls `on_toggle_ready(job_id, True)`

**Key Methods:**
- `_create_status_section()`: Status badge (left)
- `_create_content_section()`: Title, metadata, verification steps (center)
- `_create_actions_section()`: Preview and Remove buttons (right)
- `_create_verification_steps()`: Collapsible section with checkboxes and verified button
- `toggle_verification_steps()`: Show/hide steps
- `_on_checkbox_changed()`: Individual checkbox handler, checks if all checked
- `_toggle_verified()`: Verified button handler, sets all checkboxes
- `_update_verified_button()`: Updates button appearance

**Color Scheme:**
```python
COLORS = {
    'card_bg': '#1e1e1e',           # Dark gray background
    'border': '#2d2d2d',             # Subtle border
    'text_primary': '#ffffff',       # White text
    'text_secondary': '#a0a0a0',     # Gray metadata
    'accent_blue': '#3498db',        # Blue for actions
    'accent_green': '#27ae60',       # Green for success
    'accent_red': '#e74c3c',         # Red for delete
    'accent_orange': '#f39c12',      # Orange for "Verified?"
    'status_active': '#3498db',      # Blue
    'status_review': '#f39c12',      # Orange
    'status_integrated': '#27ae60',  # Green
    'status_failed': '#e74c3c',      # Red
    'status_cancelled': '#7f8c8d',   # Gray
    'verification_bg': '#2a2a2a',    # Dark background for steps
}
```

#### `ModernGroupHeader(ctk.CTkFrame)`
Groups jobs by `base_version` (git branch@sha).

**Display:**
- Left: `📦 main@abc1234` (selectable textbox)
- Right: Job count badge

### `supabase_client.py` - Async Database Operations

#### `SupabaseManager`
Manages all Supabase interactions.

**Key Methods:**
- `initialize()`: Creates async Supabase client
- `fetch_initial_jobs()`: Returns all non-integrated jobs
- `start_polling(callback, interval_seconds)`: Polls database, calls callback with jobs
- `mark_jobs_as_ready(job_ids)`: Sets `ready_for_integration: true`
- `delete_job(job_id)`: Deletes job from database
- `cleanup()`: Closes client

**Important:** All methods are `async` and run in the asyncio thread event loop.

### Threading Model (Critical!)

**Why This Architecture?**
- CustomTkinter is **not thread-safe** - UI must be updated from main thread only
- Database operations are async (Supabase Python client uses asyncio)
- Solution: Message queue pattern

**Flow:**
1. Main thread renders UI, handles user input
2. User clicks "Delete" → Main thread calls `async_thread.delete_job(id)`
3. Asyncio thread receives request via `asyncio.run_coroutine_threadsafe()`
4. Asyncio thread performs async database operation
5. Polling detects change
6. Asyncio thread puts update in `queue.Queue`
7. Main thread (in `process_queue()`) pulls from queue
8. Main thread updates UI

**Critical Rule:** Never call UI methods from asyncio thread, never call async methods directly from main thread.

### Subprocess Management

**Launched on Startup:**
```python
# From packages/dashboard-py/main.py
project_root = Path(__file__).parent.parent.parent  # C:\LifeCurrents

# Worker
subprocess.Popen(
    "npm run dev --workspace=packages/worker -- --port 8787",
    cwd=str(project_root),
    shell=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE
)

# MCP Server
subprocess.Popen(
    "node packages/mcp-server/build/index.js",
    cwd=str(project_root),
    shell=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE
)
```

**Important:** Both must run from project root (`C:\LifeCurrents`) to find correct paths.

**Cleanup:** `atexit.register(cleanup_processes)` ensures subprocesses are terminated on exit.

### Sound Notifications

**Pygame mixer** plays sounds for:
- New job created
- Job completed (status → `waiting_for_review`)

Files: `microwave-ding-104123.mp3`, `ui-sounds-pack-2-sound-1-358893.mp3`

---

## MCP Server (`packages/mcp-server/`)

### Purpose
Exposes tools to Cursor IDE for job management via Model Context Protocol.

### Technology Stack
- **TypeScript**
- **MCP SDK** (`@modelcontextprotocol/sdk`)
- **Node.js**

### Key File: `src/index.ts`

**Exposed Tools:**

#### `dispatch_job`
- Parameters: `title`, `prompt`, `integration_summary`
- Calls Worker API: `POST /api/dispatch-job`
- Creates job, triggers GitHub Actions

#### `get_ready_jobs`
- No parameters
- Calls Worker API: `GET /api/get-ready-jobs`
- Returns jobs ready for integration with diffs

#### `mark_jobs_integrated`
- Parameters: `job_ids` (array)
- Calls Worker API: `POST /api/mark-jobs-integrated`
- Updates jobs to `integrated_and_complete`

**Configuration:**
- Reads `CLOUDFLARE_WORKER_URL` and `CLOUDFLARE_API_TOKEN` from environment
- Communicates with local or deployed Worker

**Cursor Integration:**
- Defined in `.cursor/mcp.json` (not in repo)
- Cursor AI can call these tools when working with user

---

## Job Management Workflow

### Complete Lifecycle

```
1. JOB DISPATCH (from Cursor)
   ├─ User/AI decides to create task
   ├─ MCP tool: dispatch_job(title, prompt, integration_summary)
   ├─ Worker: /api/dispatch-job
   │  ├─ Fetch latest commit SHA
   │  ├─ Create job in DB (status: 'active')
   │  └─ Trigger GitHub Actions workflow
   └─ Dashboard: Shows new job (IN PROGRESS)

2. EXECUTION (GitHub Actions - not in this repo)
   ├─ Claude Code processes job
   ├─ Creates branch: job-<uuid>
   ├─ Makes code changes
   ├─ Commits changes
   ├─ Creates pull request
   ├─ Deploys preview
   └─ Webhook: POST /api/job-result

3. VERIFICATION (in Dashboard)
   ├─ Job status → 'waiting_for_review' (REVIEW badge)
   ├─ Dashboard polls, updates UI
   ├─ User opens preview URL
   ├─ User checks verification steps
   ├─ User clicks checkboxes or "Verified?" button
   └─ Job marked ready_for_integration: true

4. INTEGRATION (from Cursor)
   ├─ MCP tool: get_ready_jobs()
   ├─ Returns jobs + diffs
   ├─ AI integrates changes (merge or cherry-pick)
   ├─ MCP tool: mark_jobs_integrated([job_ids])
   └─ Job status → 'integrated_and_complete' (DONE)
```

### Job States

```
active → waiting_for_review → integrated_and_complete
           ↓                ↑
         failed          (on error)
           ↓
       cancelled
```

**Database Constraint:**
```sql
CHECK (status IN ('active', 'waiting_for_review', 'failed', 'cancelled', 'integrated_and_complete'))
```

### Verification Steps Structure

**Database (JSONB):**
```json
{
  "steps": [
    "Visual: Check that button appears blue",
    "Interaction: Click button, confirm modal opens",
    "Deployment: Verify preview URL loads"
  ]
}
```

**UI Display:**
- Numbered badges (1, 2, 3)
- Checkboxes for each step
- Selectable text for copy/paste
- "Verified?" button at bottom

---

## Key Patterns and Conventions

### Database Operations

**Always use prepared statements:**
```typescript
// Good
supabase.from('jobs').select('*').eq('id', jobId)

// Bad (SQL injection risk)
supabase.rpc('custom_function', { raw_sql: `SELECT * FROM jobs WHERE id = '${jobId}'` })
```

**Optimistic UI Updates:**
```typescript
// 1. Update UI immediately
this.jobs = this.jobs.filter(j => j.id !== jobId)
this.render()

// 2. Make API call
await api.deleteJob(jobId)

// 3. On error, rollback
catch (error) {
  this.jobs.push(deletedJob)
  this.render()
}
```

### Error Handling

**Worker (backend):**
```typescript
try {
  // operation
  return new Response(JSON.stringify({ success: true }), { status: 200 })
} catch (error) {
  console.error('[Handler] Error:', error)
  return new Response(
    JSON.stringify({ error: error.message }),
    { status: 500 }
  )
}
```

**Frontend:**
```typescript
try {
  await api.callEndpoint()
} catch (error) {
  toast.error(`Failed: ${error.message}`)
  // Rollback optimistic update
}
```

**Dashboard:**
```python
try:
    # async operation
    await self.manager.delete_job(job_id)
except Exception as e:
    print(f"[Error] {e}")
    # UI already updated optimistically, database stays consistent
```

### Logging Conventions

**Prefix Format:** `[Component] Message`

Examples:
- `[Auth] User logged in: ${userId}`
- `[Worker] Dispatching job: ${jobId}`
- `[UI] Rendering 14 jobs`
- `[Async→Queue] Sending update to UI`
- `[Queue→UI] Processing message #1`

**Log Levels (implicit):**
- `[Component]` - Info
- `[Component] Warning:` - Warning
- `[Component] Error:` - Error

### File Naming

**TypeScript/JavaScript:**
- `camelCase.ts` for modules
- `PascalCase.tsx` for React components

**Python:**
- `snake_case.py` for modules
- `PascalCase` for classes

**Markdown:**
- `SCREAMING_SNAKE_CASE.md` for important docs
- `kebab-case.md` for guides

### Git Workflow

**Branch Naming:**
- Jobs: `job-<uuid>`
- Features: `feature/description`
- Fixes: `fix/description`

**Commit Messages:**
- First line: Imperative, under 72 chars
- Body: Details, wrapped at 72 chars
- Reference issues: `Fixes #123`

---

## Development Environment

### Required Tools
- **Node.js** 20.x (for Worker, MCP Server)
- **Python** 3.12 (for Dashboard)
- **npm** 10.x (monorepo management)
- **Git**

### Local Development Setup

**1. Install Dependencies:**
```bash
# Root (for workspaces)
npm install

# Worker
npm install --workspace=packages/worker

# MCP Server
npm install --workspace=packages/mcp-server
cd packages/mcp-server && npm run build

# Dashboard
cd packages/dashboard-py
pip install -r requirements.txt
```

**2. Environment Variables:**

Create `packages/worker/.dev.vars`:
```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...
ANTHROPIC_API_KEY=...
GITHUB_PAT=...
CLOUDFLARE_API_TOKEN=...
```

**3. Start Services:**

**Option A: Manual**
```bash
# Terminal 1: Worker
cd C:\LifeCurrents
npm run dev --workspace=packages/worker

# Terminal 2: MCP Server
cd C:\LifeCurrents
node packages/mcp-server/build/index.js

# Terminal 3: Dashboard
cd C:\LifeCurrents\packages\dashboard-py
python main.py
```

**Option B: Dashboard Auto-starts Worker + MCP**
```bash
cd C:\LifeCurrents\packages\dashboard-py
python main.py
# Launches subprocesses automatically
```

### Common Issues

**"websockets.asyncio not found"**
- Solution: `pip install --upgrade websockets>=13.1`

**"Cannot find module packages/mcp-server"**
- Cause: Running subprocess from wrong directory
- Solution: Ensure `cwd=project_root` in subprocess.Popen

**"Workspace not found"**
- Cause: npm command not run from project root
- Solution: Check subprocess working directory

**Dashboard doesn't show jobs**
- Check: Supabase credentials in Worker `.dev.vars`
- Check: Worker running on port 8787
- Check: Async thread started (see logs: `[Async] Initializing...`)

---

## Making Changes: Key Considerations

### When Modifying the Frontend

**1. State Management:**
- Use Zustand for global state
- Keep component state local when possible
- Update store immutably (spread operators)

**2. API Calls:**
- Use existing `lib/api.ts` client
- Handle loading states
- Show user feedback (toasts, spinners)

**3. Styling:**
- Use Tailwind classes
- Follow existing color scheme
- Mobile-responsive (test on small screens)

**4. Performance:**
- Memoize expensive computations (`useMemo`)
- Virtualize long lists (react-window)
- Lazy load routes/components

### When Modifying the Worker

**1. Endpoints:**
- Follow existing patterns (see `handlers/`)
- Validate input (TypeScript types + runtime checks)
- Return consistent JSON format

**2. Supabase Queries:**
- Use `.select()`, `.insert()`, `.update()`, `.delete()`
- Filter with `.eq()`, `.in()`, etc.
- Always check for errors: `if (error) throw error`

**3. Claude API:**
- Use streaming for better UX
- Include system instructions from database
- Handle rate limits gracefully

**4. Secrets:**
- Never hardcode keys
- Use environment variables (`env.VARIABLE`)
- Different keys for dev/prod

### When Modifying the Dashboard

**1. Threading Rules:**
- UI operations: Main thread only
- Database operations: Asyncio thread only
- Communication: queue.Queue

**2. UI Updates:**
- Use smart diffing (don't re-render everything)
- Track previous state to detect changes
- Update job count badge when jobs change

**3. Adding Features:**
- New buttons: Add to `ui_components.py` in actions section
- New job fields: Add to `ModernJobCard._create_content_section()`
- New endpoints: Call from `supabase_client.py` async methods

**4. CustomTkinter Specifics:**
- Use `CTkButton`, `CTkLabel`, etc. (not Tkinter originals)
- Set `fg_color` for backgrounds
- Use `grid()` or `pack()` consistently (don't mix)
- For selectable text: `CTkTextbox` with `state="disabled"`

### Database Schema Changes

**1. Create Migration:**
```sql
-- supabase/migrations/YYYYMMDDHHMMSS_description.sql
ALTER TABLE jobs ADD COLUMN new_field text;
```

**2. Update TypeScript Types:**
```typescript
// packages/worker/src/types.ts
interface Job {
  // ... existing fields
  new_field?: string
}
```

**3. Update Python Types:**
```python
# packages/dashboard-py/main.py
job: dict  # TypedDict could be used for better typing
```

**4. Apply Migration:**
- Local: `supabase db push` (if using Supabase CLI)
- Production: Migrations auto-apply on deploy

**5. Backward Compatibility:**
- Make new fields nullable
- Provide default values
- Handle old data gracefully

---

## Integration Points

### Frontend ↔ Worker
- **Protocol:** HTTPS/JSON
- **Auth:** JWT in Authorization header
- **Endpoints:** `/api/chat`, `/api/reflect`, etc.
- **Error Handling:** Try/catch, display user-friendly messages

### Worker ↔ Supabase
- **Protocol:** Supabase JS Client (REST + WebSocket)
- **Auth:** Service key (server-side) or Anon key + JWT (client-side)
- **Operations:** CRUD + Realtime subscriptions
- **Error Handling:** Check `error` field in response

### Dashboard ↔ Supabase
- **Protocol:** Supabase Python Client (async)
- **Auth:** Anon key (no user context needed)
- **Polling:** Every 5 seconds
- **Error Handling:** Try/except, log errors, continue polling

### Dashboard ↔ Worker (subprocess)
- **Lifecycle:** Started on dashboard launch, killed on exit
- **Communication:** HTTP (dashboard doesn't call Worker directly, just ensures it's running)

### Dashboard ↔ MCP Server (subprocess)
- **Lifecycle:** Started on dashboard launch, killed on exit
- **Communication:** Stdio (MCP protocol)
- **Purpose:** Expose tools to Cursor

### Cursor IDE ↔ MCP Server
- **Protocol:** Model Context Protocol (stdio)
- **Tools:** dispatch_job, get_ready_jobs, mark_jobs_integrated
- **Config:** `.cursor/mcp.json` (user-specific, not in repo)

### Worker ↔ GitHub API
- **Auth:** Personal Access Token
- **Operations:**
  - Fetch commit SHA (GET `/repos/:owner/:repo/commits/:branch`)
  - Trigger workflow (POST `/repos/:owner/:repo/actions/workflows/:id/dispatches`)
  - Fetch PR diff (GET `/repos/:owner/:repo/pulls/:number`)
- **Error Handling:** Retry on rate limit, fail gracefully otherwise

---

## Testing Strategy

### Frontend
- **Unit Tests:** Jest + React Testing Library
- **Integration Tests:** Mock API calls
- **E2E Tests:** Playwright (if implemented)

### Worker
- **Unit Tests:** Vitest
- **Integration Tests:** Test against local Supabase
- **API Tests:** `wrangler dev` + curl/Postman

### Dashboard
- **Manual Testing:** Primary method
- **Smoke Tests:** Launch, verify UI loads, check subprocesses
- **Integration Tests:** Mock Supabase responses

---

## Performance Considerations

### Frontend
- **Bundle Size:** Code-split routes, lazy load components
- **Render Performance:** Memoize expensive computations, virtualize lists
- **Network:** Cache API responses, debounce user input

### Worker
- **Cold Start:** Minimize dependencies, use global state for connections
- **Database Queries:** Index frequently queried columns, use `.select('id, title')` not `*`
- **Claude API:** Stream responses, implement request queuing

### Dashboard
- **UI Responsiveness:** Don't block main thread, use asyncio for I/O
- **Memory:** Limit stored jobs (e.g., last 100), clear old data
- **Polling Frequency:** 5 seconds is reasonable, don't go below 2 seconds

---

## Security Considerations

### Authentication
- **Frontend:** JWT stored in localStorage, sent in Authorization header
- **Worker:** Validate JWT on every request, extract user_id
- **Dashboard:** No user authentication (local tool)

### Authorization
- **Row-Level Security (RLS):** Enabled on Supabase tables
- **User Isolation:** Users can only access their own chats/messages
- **Admin Operations:** Use service key for job management (no RLS)

### API Keys
- **Storage:** Environment variables, never in code
- **Rotation:** Regularly update keys
- **Least Privilege:** Use minimal scopes (e.g., GitHub PAT only needs repo access)

### Input Validation
- **Frontend:** Client-side validation for UX
- **Worker:** Server-side validation (never trust client)
- **SQL Injection:** Use parameterized queries (Supabase client handles this)

---

## Troubleshooting Guide

### Dashboard Won't Start

**1. Check Python Version:**
```bash
python --version  # Should be 3.12+
```

**2. Check Dependencies:**
```bash
pip list | grep customtkinter
pip list | grep supabase
pip list | grep websockets  # Should be >=13.1
```

**3. Check Logs:**
Look for `[Init]` messages, should see:
- "Starting background services..."
- "Cloudflare Worker started (PID: ...)"
- "MCP Server started (PID: ...)"
- "Asyncio thread started. Thread alive: True"

**4. Common Errors:**
- `ModuleNotFoundError: websockets.asyncio` → `pip install --upgrade websockets>=13.1`
- `IndentationError` → Check `ui_components.py` for syntax errors
- Crash with no logs → Run `python main.py` directly to see traceback

### Worker Not Responding

**1. Check Process:**
```bash
# Windows
netstat -ano | findstr :8787

# Linux/Mac
lsof -i :8787
```

**2. Check Logs:**
Worker logs appear in Dashboard under `[Worker]` prefix or in separate terminal if run manually.

**3. Test Endpoint:**
```bash
curl http://localhost:8787/api/health
```

**4. Check Environment:**
- Verify `.dev.vars` exists
- Check Supabase credentials are correct
- Ensure Anthropic API key is valid

### Jobs Not Appearing in Dashboard

**1. Check Database:**
```sql
SELECT id, title, status FROM jobs ORDER BY created_at DESC LIMIT 10;
```

**2. Check Asyncio Thread:**
Look for logs:
- `[Async] Fetching initial jobs...`
- `[Supabase] Found X jobs.`
- `[Async→Queue] Sending X initial jobs to UI queue`

**3. Check Queue Processing:**
Look for logs:
- `[Queue→UI] Processing message #1: INITIAL`
- `[UI] handle_initial_data called with X jobs`

**4. Check Filters:**
Dashboard only shows jobs with `status != 'integrated_and_complete'`. Completed jobs are hidden.

### MCP Tools Not Working in Cursor

**1. Check MCP Server:**
Should see log: `[Init] MCP Server started (PID: ...)`

**2. Check Cursor Config:**
`.cursor/mcp.json` should reference the server (user-specific file).

**3. Restart Cursor:**
Sometimes MCP connections get stale, restart Cursor IDE.

**4. Check Worker:**
MCP tools call Worker API, ensure Worker is running.

---

## Code Quality Standards

### TypeScript
- **Strict Mode:** Enabled (`strict: true` in tsconfig.json)
- **No `any`:** Use proper types or `unknown`
- **Interfaces:** Define for all data structures
- **Async/Await:** Prefer over `.then()` chains

### Python
- **Type Hints:** Use where helpful (not required everywhere)
- **Docstrings:** For classes and non-obvious functions
- **PEP 8:** Follow style guide
- **f-strings:** Use for string interpolation

### React
- **Functional Components:** Use hooks, avoid classes
- **Props:** Destructure in function signature
- **Keys:** Use stable IDs, not array indices
- **Effects:** Cleanup subscriptions, cancel requests

### General
- **Comments:** Explain WHY, not WHAT
- **Naming:** Descriptive, not abbreviated (except standard abbreviations)
- **Functions:** Do one thing, name reflects purpose
- **Files:** Focused responsibility, reasonable size (<500 lines ideal)

---

## Deployment

### Frontend
- **Build:** `npm run build --workspace=packages/frontend`
- **Output:** `packages/frontend/dist/`
- **Hosting:** Cloudflare Pages (static site)

### Worker
- **Build:** Automatic on deploy
- **Deploy:** `wrangler deploy` (from `packages/worker/`)
- **Hosting:** Cloudflare Workers (edge computing)

### Dashboard
- **Distribution:** Manual (users run locally)
- **Packaging:** Could use PyInstaller for .exe

---

## Future Considerations

### Scalability
- **Database:** Supabase can scale, add indexes as queries grow
- **Worker:** Edge computing scales automatically
- **Dashboard:** Single-user tool, not a concern

### Monitoring
- **Frontend:** Sentry for error tracking
- **Worker:** Cloudflare Analytics, custom logging
- **Dashboard:** Local logs only (no telemetry)

### Feature Ideas
- **Multi-user Dashboard:** Web-based, not Python desktop
- **Real-time Job Updates:** WebSocket instead of polling
- **Job Templates:** Pre-defined prompts for common tasks
- **Integration History:** Track what was merged and when

---

## Summary

LifeCurrents is a sophisticated multi-component system with:
- **React Frontend** for user interaction
- **Cloudflare Worker** for serverless API backend
- **Python Dashboard** for developer job management
- **Supabase** for persistent storage
- **MCP Server** for IDE integration

Key architectural patterns:
- **Threading:** Asyncio + message queues for UI consistency
- **Optimistic UI:** Immediate feedback, rollback on error
- **Smart Rendering:** Only update changed components
- **Subprocess Management:** Lifecycle tied to main application

When making changes:
1. **Understand the data flow** (see architecture diagrams)
2. **Respect threading boundaries** (especially in Dashboard)
3. **Maintain backward compatibility** (users have existing data)
4. **Test thoroughly** (UI, API, database interactions)
5. **Log appropriately** (helps debugging in production)

This document provides the foundation. Explore the codebase with this context, and you'll understand how everything connects.

