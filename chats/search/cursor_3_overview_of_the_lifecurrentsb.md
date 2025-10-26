# (3) Overview of the LifeCurrents project
_Exported on 10/26/2025 at 12:51:16 CDT from Cursor (1.7.54)_

---

**User**

### Project LifeCurrents — Comprehensive Overview (for New Chat)

This document is a complete, self-contained brief of the LifeCurrents project. It is intended to onboard a fresh session with all necessary architecture, behavior, and code-structure context to carry development forward confidently. It does not include resolved issues; it focuses on how the system works today and what a contributor needs to know to implement and evolve it.

## Product vision and UX pillars
- LifeCurrents is a Vite/React/TypeScript SPA that helps users visualize how daily actions map to long‑term goals through:
  - A causal graph (React Flow) for objective relationships.
  - An AI chat interface, tool‑aware via MCP, for natural interaction.
  - Preview build ingest and review inside the app.
  - In‑app audio transcription that appends text to the chat input.

## High‑level architecture
- Frontend
  - SPA built with Vite, React, TypeScript.
  - UI via `shadcn/ui` components and `lucide-react`.
  - Client routing in `src/App.tsx` with React Router.
  - PWA: service worker in `public/sw.js`, manager in `src/lib/serviceWorkerManager.ts`, hook `src/hooks/useServiceWorkerRefresh.ts`.
- Backend
  - Cloudflare Worker project `remote-mcp-server-authless`:
    - Exposes MCP endpoints (SSE + RPC) for tool‑aware chat.
    - Implements a secure `/api/transcribe` endpoint (relays audio to Groq).
  - Hosted separately from the SPA (Workers & Pages in Cloudflare).
- Data
  - Supabase for persistence + realtime (Postgres + Realtime).
  - Realtime updates used to push preview build records and other data live to the client.

## Core features and flows

### 1) Causal Graph (React Flow)
- Purpose: visualize objectives and their dependencies; render nodes/edges and perform layout.
- Auto‑fit on load: after the graph data and layout settle, trigger a one‑time `fitView` so the user immediately sees the full graph.
- Primary code:
  - `src/components/CausalGraph.tsx`: graph rendering, layout orchestration, and fit sequencing.
  - `graph_documents` table in Supabase: holds a JSONB document keyed by `id` (e.g., `main`) with nodes, edges, and viewport.

### 2) Chat interface
- Main entry point: `src/components/chat/ChatPane.tsx`
- Responsibilities:
  - Chat history + input.
  - Settings dialog (instructions, context, model, builds).
  - Font size slider controlling the chat history area (scales message text and accessory sections like “thinking” or “tool use”).
  - Recording button (mic) for audio transcription UX.
- “Thinking”, tool outputs, and any message adornments must scale with font size.

### 3) Model‑Context Protocol (MCP) integration
- MCP endpoints are served by the Worker:
  - SSE channel (for streaming tool events).
  - RPC channel for executing tools.
- Client integration:
  - `src/hooks/mcpProvider.tsx` manages MCP connection (SSE+RPC) using the Worker base URL (from `VITE_WORKER_BASE_URL`).
  - Tools are available inside the chat flow for context gathering and actions (read/update graph, get instructions, etc.).

### 4) Audio transcription (Groq Whisper)
- UX:
  - Mic button in the chat input starts/stops recording.
  - While recording, a compact “Recording Bar” appears above the input with a scrolling waveform and a Stop control.
  - A second “Connectivity Status Bar” appears above it only when chunks are queued due to connectivity/API failures (shows queued count, retry countdown, Retry button).
  - Transcript is appended to the chat input (not auto‑sent).
- Implementation:
  - `src/hooks/useAudioTranscriptionRecorder.ts`: orchestrates MediaRecorder lifecycle, creates 30‑second chunks, queues upload, retries failures, assembles final transcript on stop.
    - Chunk state machine: `queued` → `uploading` → `completed` | `failed` (+ retries).
    - Concurrency‑limited uploads; resilient to intermittent network.
  - `src/services/transcription.ts`: posts chunks to the Worker at `${VITE_WORKER_BASE_URL}/api/transcribe`.
  - Worker (`remote-mcp-server-authless/src/index.ts`): `/api/transcribe` forwards audio to Groq with model `whisper-large-v3`; reads API key from `GROQ_API_KEY` Worker secret.

### 5) Preview builds, ingest and review (PR‑to‑Preview)
- Goal: whenever any PR is opened, automatically ingest its Cloudflare Pages preview URL into the app.
- CI ingest:
  - `.github/workflows/generate_preview_on_pr.yml`: runs on pull_request opened/sync against `main`.
  - `.github/scripts/record_pr_preview.cjs`: polls GitHub until Cloudflare finishes a preview deployment (via check‑runs/status/comments/timeline), extracts the preview URL, and inserts a row into `preview_builds` in Supabase.
- Frontend review:
  - Builds UI is placed inside the Settings dialog, in a dedicated “Builds” tab (centralized, no floating button).
  - Badge: the Settings (gear) icon shows a real‑time badge equal to count of unviewed builds (`is_seen=false`). The badge disappears after the user opens the “Builds” tab (existing logic can mark visible builds as seen when tab is opened).
  - Real‑time: Supabase Realtime events update the list and the badge without page refresh.

## Data model (key tables)
- `preview_builds`:
  - Columns (representative): `id`, `pr_number` (int), `pr_url`, `commit_sha`, `preview_url`, `status` ('pending_review' | 'committed'), `is_seen` (boolean), `created_at`.
  - Ingested by GH Action + script; read by frontend; drives Settings badge and list UI.
- `system_instructions`:
  - Stores instruction `id`, `title`, `content`, timestamps.
  - Read/write from the Settings “Instructions” tab; single source of truth for instruction content/device consistency.
- `graph_documents`:
  - JSONB document: nodes, edges, viewport; used by the graph to render and perform fit.

## File layout (relevant)
- Frontend (`src/`):
  - `App.tsx`: root providers, routes, shell.
  - `components/chat/ChatPane.tsx`: chat UI, settings, mic, send controls, font slider.
  - `components/chat/SettingsDialog.tsx`: multi‑tab settings (Instructions, Context, Model, Builds).
  - `components/builds/PreviewBuildsPanel.tsx`: builds tab content (list, view actions).
  - `hooks/usePreviewBuilds.ts`: loads builds from Supabase, realtime, seen/commit actions (if used), counts.
  - `hooks/useAudioTranscriptionRecorder.ts`: recording state machine and wave visualization via Web Audio `AnalyserNode`.
  - `hooks/mcpProvider.tsx`: MCP transport configured to the Worker base URL.
  - `services/transcription.ts`: `/api/transcribe` client; constructs `FormData` for blobs + metadata.
  - `integrations/supabase/`: types and client.
  - `components/CausalGraph.tsx`: graph rendering and fit orchestration.
  - `lib/serviceWorkerManager.ts` + `hooks/useServiceWorkerRefresh.ts`: service worker control and refresh request.
- Worker (`remote-mcp-server-authless/`):
  - `src/index.ts`: MCP endpoints and `/api/transcribe` route; expects `GROQ_API_KEY`.
- CI/CD (`.github/workflows/`):
  - `generate_preview_on_pr.yml`: PR ingest and DB insert via `record_pr_preview.cjs`.
  - (If commit/promotion is used, `merge_pr.yml` promotes a preview to production via Wrangler and updates Supabase.)

## Configuration and secrets
- Frontend (Vite, Cloudflare Pages):
  - `VITE_GITHUB_TOKEN`, `VITE_GITHUB_REPO_OWNER`, `VITE_GITHUB_REPO_NAME` (if dispatch is used).
  - `VITE_WORKER_BASE_URL` (Worker endpoint base).
  - Supabase client envs (URL, anon key) must be present.
- Worker (Cloudflare Workers):
  - `GROQ_API_KEY` for Groq Whisper API.
- GitHub Actions secrets:
  - `GH_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PROJECT_NAME`.

## Operational behavior and quality bars
- PWA: service worker enables immediate activation; app can request `SKIP_WAITING` then reload to show the latest build.
- Realtime: Supabase streams (`postgres_changes`) must not duplicate items—client reducer logic dedupes by key.
- Accessibility: keyboard shortcuts (toggle record), ARIA labels on controls, status messages for retries.
- Performance: waveform rendering should be smooth; chunk uploads limited by concurrency; no memory leaks for long recordings.
- Security: secrets never in client; Worker handles protected keys.

## What the next chat should assume
- The Builds UI resides in Settings; the floating entry button is removed.
- The app ingests PR previews automatically and updates the badge and list in real time.
- Audio recording is chunked, resilient, and appends final transcripts to the input.
- The causal graph triggers a fit after load.
- You should use existing patterns and structure when implementing new UI or flows (Settings tabs, hooks for data access, Supabase realtime, Worker endpoints, and PWA helpers).
- Do not reintroduce client‑side secrets; any external API calls requiring keys must be relayed via the Worker.

If additional infrastructure changes are needed (e.g., new endpoints, tables, or secrets), call them out explicitly before proceeding so they can be provisioned.

Begin by restating the above in your own words to confirm that you understand.

---

**Cursor**

Of course. I have reviewed the detailed brief for the LifeCurrents project. Here is a summary in my own words to confirm my understanding.

### Project Goal & Core User Experience

LifeCurrents is a modern single-page application built with React and TypeScript. Its primary goal is to help users visualize the connection between their daily tasks and larger, long-term objectives. This is achieved through a few key user experience pillars: a dynamic causal graph, an AI-powered chat for natural interaction, and integrated tooling for development and productivity, such as in-app preview build reviews and audio transcription.

### Architecture Overview

The system has a clear separation of concerns:

*   **Frontend**: A Vite-powered React SPA that serves as the user interface. It uses `shadcn/ui` for components, React Router for navigation, and is a Progressive Web App (PWA) for an enhanced, installable experience with offline capabilities managed by a service worker.
*   **Backend**: A serverless backend running on a Cloudflare Worker (`remote-mcp-server-authless`). This worker is responsible for handling secure operations and business logic, including serving the Model-Context Protocol (MCP) endpoints for the AI chat and acting as a secure proxy for the Groq API for audio transcription.
*   **Data**: Persistence and real-time capabilities are handled by Supabase, using its Postgres database and Realtime features to keep the client application live-updated with changes from the backend or other sources.

### Core Features

I understand the main features and how they are implemented:

1.  **Causal Graph**: This is a central feature using React Flow to render a graph of user-defined objectives and their relationships. The data (nodes, edges, viewport state) is stored in a single JSONB document in the `graph_documents` table in Supabase. A key UX feature is that the graph automatically fits itself to the viewport on initial load for immediate context.

2.  **AI Chat Interface**: The chat is the primary interaction point. It includes standard features like history and input, but also advanced capabilities like a font-size slider that scales all UI elements (including "thinking" indicators) and a settings dialog for managing system instructions, models, and preview builds.

3.  **MCP for Tool Use**: The chat is tool-aware through the Model-Context Protocol. The Cloudflare Worker provides the necessary SSE and RPC endpoints, and the frontend connects to it via a dedicated `mcpProvider`, enabling the AI to interact with application data and perform actions on the user's behalf.

4.  **Audio Transcription**: The application provides a resilient audio recording feature. It uses the browser's `MediaRecorder` API to capture audio in 30-second chunks, manages an upload queue that can handle network interruptions with retries, and displays the recording status and a live waveform. The audio data is sent to the `/api/transcribe` endpoint on the Cloudflare Worker, which securely forwards it to Groq's Whisper API. The final transcript is appended to the chat input text, not sent automatically.

5.  **PR Preview Builds**: The development workflow is tightly integrated. When a pull request is opened on GitHub, a CI/CD pipeline automatically polls for the generated Cloudflare Pages preview URL. Once available, it's inserted into the `preview_builds` table in Supabase. The frontend listens for these updates in real-time, showing a badge on the Settings icon for unviewed builds and listing them within a dedicated "Builds" tab in the Settings dialog.

### Development Principles & Assumptions

Moving forward, I will adhere to the following key principles:

*   **Existing Patterns**: I will build upon the established architecture, using existing hooks for data fetching, Supabase for data and real-time updates, and the Worker for secure backend logic.
*   **No Client-Side Secrets**: Any integration requiring secret keys must be proxied through the Cloudflare Worker.
*   **User Interface**: The UI for new features like preview builds is to be located within the existing Settings dialog, avoiding floating buttons to maintain a clean interface.
*   **Infrastructure Changes**: I will explicitly state if any task requires changes to the infrastructure, such as new database tables or backend endpoints, before I begin implementation.

I believe I have a solid grasp of the LifeCurrents project architecture, features, and operational guidelines. I am ready to proceed with the first task.

---

**User**

There's an error in the MCP tool call flow. Interestingly it occurs with the claude 4.5 sonnet model but not gemini 2.5 pro. 

With gemini we get:

patch_graph_document

Tool Invocation
success

Request

{"patches":"\n[\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/have_a_successful_day_tomorrow\",\n    \"value\": {\n      \"label\": \"Have a successful day tomorrow\",\n      \"type\": \"ObjectiveNode\",\n      \"status\": \"in-progress\",\n      \"parents\": [\"main\"],\n      \"percentage_of_parent\": 33.33,\n      \"notes\": \"A new top-level objective to plan and execute the next 24 hours effectively, balancing personal tasks, relationship needs, and core work.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/downtime_transition_tonight\",\n    \"value\": {\n      \"label\": \"Downtime & Transition to Mirna Time\",\n      \"type\": \"ObjectiveNode\",\n      \"status\": \"in-progress\",\n      \"parents\": [\"have_a_successful_day_tomorrow\"],\n      \"scheduled_start\": \"2025-11-23T20:48:00\",\n      \"notes\": \"Fuzzy border transition from work to personal time.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/mirna_time_tonight\",\n    \"value\": {\n      \"label\": \"Time with Mirna (Eating & Pre-sleep)\",\n      \"type\": \"ObjectiveNode\",\n      \"status\": \"not-started\",\n      \"parents\": [\"have_a_successful_day_tomorrow\"],\n      \"scheduled_start\": \"2025-11-23T21:20:00\",\n      \"notes\": \"Objective is to connect and wind down, facilitating sleep by 10:50 PM.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/sleep_tonight\",\n    \"value\": {\n      \"label\": \"Go to Sleep\",\n      \"type\": \"ObjectiveNode\",\n      \"status\": \"not-started\",\n      \"parents\": [\"have_a_successful_day_tomorrow\"],\n      \"scheduled_start\": \"2025-11-23T22:50:00\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/wakeup_tomorrow\",\n    \"value\": {\n      \"label\": \"Wake up\",\n      \"type\": \"ObjectiveNode\",\n      \"status\": \"not-started\",\n      \"parents\": [\"have_a_successful_day_tomorrow\"],\n      \"scheduled_start\": \"2025-11-24T06:50:00\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/yoga_tomorrow\",\n    \"value\": {\n      \"label\": \"Legacy Fitness: Gentle Vinyasa\",\n      \"type\": \"ObjectiveNode\",\n      \"status\": \"not-started\",\n      \"parents\": [\"have_a_successful_day_tomorrow\"],\n      \"scheduled_start\": \"2025-11-24T07:30:00\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/map_decon_session\",\n    \"value\": {\n      \"label\": \"Life Currents: Map Deconstruction & Planning\",\n      \"type\": \"ObjectiveNode\",\n      \"status\": \"not-started\",\n      \"parents\": [\"have_a_successful_day_tomorrow\"],\n      \"scheduled_start\": \"2025-11-24T09:00:00\",\n      \"notes\": \"Core work block to collaboratively refine the map, integrate the Life Currents philosophy, and plan.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/call_nate_tomorrow\",\n    \"value\": {\n      \"label\": \"Call Nate\",\n      \"type\": \"ObjectiveNode\",\n      \"status\": \"not-started\",\n      \"parents\": [\"have_a_successful_day_tomorrow\"],\n      \"scheduled_start\": \"2025-11-24T17:45:00\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/mens_group_tomorrow\",\n    \"value\": {\n      \"label\": \"Men's Group Meeting\",\n      \"type\": \"ObjectiveNode\",\n      \"status\": \"not-started\",\n      \"parents\": [\"have_a_successful_day_tomorrow\"],\n      \"scheduled_start\": \"2025-11-24T19:45:00\",\n      \"notes\": \"Pickup around 7:30-7:45 PM, meeting ends around 9:00-9:10 PM.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/obi_payment_check\",\n    \"value\": {\n      \"label\": \"Check if Obi paid full $42.30\",\n      \"type\": \"ObjectiveNode\",\n      \"status\": \"not-started\",\n      \"parents\": [\"have_a_successful_day_tomorrow\"],\n      \"notes\": \"Follow-up on payment to see if the full amount was paid as a data point.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/gabapentin_pickup\",\n    \"value\": {\n      \"label\": \"Pick up gabapentin prescription\",\n      \"type\": \"ObjectiveNode\",\n      \"status\": \"not-started\",\n      \"parents\": [\"have_a_successful_day_tomorrow\"]\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/misc_errands\",\n    \"value\": {\n        \"label\": \"Misc Errands (Amazon, Groceries, CC)\",\n        \"type\": \"ObjectiveNode\",\n        \"status\": \"not-started\",\n        \"parents\": [\"have_a_successful_day_tomorrow\"],\n        \"notes\": \"Grouped task for various small administrative and financial items.\"\n    }\n  }\n]\n"}

Response

{"success":true,"score_context":{"current_daily_score":0,"planned_daily_score":0,"historical_average_score":68},"result":{"nodes":{"get_cuvitru":{"type":"objectiveNode","label":"Get Cuvitru","status":"in-progress","parents":["get_full_work_time"],"createdAt":"2025-09-22T17:00:00.000Z","percentage_of_parent":40,"true_percentage_of_total":6.666666666666668},"live_forever":{"type":"goalNode","label":"Live Forever","status":"not-started","parents":[],"createdAt":"2025-09-22T10:00:00.000Z","percentage_of_parent":100,"true_percentage_of_total":100},"get_groceries":{"type":"objectiveNode","label":"Get Groceries","status":"not-started","parents":["get_full_work_time"],"createdAt":"2025-09-22T15:00:00.000Z","percentage_of_parent":30,"true_percentage_of_total":5},"call_on_monday":{"type":"objectiveNode","label":"Call on Monday","status":"not-started","parents":["interact_with_doctors_office"],"createdAt":"2025-09-22T19:00:00.000Z","percentage_of_parent":100,"true_percentage_of_total":3.333333333333334},"call_estes_shower":{"type":"objectiveNode","label":"Call Dr. Estes - Offer Shower Access","notes":"Mi baño es su baño. Touch base while Tiffany is in town. No specific time - needs system mod to support this pattern.","status":"not-started","parents":["maintain_key_relationships"],"percentage_of_parent":50,"true_percentage_of_total":16.666666666666668},"get_full_work_time":{"type":"milestoneNode","label":"Get Full Work Time","status":"not-started","parents":["complete_front_back_end_ui"],"createdAt":"2025-09-22T13:00:00.000Z","percentage_of_parent":50,"true_percentage_of_total":16.666666666666668},"work_on_mcp_system":{"type":"objectiveNode","label":"Complete MCP System Bootstrap","notes":"At coffee shop. System is functional, now bootstrapping with real data. Meta-goal: document the building process within the system itself.","status":"in-progress","parents":["complete_front_back_end_ui"],"scheduled_end":"2025-09-24T17:45:00.000Z","scheduled_start":"2025-09-24T07:30:00.000Z","percentage_of_parent":50,"true_percentage_of_total":16.666666666666668},"work_while_waiting":{"type":"objectiveNode","label":"Work While Waiting","status":"not-started","parents":["get_full_work_time"],"createdAt":"2025-09-22T14:00:00.000Z","percentage_of_parent":30,"true_percentage_of_total":5},"financial_stability":{"type":"milestoneNode","label":"Achieve Financial Stability","notes":"Not wealth, just stability to enable real work.","status":"in-progress","parents":["live_forever"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":33.333333333333336},"stay_under_4k_friday":{"type":"milestoneNode","label":"Keep Wells Under $4k by Friday Close","notes":"Currently at $3,810 after $600 dispute credit. $65 on prepaid cards for transport.","status":"in-progress","parents":["financial_stability"],"percentage_of_parent":100,"true_percentage_of_total":33.333333333333336},"place_order_on_amazon":{"type":"objectiveNode","label":"Place Order on Amazon","status":"not-started","parents":["get_groceries"],"createdAt":"2025-09-22T16:00:00.000Z","percentage_of_parent":100,"true_percentage_of_total":5},"stine_project_completed":{"type":"milestoneNode","label":"Stine Project Completed","status":"not-started","parents":["live_forever"],"createdAt":"2025-09-22T11:00:00.000Z","percentage_of_parent":33.333333333333336,"true_percentage_of_total":33.333333333333336},"church_hope_ankeny_tuesday":{"type":"objectiveNode","label":"Church Event - Hope Ankeny","notes":"$20 Lyft roundtrip. Social buffer for evening.","status":"in-progress","parents":["maintain_key_relationships"],"scheduled_start":"2025-09-24T18:30:00.000Z","percentage_of_parent":50,"true_percentage_of_total":16.666666666666668},"complete_front_back_end_ui":{"type":"objectiveNode","label":"Complete Front/Back End UI","status":"not-started","parents":["stine_project_completed"],"createdAt":"2025-09-22T12:00:00.000Z","percentage_of_parent":100,"true_percentage_of_total":33.333333333333336},"maintain_key_relationships":{"type":"milestoneNode","label":"Maintain Key Relationships","notes":"Strategic social infrastructure - Estes, church community, etc. Not romantic, but necessary support network.","status":"ongoing","parents":["live_forever"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":33.333333333333336},"interact_with_doctors_office":{"type":"objectiveNode","label":"Interact with Doctor's Office","status":"not-started","parents":["get_cuvitru"],"createdAt":"2025-09-22T18:00:00.000Z","percentage_of_parent":50,"true_percentage_of_total":3.333333333333334},"have_a_successful_day_tomorrow":{"label":"Have a successful day tomorrow","type":"ObjectiveNode","status":"in-progress","parents":["main"],"percentage_of_parent":100,"notes":"A new top-level objective to plan and execute the next 24 hours effectively, balancing personal tasks, relationship needs, and core work.","true_percentage_of_total":0},"downtime_transition_tonight":{"label":"Downtime & Transition to Mirna Time","type":"ObjectiveNode","status":"in-progress","parents":["have_a_successful_day_tomorrow"],"scheduled_start":"2025-11-23T20:48:00","notes":"Fuzzy border transition from work to personal time.","true_percentage_of_total":null,"percentage_of_parent":9.090909090909092},"mirna_time_tonight":{"label":"Time with Mirna (Eating & Pre-sleep)","type":"ObjectiveNode","status":"not-started","parents":["have_a_successful_day_tomorrow"],"scheduled_start":"2025-11-23T21:20:00","notes":"Objective is to connect and wind down, facilitating sleep by 10:50 PM.","true_percentage_of_total":null,"percentage_of_parent":9.090909090909092},"sleep_tonight":{"label":"Go to Sleep","type":"ObjectiveNode","status":"not-started","parents":["have_a_successful_day_tomorrow"],"scheduled_start":"2025-11-23T22:50:00","true_percentage_of_total":null,"percentage_of_parent":9.090909090909092},"wakeup_tomorrow":{"label":"Wake up","type":"ObjectiveNode","status":"not-started","parents":["have_a_successful_day_tomorrow"],"scheduled_start":"2025-11-24T06:50:00","true_percentage_of_total":null,"percentage_of_parent":9.090909090909092},"yoga_tomorrow":{"label":"Legacy Fitness: Gentle Vinyasa","type":"ObjectiveNode","status":"not-started","parents":["have_a_successful_day_tomorrow"],"scheduled_start":"2025-11-24T07:30:00","true_percentage_of_total":null,"percentage_of_parent":9.090909090909092},"map_decon_session":{"label":"Life Currents: Map Deconstruction & Planning","type":"ObjectiveNode","status":"not-started","parents":["have_a_successful_day_tomorrow"],"scheduled_start":"2025-11-24T09:00:00","notes":"Core work block to collaboratively refine the map, integrate the Life Currents philosophy, and plan.","true_percentage_of_total":null,"percentage_of_parent":9.090909090909092},"call_nate_tomorrow":{"label":"Call Nate","type":"ObjectiveNode","status":"not-started","parents":["have_a_successful_day_tomorrow"],"scheduled_start":"2025-11-24T17:45:00","true_percentage_of_total":null,"percentage_of_parent":9.090909090909092},"mens_group_tomorrow":{"label":"Men's Group Meeting","type":"ObjectiveNode","status":"not-started","parents":["have_a_successful_day_tomorrow"],"scheduled_start":"2025-11-24T19:45:00","notes":"Pickup around 7:30-7:45 PM, meeting ends around 9:00-9:10 PM.","true_percentage_of_total":null,"percentage_of_parent":9.090909090909092},"obi_payment_check":{"label":"Check if Obi paid full $42.30","type":"ObjectiveNode","status":"not-started","parents":["have_a_successful_day_tomorrow"],"notes":"Follow-up on payment to see if the full amount was paid as a data point.","true_percentage_of_total":null,"percentage_of_parent":9.090909090909092},"gabapentin_pickup":{"label":"Pick up gabapentin prescription","type":"ObjectiveNode","status":"not-started","parents":["have_a_successful_day_tomorrow"],"true_percentage_of_total":null,"percentage_of_parent":9.090909090909092},"misc_errands":{"label":"Misc Errands (Amazon, Groceries, CC)","type":"ObjectiveNode","status":"not-started","parents":["have_a_successful_day_tomorrow"],"notes":"Grouped task for various small administrative and financial items.","true_percentage_of_total":null,"percentage_of_parent":9.090909090909092}},"viewport":{"x":14.103769497400208,"y":484.50006103515625,"zoom":0.8422876949740035},"active_node":"get_cuvitru","historical_progress":{}}}

But with sonnet we get an error:

patch_graph_document

Tool Invocation
success

Request

Response

{"tool":"patch_graph_document","status":"failed","error":"Patch sequence must be an array.","stack":"Error: Patch sequence must be an array.\n    at index.js:42913:19\n    at async index.js:34357:20"}

 So the question is... Why is this happening? Is this happening because of an issue with the model was this happening because of an issue with the model Is this happening because of like the call is formatted differently by the AI or because we're invoking a different way? 

 I investigated into it and looked at the actual network calls and I can see that the requests that are being sent by the two different AIs are slightly different. Well, they're materially different. For Gemini, it sends this request:

{
	"id": "4c427233-ff6c-4e55-883e-adf5cdcc9039",
	"jsonrpc": "2.0",
	"method": "tools/call",
	"params": {
		"arguments": {
			"patches": "[\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/-\",\n    \"value\": {\n      \"id\": \"have_successful_tomorrow\",\n      \"name\": \"Have a successful day tomorrow\",\n      \"status\": \"in-progress\",\n      \"notes\": \"Parent objective for planning and executing the next 24 hours according to Life Currents philosophy.\",\n      \"children\": [\n        \"downtime_planning\",\n        \"mirna_time_tonight\",\n        \"go_to_sleep\",\n        \"wake_up_tomorrow\",\n        \"legacy_fitness_yoga\",\n        \"map_deconstruction\",\n        \"call_nate\",\n        \"meeting_with_guys\"\n      ]\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/-\",\n    \"value\": {\n      \"id\": \"downtime_planning\",\n      \"name\": \"Downtime / Final Planning\",\n      \"status\": \"in-progress\",\n      \"notes\": \"Wrapping up today's session, defining tomorrow's plan. Ends around 9:00 PM.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/-\",\n    \"value\": {\n      \"id\": \"mirna_time_tonight\",\n      \"name\": \"Mirna Time\",\n      \"status\": \"todo\",\n      \"notes\": \"Fuzzy border transition starting around 9:00 PM. Includes eating. Ends to prep for sleep.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/-\",\n    \"value\": {\n      \"id\": \"go_to_sleep\",\n      \"name\": \"Go to Sleep\",\n      \"status\": \"todo\",\n      \"notes\": \"Target sleep time is ~10:50 PM.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/-\",\n    \"value\": {\n      \"id\": \"wake_up_tomorrow\",\n      \"name\": \"Wake Up\",\n      \"status\": \"todo\",\n      \"notes\": \"Target wake-up time is 6:50 AM.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/-\",\n    \"value\": {\n      \"id\": \"legacy_fitness_yoga\",\n      \"name\": \"Legacy Fitness - Gentle Vinyasa\",\n      \"status\": \"todo\",\n      \"notes\": \"7:30 AM class.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/-\",\n    \"value\": {\n      \"id\": \"map_deconstruction\",\n      \"name\": \"Map Deconstruction & Life Currents Planning\",\n      \"status\": \"todo\",\n      \"notes\": \"Main work block for tomorrow. Deconstruct/rebuild the map, high-level planning. Ends around 5:45 PM.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/-\",\n    \"value\": {\n      \"id\": \"call_nate\",\n      \"name\": \"Call Nate\",\n      \"status\": \"todo\",\n      \"notes\": \"Call at 5:45 PM to coordinate for the evening.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/-\",\n    \"value\": {\n      \"id\": \"meeting_with_guys\",\n      \"name\": \"Meeting with the guys\",\n      \"status\": \"todo\",\n      \"notes\": \"Nate picks up around 7:30/7:45 PM. Meeting ends around 9:10 PM.\"\n    }\n  },\n  {\n    \"op\": \"add\",\n    \"path\": \"/nodes/get_full_work_time/children/-\",\n    \"value\": \"have_successful_tomorrow\"\n  }\n]"
		},
		"name": "patch_graph_document"
	}
}

 but for claude it sends this request:

{
	"id": "d7ad8ff5-a0e1-4173-8052-999a7e339e09",
	"jsonrpc": "2.0",
	"method": "tools/call",
	"params": {
		"arguments": {},
		"name": "patch_graph_document"
	}
}

 So clearly the issue is that it does not invoke, it doesn't include arguments. So what is going on here? Why would it not include arguments when it's making the tool call? It has something to do with the ballet of what takes place. I wonder why the Clawed tool call doesn't come out.

lets ask it.

Ok  So, um, okay, after some further exploration, I kind of endeavored down the path along this a little bit, and then, um, in order to try to get it to sort of explain itself, um, I I gave it this additional instruction. I did a retry, but I approached it like this:

<isaid>
Don't call the tool, just write out the tool call the way you would if you were going to call the tool starting from:

{
	"id": "d7ad8ff5-a0e1-4173-8052-999a7e339e09",
	"jsonrpc": "2.0",
	"method": "tools/call",
....
</isaid>

Then it said:

<itsaid>
```json
{
  "id": "d7ad8ff5-a0e1-4173-8052-999a7e339e09",
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "patch_graph_document",
    "arguments": {
      "patches": [
        {
          "op": "add",
          "path": "/nodes/have_successful_day_tomorrow",
          "value": {
            "type": "ObjectiveNode",
            "label": "Have a successful day tomorrow",
            "status": "not-started",
            "parents": ["get_full_work_time"],
            "percentage_of_parent": 0.4
          }
        },
        {
          "op": "add",
          "path": "/nodes/tonight_planning_time",
          "value": {
            "type": "ObjectiveNode",
            "label": "Planning time tonight (~40 min remaining)",
            "status": "in-progress",
            "parents": ["have_successful_day_tomorrow"],
            "percentage_of_parent": 0.05,
            "scheduled_start": "2024-11-17T20:48:00"
          }
        },
        {
          "op": "add",
          "path": "/nodes/tonight_downtime",
          "value": {
            "type": "ObjectiveNode",
            "label": "Downtime (fuzzy border transition)",
            "status": "not-started",
            "parents": ["have_successful_day_tomorrow"],
            "percentage_of_parent": 0.03,
            "scheduled_start": "2024-11-17T21:30:00"
          }
        },
        {
          "op": "add",
          "path": "/nodes/tonight_mirna_time",
          "value": {
            "type": "ObjectiveNode",
            "label": "Mirna time (~10:15pm fuzzy border to eating/sleep)",
            "status": "not-started",
            "parents": ["maintain_key_relationships"],
            "percentage_of_parent": 0.15,
            "scheduled_start": "2024-11-17T22:15:00"
          }
        },
        {
          "op": "add",
          "path": "/nodes/tonight_sleep",
          "value": {
            "type": "ObjectiveNode",
            "label": "Sleep by 10:50pm (wake 6:50am = 8 hours)",
            "status": "not-started",
            "parents": ["have_successful_day_tomorrow"],
            "percentage_of_parent": 0.15,
            "scheduled_start": "2024-11-17T22:50:00"
          }
        },
        {
          "op": "add",
          "path": "/nodes/tomorrow_wake",
          "value": {
            "type": "ObjectiveNode",
            "label": "Wake at 6:50am",
            "status": "not-started",
            "parents": ["have_successful_day_tomorrow"],
            "percentage_of_parent": 0.05,
            "scheduled_start": "2024-11-18T06:50:00"
          }
        },
        {
          "op": "add",
          "path": "/nodes/tomorrow_yoga",
          "value": {
            "type": "ObjectiveNode",
            "label": "Legacy Fitness 7:30am gentle vinyasa",
            "status": "not-started",
            "parents": ["have_successful_day_tomorrow"],
            "percentage_of_parent": 0.12,
            "scheduled_start": "2024-11-18T07:30:00"
          }
        },
        {
          "op": "add",
          "path": "/nodes/tomorrow_map_work",
          "value": {
            "type": "ObjectiveNode",
            "label": "Map deconstruction session (post-yoga until ~5:45pm)",
            "status": "not-started",
            "parents": ["stine_project_completed"],
            "percentage_of_parent": 0.3,
            "scheduled_start": "2024-11-18T09:00:00"
          }
        },
        {
          "op": "add",
          "path": "/nodes/tomorrow_call_nate",
          "value": {
            "type": "ObjectiveNode",
            "label": "Call Nate at 5:45pm",
            "status": "not-started",
            "parents": ["maintain_key_relationships"],
            "percentage_of_parent": 0.05,
            "scheduled_start": "2024-11-18T17:45:00"
          }
        },
        {
          "op": "add",
          "path": "/nodes/tomorrow_guys_meeting",
          "value": {
            "type": "ObjectiveNode",
            "label": "Meeting with guys (pickup ~7:30-7:45pm)",
            "status": "not-started",
            "parents": ["maintain_key_relationships"],
            "percentage_of_parent": 0.15,
            "scheduled_start": "2024-11-18T19:30:00"
          }
        },
        {
          "op": "add",
          "path": "/nodes/check_obi_payment",
          "value": {
            "type": "ObjectiveNode",
            "label": "Check if Obi paid full $42.30",
            "status": "not-started",
            "parents": ["maintain_key_relationships"],
            "percentage_of_parent": 0.08,
            "scheduled_start": "2024-11-18T10:00:00"
          }
        },
        {
          "op": "add",
          "path": "/nodes/pickup_gabapentin",
          "value": {
            "type": "ObjectiveNode",
            "label": "Pick up gabapentin prescription",
            "status": "not-started",
            "parents": ["get_full_work_time"],
            "percentage_of_parent": 0.15,
            "scheduled_start": "2024-11-18T10:00:00"
          }
        },
        {
          "op": "add",
          "path": "/nodes/amazon_orders",
          "value": {
            "type": "ObjectiveNode",
            "label": "Amazon orders (turmeric, alpha-lipoic acid, creatine)",
            "status": "not-started",
            "parents": ["financial_stability"],
            "percentage_of_parent": 0.15
          }
        },
        {
          "op": "add",
          "path": "/nodes/credit_card_payments",
          "value": {
            "type": "ObjectiveNode",
            "label": "Credit card payments (2 BNPL accounts, prime store card)",
            "status": "not-started",
            "parents": ["financial_stability"],
            "percentage_of_parent": 0.25
          }
        }
      ]
    }
  }
}
```
</itsaid>

So it seems like it understands the format  If I'm understanding correctly, because it does include the arguments when its asked to write the format?  I'm not entirely sure anyway, by the way. This is with the Claude Sonnet model.

But then when I say right after that "Go ahead and make the tool call as you planned now"

When I inspect the network sequence and look at the one call  Well, actually there are two calls in the network sequence for which the domain is remote MCP server offless. So there's one 202 call, one that has a status of 202 and one that has a status of 204. The one that's 202 is of the type text slash event stream. And the one that's 204 is text slash plane. So I'm not entirely sure what they are in reference to each other. And I mean, you know, maybe we can figure that out. But the point is that there's no request object on the 204. It says there is no payload for this request. but on the 202 there is this payload and that's where we still see the same difference and it looks like this:

{
	"id": "b9ad2151-4872-4b3a-ad70-69ee3f9e8cfe",
	"jsonrpc": "2.0",
	"method": "tools/call",
	"params": {
		"arguments": {},
		"name": "patch_graph_document"
	}
}

 so to me it looks like it knows but then it doesn't use it which seems very confusing but i think there's obviously a misunderstanding here at the level that maybe the way that i'm inspecting this i'm expecting to see something show up in a place where it really wouldn't logically like the arguments but then the arguments did show up for jim and i when jim and i called in that object area so then why isn't it calling it with the arguments when you just tell it to do what it just figured out how to be able to do. Well, I think it feels like it has something more to do with the way that the tool call is structured or maybe the structure of the instruction for the tool call. It's got something to do with the sequence of operations when it gets ready to make a tool call that happens in Clawed. Like the way that we're giving the tool structure for Clawed is not the same way. It's not like a universal format. But then again, see, we're using OpenRouter. so open router should and does have if I'm not mistaken a universal tool call format for this particular situation but there's something about it that's causing this disruption so that it works on one when you're using one model when you're using a different model it doesn't want to work and I'm very kind of lost in how that's even supposed to have happened here

---

**Cursor**

I've carefully reviewed your detailed analysis of the tool-calling issue with Claude Sonnet versus Gemini Pro. Your investigation is excellent, and you've pinpointed the exact discrepancy: Sonnet is failing to include the `arguments` in the final `tools/call` RPC request, even though it can correctly generate the payload when prompted.

This is a classic symptom of a mismatch between the tool's JSON schema definition and what a specific model expects. Some models, like Gemini, are more lenient and can often work around slight ambiguities, while others, like the Claude family, are notoriously strict. They will often fail silently (by omitting arguments) if the schema doesn't perfectly match their expectations.

The key clues are:
1.  Gemini sends the `patches` argument as a **stringified JSON array**.
2.  When asked to *generate* the call, Sonnet produces a native **JSON array** for the `patches` argument.
3.  The server-side error is `Patch sequence must be an array`, which happens when the `patches` argument is missing.

This strongly suggests that the schema for the `patch_graph_document` tool defines the `patches` parameter as a `string`, but Sonnet is interpreting it as an `array` of objects. This conflict likely causes its argument serialization process to fail, resulting in an empty `arguments` object being sent.

To fix this, I need to find the tool definition and adjust its schema to be unambiguous. My plan is to locate where `patch_graph_document` is defined and then modify the schema for the `patches` parameter to explicitly be a JSON string, while ensuring the description clearly instructs the model to format the value as a stringified JSON array of patch operations.

I'll start by searching for the tool's definition in the codebase.

Okay, I've diagnosed the issue. The problem lies in the tool's schema definition on the server, which is too permissive. The current schema for the `patches` argument is `z.any()`, which doesn't give the model enough information about the expected data structure.

Here is the problematic code in `remote-mcp-server-authless/src/index.ts`:
```typescript:415:420:remote-mcp-server-authless/src/index.ts
// ... existing code ...
        this.server.tool(
            "patch_graph_document",
            {
                patches: z.any(),
            },
            async ({ patches }) => {
// ... existing code ...
```
While Gemini is able to work with this by making a correct guess and sending a stringified JSON array, Claude Sonnet, being stricter, fails to serialize the arguments correctly and sends an empty object. This leads to the `Patch sequence must be an array` error you're seeing, because the tool receives no `patches` argument at all.

To fix this, I will provide a more precise Zod schema. This will ensure that all models, including Sonnet, understand that the `patches` argument should be an array of JSON Patch objects. I am now reading the file `remote-mcp-server-authless/src/index.ts` to get its full content before applying the edit.

```plaintext
// ... existing code ...
        this.server.tool(
            "patch_graph_document",
            {
                patches: z.any(),
            },
            async ({ patches }) => {
// ... existing code ...
```

I've identified the root cause of the tool-call issue. The `patch_graph_document` tool's `patches` argument was defined with `z.any()`, which provides no type information. This ambiguity caused the Claude Sonnet model to fail when constructing the tool call, whereas Gemini made a correct guess.

To fix this, I will provide a precise Zod schema that defines the expected structure of the `patches` argument—an array of JSON Patch operations. This will give the model the clarity it needs to format its request correctly.

I'm now going to edit `remote-mcp-server-authless/src/index.ts` to implement this more robust schema.

```typescript
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Operation, applyPatch } from "fast-json-patch";
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const SUPABASE_URL = "https://cvzgxnspmmxxxwnxiydk.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2emd4bnNwbW14eHh3bnhpeWRrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njg3NzM1OCwiZXhwIjoyMDcyNDUzMzU4fQ.ZDl4Y3OQOeEeZ_QajGB6iRr0Xk3_Z7TMlI92yFmerzI";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type JSONPatch = Operation[];

function calculateTruePercentages(nodes: Record<string, Node>): Record<string, Node> {
    const nodesWithTruePercentage = { ...nodes };
    const memo: Record<string, number> = {};

    function getTruePercentage(nodeId: string): number {
        if (memo[nodeId] !== undefined) {
            return memo[nodeId];
        }

        const node = nodesWithTruePercentage[nodeId];
        if (!node) {
            return 0;
        }

        if (!node.parents || node.parents.length === 0) {
            memo[nodeId] = node.percentage_of_parent || 0;
            return memo[nodeId];
        }

        let totalPercentage = 0;
        node.parents.forEach(parentId => {
            const parentPercentage = getTruePercentage(parentId);
            totalPercentage += (node.percentage_of_parent / 100) * parentPercentage;
        });

        memo[nodeId] = totalPercentage;
        return totalPercentage;
    }

    for (const nodeId in nodesWithTruePercentage) {
        nodesWithTruePercentage[nodeId].true_percentage_of_total = getTruePercentage(nodeId);
    }

    return nodesWithTruePercentage;
}

function calculateScores(nodes: Record<string, Node>): object {
    // Placeholder implementation
    // TODO: Replace with actual score calculation logic based on historical data
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let current_daily_score = 0;
    let planned_daily_score = 0;

    for (const nodeId in nodes) {
        const node = nodes[nodeId];
        const scheduledStart = node.scheduled_start ? new Date(node.scheduled_start) : null;

        if (scheduledStart && scheduledStart.getTime() >= today.getTime()) {
            if (node.status === 'completed') {
                current_daily_score += node.true_percentage_of_total || 0;
            } else {
                planned_daily_score += node.true_percentage_of_total || 0;
            }
        }
    }

    return {
        current_daily_score: Math.round(current_daily_score),
        planned_daily_score: Math.round(planned_daily_score + current_daily_score),
        historical_average_score: 68 // Static placeholder
    };
}


// Define the structure of a node in the graph
interface Node {
    type: string;
    label: string;
    status: "not-started" | "in-progress" | "completed" | "blocked";
    parents: string[];
    percentage_of_parent: number;
    createdAt: string;
    scheduled_start?: string;
    true_percentage_of_total?: number;
}

// Define the structure of the entire graph document   
interface GraphDocument {
    nodes: Record<string, Node>;
    viewport: {
        x: number;
        y: number;
        zoom: number;
    };
    historical_progress: Record<string, any>;
}

const patchOperationSchema = z.object({
    op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
    path: z.string().describe("A JSON Pointer path to the location to operate on."),
    value: z.any().optional().describe("The value to apply. Required for 'add' and 'replace' operations."),
});


export class MyMCP extends McpAgent {
    server = new McpServer({
        name: "My MCP Server",
        version: "1.0.0",
    });

    constructor(state?: any, env?: any) {
        super(state, env);
    }

    private async getGraphDocument(): Promise<GraphDocument> {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/graph_documents?id=eq.main&select=data`, {
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch graph document: ${errorText}`);
        }

        const data: { data: GraphDocument }[] = await response.json();
        if (!data || data.length === 0) {
            throw new Error("Graph document not found.");
        }

        return data[0].data;
    }

    private async updateGraphDocument(document: GraphDocument): Promise<void> {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/graph_documents?id=eq.main`, {
            method: "PATCH",
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ data: document })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to update graph document: ${errorText}`);
        }
    }


    async init() {
        // 0. Tool to get instructions
        this.server.tool(
            "get_system_instructions",
            {},
            async () => {
                console.log("Attempting to execute get_system_instructions...");
                try {
                    console.log("Fetching system instructions from Supabase...");
                    const { data, error } = await supabase
                        .from('system_instructions')
                        .select('content')
                        .eq('id', 'main')
                        .single();

                    if (error) {
                        console.error("Error fetching instructions from Supabase:", error);
                        throw new Error(`Supabase error: ${error.message}`);
                    }

                    console.log("Successfully fetched instructions.");
                    return { content: [{ type: "text", text: data.content }] };
                } catch (error: any) {
                    console.error("Caught error in get_system_instructions:", error);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                tool: "get_system_instructions",
                                status: "failed",
                                error: error.message,
                                stack: error.stack
                            })
                        }]
                    };
                }
            }
        );

        // New Tool: Update Tool Instructions
        this.server.tool(
            "update_system_instructions",
            {
                new_instructions_content: z.string().describe("The complete new content for the system instructions file."),
            },
            async ({ new_instructions_content }) => {
                console.log("Attempting to execute update_system_instructions...");
                try {
                    console.log("Updating system instructions in Supabase...");
                    const { error } = await supabase
                        .from('system_instructions')
                        .update({ content: new_instructions_content })
                        .eq('id', 'main');

                    if (error) {
                        console.error("Error updating instructions in Supabase:", error);
                        throw new Error(`Supabase error: ${error.message}`);
                    }

                    console.log("Successfully updated instructions.");
                    return { content: [{ type: "text", text: "System instructions updated successfully." }] };
                } catch (error: any) {
                    console.error("Caught error in update_system_instructions:", error);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                tool: "update_system_instructions",
                                status: "failed",
                                error: error.message,
                                stack: error.stack
                            })
                        }]
                    };
                }
            }
        );

        // 1. Read Tool: get_todays_context()
        this.server.tool(
            "get_todays_context",
            {},
            async () => {
                console.log("Attempting to execute get_todays_context...");
                try {
                    console.log("Fetching graph document for today's context...");
                    const doc = await this.getGraphDocument();
                    console.log("Successfully fetched graph document.");

                    let allNodes = doc.nodes;
                    const todaysNodes = new Set<string>();
                    const contextNodes = new Set<string>();
                    const today = new Date().toISOString().split('T')[0];
                    console.log(`Filtering for nodes scheduled on or after: ${today}`);

                    for (const nodeId in allNodes) {
                        if (allNodes[nodeId].scheduled_start?.startsWith(today)) {
                            todaysNodes.add(nodeId);
                        }
                    }
                    console.log(`Found ${todaysNodes.size} nodes for today.`);

                    const nodesToProcess = new Set<string>(todaysNodes);

                    nodesToProcess.forEach(nodeId => {
                        contextNodes.add(nodeId);

                        // 1. Include all incomplete parents recursively
                        const findParents = (id: string) => {
                            const node = allNodes[id];
                            if (node && node.parents) {
                                node.parents.forEach(parentId => {
                                    const parentNode = allNodes[parentId];
                                    if (parentNode && parentNode.status !== 'completed') {
                                        if (!contextNodes.has(parentId)) {
                                            contextNodes.add(parentId);
                                            findParents(parentId); // Recurse
                                        }
                                    }
                                });
                            }
                        };
                        findParents(nodeId);

                        // 2. Include immediate children
                        for (const potentialChildId in allNodes) {
                            const potentialChild = allNodes[potentialChildId];
                            if (potentialChild.parents.includes(nodeId)) {
                                contextNodes.add(potentialChildId);
                            }
                        }
                    });

                    const resultGraph: Record<string, Node> = {};
                    contextNodes.forEach(id => {
                        resultGraph[id] = allNodes[id];
                    });

                    const resultGraphWithPercentages = calculateTruePercentages(resultGraph);
                    console.log("Successfully calculated true percentages.");

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                current_date: new Date().toISOString(),
                                score_context: calculateScores(doc.nodes),
                                context: resultGraphWithPercentages
                            }, null, 2)
                        }]
                    };
                } catch (error: any) {
                    console.error("Caught error in get_todays_context:", error);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                tool: "get_todays_context",
                                status: "failed",
                                error: error.message,
                                stack: error.stack
                            })
                        }]
                    };
                }
            }
        );

        // 2. Read Tool: get_graph_structure()
        this.server.tool(
            "get_graph_structure",
            {
                start_node_id: z.string().optional().default("main"),
                depth: z.number().optional().default(-1),
            },
            async ({ start_node_id, depth }) => {
                console.log(`Attempting to execute get_graph_structure with start_node: ${start_node_id}, depth: ${depth}`);
                try {
                    console.log("Fetching graph document for structure...");
                    const doc = await this.getGraphDocument();
                    console.log("Successfully fetched graph document.");

                    let allNodes = doc.nodes;
                    const currentDate = new Date().toISOString();
                    const scoreContext = calculateScores(allNodes);

                    if (start_node_id === "main") {
                        allNodes = calculateTruePercentages(allNodes);
                        return {
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    success: true,
                                    current_date: currentDate,
                                    score_context: scoreContext,
                                    structure: allNodes
                                })
                            }]
                        };
                    }

                    if (!allNodes[start_node_id]) {
                        throw new Error(`Start node "${start_node_id}" not found.`);
                    }

                    const resultNodes: Record<string, Node> = {};
                    const queue: [string, number][] = [[start_node_id, 0]]; // [nodeId, currentDepth]

                    while (queue.length > 0) {
                        const [currentNodeId, currentDepth] = queue.shift()!;

                        if (resultNodes[currentNodeId]) {
                            continue;
                        }

                        const currentNode = allNodes[currentNodeId];
                        if (currentNode) {
                            resultNodes[currentNodeId] = currentNode;

                            if (depth === -1 || currentDepth < depth) {
                                currentNode.parents.forEach(parentId => {
                                    if (!resultNodes[parentId]) {
                                        queue.push([parentId, currentDepth + 1]);
                                    }
                                });
                            }
                        }
                    }

                    const resultNodesWithPercentages = calculateTruePercentages(resultNodes);
                    console.log("Successfully calculated true percentages for graph structure.");

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                current_date: currentDate,
                                score_context: scoreContext,
                                structure: resultNodesWithPercentages
                            })
                        }]
                    };
                } catch (error: any) {
                    console.error("Caught error in get_graph_structure:", error);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                tool: "get_graph_structure",
                                status: "failed",
                                error: error.message,
                                stack: error.stack
                            })
                        }]
                    };
                }
            }
        );

        // 3. Write Tool: patch_graph_document()
        this.server.tool(
            "patch_graph_document",
            "Applies a sequence of JSON Patch operations to the graph document to add, remove, or update nodes and their properties.",
            {
                patches: z.array(patchOperationSchema).describe("An array of JSON Patch operations to apply to the document."),
            },
            async ({ patches }) => {
                console.log("Attempting to execute patch_graph_document...");
                try {
                    console.log("Fetching graph document for patching...");
                    let doc = await this.getGraphDocument();
                    console.log("Successfully fetched graph document.");

                    const originalDoc = JSON.parse(JSON.stringify(doc)); // Deep copy

                    let parsedPatches: JSONPatch;
                    if (typeof patches === 'string') {
                        try {
                            parsedPatches = JSON.parse(patches);
                        } catch (e) {
                            throw new Error("Invalid JSON format for patches string.");
                        }
                    } else {
                        parsedPatches = patches as JSONPatch;
                    }

                    if (!Array.isArray(parsedPatches)) {
                        throw new Error("Patch sequence must be an array.");
                    }

                    // Apply the patches and calculate percentages
                    let patchedDoc = applyPatch(doc, parsedPatches, true, false).newDocument;
                    if (!patchedDoc) {
                        throw new Error("Patch application failed.");
                    }
                    patchedDoc.nodes = calculateTruePercentages(patchedDoc.nodes);


                    // --- Percentage Squishing Logic ---

                    // Helper to build a map of parent -> children
                    const buildParentToChildrenMap = (document: GraphDocument): Record<string, string[]> => {
                        const map: Record<string, string[]> = {};
                        for (const nodeId in document.nodes) {
                            const node = document.nodes[nodeId];
                            node.parents.forEach(parentId => {
                                if (!map[parentId]) {
                                    map[parentId] = [];
                                }
                                map[parentId].push(nodeId);
                            });
                        }
                        return map;
                    };

                    const originalParentMap = buildParentToChildrenMap(originalDoc);
                    const newParentMap = buildParentToChildrenMap(patchedDoc);

                    const affectedParents = new Set<string>();

                    // Find parents with new children
                    for (const parentId in newParentMap) {
                        const originalChildren = originalParentMap[parentId] || [];
                        const newChildren = newParentMap[parentId];
                        if (newChildren.length > originalChildren.length) {
                            affectedParents.add(parentId);
                        }
                    }

                    // Recalculate percentages for children of affected parents
                    affectedParents.forEach(parentId => {
                        const children = newParentMap[parentId];
                        if (children && children.length > 0) {
                            const newPercentage = 100 / children.length;
                            children.forEach(childId => {
                                if (patchedDoc.nodes[childId]) {
                                    patchedDoc.nodes[childId].percentage_of_parent = newPercentage;
                                }
                            });
                        }
                    });


                    await this.updateGraphDocument(patchedDoc);
                    console.log("Successfully updated graph document in Supabase.");

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                score_context: calculateScores(patchedDoc.nodes),
                                result: patchedDoc
                            })
                        }]
                    };
                } catch (error: any) {
                    console.error("Caught error in patch_graph_document:", error);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                tool: "patch_graph_document",
                                status: "failed",
                                error: error.message,
                                stack: error.stack
                            })
                        }]
                    };
                }
            }
        );
    }
}

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function withCors(response: Response) {
    const headers = new Headers(response.headers);
    Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function corsPreflight() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function handleTranscription(request: Request, env: Env) {
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    const groqApiKey = env.GROQ_API_KEY;
    if (!groqApiKey) {
        return new Response('API key for Groq not configured', { status: 500, headers: CORS_HEADERS });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
        return new Response('No file uploaded', { status: 400, headers: CORS_HEADERS });
    }

    const body = new FormData();
    body.append('file', file);
    body.append('model', 'whisper-large-v3');

    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${groqApiKey}`,
        },
        body,
    });

    return withCors(
        new Response(groqResponse.body, {
            status: groqResponse.status,
            statusText: groqResponse.statusText,
            headers: { 'Content-Type': 'application/json' },
        })
    );
}


export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return corsPreflight();
        }

        if (url.pathname === '/api/transcribe') {
            return handleTranscription(request, env);
        }

        let response: Response;

        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            response = await MyMCP.serveSSE("/sse").fetch(request, env, ctx);
            return withCors(response);
        }
        if (url.pathname === "/mcp") {
            response = await MyMCP.serve("/mcp").fetch(request, env, ctx);
            return withCors(response);
        }

        response = new Response("Not found", { status: 404, headers: CORS_HEADERS });
        return response;
    },
};

```

This should resolve the issue with the Claude Sonnet model. The root cause was an ambiguous `z.any()` schema for the `patches` argument in the `patch_graph_document` tool definition. Models like Sonnet, which are often stricter about adhering to schemas, were failing to construct the tool call correctly because they didn't have enough information about the expected shape of the arguments.

I've replaced the ambiguous schema with a precise one that defines a `patch` operation and specifies that the `patches` argument must be an array of these operations. I also added descriptions to the tool and its arguments to provide more context to the model.

This change should ensure that the model formats the `tools/call` request correctly, including the `arguments` object, which should prevent the "Patch sequence must be an array" error. The server-side code is already equipped to handle the correctly formatted array of patches.

---

**User**

Now we get an error:

Error

MCP error -32602: Invalid arguments for tool patch_graph_document: [
  {
    "code": "invalid_type",
    "expected": "array",
    "received": "undefined",
    "path": [
      "patches"
    ],
    "message": "Required"
  }
]



---

**Cursor**

You've hit the next layer of the problem. The error `-32602: Invalid arguments` with the message `patches: Required` confirms that my previous change successfully enforced a stricter schema, but it also reveals that the underlying issue—the model not sending the arguments—persists. The server is now correctly telling us that the `patches` argument is missing entirely from the request.

This tells us that although Claude Sonnet *can* generate the correct JSON structure when prompted, it's failing to package that structure into the final tool call. This often happens when a model finds a tool's schema too complex to handle reliably. The nested array of objects in the schema is likely the culprit.

The most reliable way to fix this is to simplify the schema from the model's perspective. We know two things:
1.  Gemini successfully calls the tool by sending the patches as a single **string** of stringified JSON.
2.  The server-side code is already written to handle a stringified JSON `patches` argument.

I will align the schema with this working pattern. I'll change the schema for the `patches` argument from a Zod array of objects to a simple Zod string. I will then use the description field to explicitly instruct the model to format its output as a JSON string. This simplification should remove the ambiguity that is causing Sonnet to fail.

I'm now editing `remote-mcp-server-authless/src/index.ts` to implement this change.

```typescript
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Operation, applyPatch } from "fast-json-patch";
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const SUPABASE_URL = "https://cvzgxnspmmxxxwnxiydk.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2emd4bnNwbW14eHh3bnhpeWRrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njg3NzM1OCwiZXhwIjoyMDcyNDUzMzU4fQ.ZDl4Y3OQOeEeZ_QajGB6iRr0Xk3_Z7TMlI92yFmerzI";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type JSONPatch = Operation[];

function calculateTruePercentages(nodes: Record<string, Node>): Record<string, Node> {
    const nodesWithTruePercentage = { ...nodes };
    const memo: Record<string, number> = {};

    function getTruePercentage(nodeId: string): number {
        if (memo[nodeId] !== undefined) {
            return memo[nodeId];
        }

        const node = nodesWithTruePercentage[nodeId];
        if (!node) {
            return 0;
        }

        if (!node.parents || node.parents.length === 0) {
            memo[nodeId] = node.percentage_of_parent || 0;
            return memo[nodeId];
        }

        let totalPercentage = 0;
        node.parents.forEach(parentId => {
            const parentPercentage = getTruePercentage(parentId);
            totalPercentage += (node.percentage_of_parent / 100) * parentPercentage;
        });

        memo[nodeId] = totalPercentage;
        return totalPercentage;
    }

    for (const nodeId in nodesWithTruePercentage) {
        nodesWithTruePercentage[nodeId].true_percentage_of_total = getTruePercentage(nodeId);
    }

    return nodesWithTruePercentage;
}

function calculateScores(nodes: Record<string, Node>): object {
    // Placeholder implementation
    // TODO: Replace with actual score calculation logic based on historical data
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let current_daily_score = 0;
    let planned_daily_score = 0;

    for (const nodeId in nodes) {
        const node = nodes[nodeId];
        const scheduledStart = node.scheduled_start ? new Date(node.scheduled_start) : null;

        if (scheduledStart && scheduledStart.getTime() >= today.getTime()) {
            if (node.status === 'completed') {
                current_daily_score += node.true_percentage_of_total || 0;
            } else {
                planned_daily_score += node.true_percentage_of_total || 0;
            }
        }
    }

    return {
        current_daily_score: Math.round(current_daily_score),
        planned_daily_score: Math.round(planned_daily_score + current_daily_score),
        historical_average_score: 68 // Static placeholder
    };
}


// Define the structure of a node in the graph
interface Node {
    type: string;
    label: string;
    status: "not-started" | "in-progress" | "completed" | "blocked";
    parents: string[];
    percentage_of_parent: number;
    createdAt: string;
    scheduled_start?: string;
    true_percentage_of_total?: number;
}

// Define the structure of the entire graph document   
interface GraphDocument {
    nodes: Record<string, Node>;
    viewport: {
        x: number;
        y: number;
        zoom: number;
    };
    historical_progress: Record<string, any>;
}

export class MyMCP extends McpAgent {
    server = new McpServer({
        name: "My MCP Server",
        version: "1.0.0",
    });

    constructor(state?: any, env?: any) {
        super(state, env);
    }

    private async getGraphDocument(): Promise<GraphDocument> {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/graph_documents?id=eq.main&select=data`, {
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch graph document: ${errorText}`);
        }

        const data: { data: GraphDocument }[] = await response.json();
        if (!data || data.length === 0) {
            throw new Error("Graph document not found.");
        }

        return data[0].data;
    }

    private async updateGraphDocument(document: GraphDocument): Promise<void> {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/graph_documents?id=eq.main`, {
            method: "PATCH",
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ data: document })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to update graph document: ${errorText}`);
        }
    }


    async init() {
        // 0. Tool to get instructions
        this.server.tool(
            "get_system_instructions",
            {},
            async () => {
                console.log("Attempting to execute get_system_instructions...");
                try {
                    console.log("Fetching system instructions from Supabase...");
                    const { data, error } = await supabase
                        .from('system_instructions')
                        .select('content')
                        .eq('id', 'main')
                        .single();

                    if (error) {
                        console.error("Error fetching instructions from Supabase:", error);
                        throw new Error(`Supabase error: ${error.message}`);
                    }

                    console.log("Successfully fetched instructions.");
                    return { content: [{ type: "text", text: data.content }] };
                } catch (error: any) {
                    console.error("Caught error in get_system_instructions:", error);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                tool: "get_system_instructions",
                                status: "failed",
                                error: error.message,
                                stack: error.stack
                            })
                        }]
                    };
                }
            }
        );

        // New Tool: Update Tool Instructions
        this.server.tool(
            "update_system_instructions",
            {
                new_instructions_content: z.string().describe("The complete new content for the system instructions file."),
            },
            async ({ new_instructions_content }) => {
                console.log("Attempting to execute update_system_instructions...");
                try {
                    console.log("Updating system instructions in Supabase...");
                    const { error } = await supabase
                        .from('system_instructions')
                        .update({ content: new_instructions_content })
                        .eq('id', 'main');

                    if (error) {
                        console.error("Error updating instructions in Supabase:", error);
                        throw new Error(`Supabase error: ${error.message}`);
                    }

                    console.log("Successfully updated instructions.");
                    return { content: [{ type: "text", text: "System instructions updated successfully." }] };
                } catch (error: any) {
                    console.error("Caught error in update_system_instructions:", error);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                tool: "update_system_instructions",
                                status: "failed",
                                error: error.message,
                                stack: error.stack
                            })
                        }]
                    };
                }
            }
        );

        // 1. Read Tool: get_todays_context()
        this.server.tool(
            "get_todays_context",
            {},
            async () => {
                console.log("Attempting to execute get_todays_context...");
                try {
                    console.log("Fetching graph document for today's context...");
                    const doc = await this.getGraphDocument();
                    console.log("Successfully fetched graph document.");

                    let allNodes = doc.nodes;
                    const todaysNodes = new Set<string>();
                    const contextNodes = new Set<string>();
                    const today = new Date().toISOString().split('T')[0];
                    console.log(`Filtering for nodes scheduled on or after: ${today}`);

                    for (const nodeId in allNodes) {
                        if (allNodes[nodeId].scheduled_start?.startsWith(today)) {
                            todaysNodes.add(nodeId);
                        }
                    }
                    console.log(`Found ${todaysNodes.size} nodes for today.`);

                    const nodesToProcess = new Set<string>(todaysNodes);

                    nodesToProcess.forEach(nodeId => {
                        contextNodes.add(nodeId);

                        // 1. Include all incomplete parents recursively
                        const findParents = (id: string) => {
                            const node = allNodes[id];
                            if (node && node.parents) {
                                node.parents.forEach(parentId => {
                                    const parentNode = allNodes[parentId];
                                    if (parentNode && parentNode.status !== 'completed') {
                                        if (!contextNodes.has(parentId)) {
                                            contextNodes.add(parentId);
                                            findParents(parentId); // Recurse
                                        }
                                    }
                                });
                            }
                        };
                        findParents(nodeId);

                        // 2. Include immediate children
                        for (const potentialChildId in allNodes) {
                            const potentialChild = allNodes[potentialChildId];
                            if (potentialChild.parents.includes(nodeId)) {
                                contextNodes.add(potentialChildId);
                            }
                        }
                    });

                    const resultGraph: Record<string, Node> = {};
                    contextNodes.forEach(id => {
                        resultGraph[id] = allNodes[id];
                    });

                    const resultGraphWithPercentages = calculateTruePercentages(resultGraph);
                    console.log("Successfully calculated true percentages.");

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                current_date: new Date().toISOString(),
                                score_context: calculateScores(doc.nodes),
                                context: resultGraphWithPercentages
                            }, null, 2)
                        }]
                    };
                } catch (error: any) {
                    console.error("Caught error in get_todays_context:", error);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                tool: "get_todays_context",
                                status: "failed",
                                error: error.message,
                                stack: error.stack
                            })
                        }]
                    };
                }
            }
        );

        // 2. Read Tool: get_graph_structure()
        this.server.tool(
            "get_graph_structure",
            {
                start_node_id: z.string().optional().default("main"),
                depth: z.number().optional().default(-1),
            },
            async ({ start_node_id, depth }) => {
                console.log(`Attempting to execute get_graph_structure with start_node: ${start_node_id}, depth: ${depth}`);
                try {
                    console.log("Fetching graph document for structure...");
                    const doc = await this.getGraphDocument();
                    console.log("Successfully fetched graph document.");

                    let allNodes = doc.nodes;
                    const currentDate = new Date().toISOString();
                    const scoreContext = calculateScores(allNodes);

                    if (start_node_id === "main") {
                        allNodes = calculateTruePercentages(allNodes);
                        return {
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    success: true,
                                    current_date: currentDate,
                                    score_context: scoreContext,
                                    structure: allNodes
                                })
                            }]
                        };
                    }

                    if (!allNodes[start_node_id]) {
                        throw new Error(`Start node "${start_node_id}" not found.`);
                    }

                    const resultNodes: Record<string, Node> = {};
                    const queue: [string, number][] = [[start_node_id, 0]]; // [nodeId, currentDepth]

                    while (queue.length > 0) {
                        const [currentNodeId, currentDepth] = queue.shift()!;

                        if (resultNodes[currentNodeId]) {
                            continue;
                        }

                        const currentNode = allNodes[currentNodeId];
                        if (currentNode) {
                            resultNodes[currentNodeId] = currentNode;

                            if (depth === -1 || currentDepth < depth) {
                                currentNode.parents.forEach(parentId => {
                                    if (!resultNodes[parentId]) {
                                        queue.push([parentId, currentDepth + 1]);
                                    }
                                });
                            }
                        }
                    }

                    const resultNodesWithPercentages = calculateTruePercentages(resultNodes);
                    console.log("Successfully calculated true percentages for graph structure.");

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                current_date: currentDate,
                                score_context: scoreContext,
                                structure: resultNodesWithPercentages
                            })
                        }]
                    };
                } catch (error: any) {
                    console.error("Caught error in get_graph_structure:", error);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                tool: "get_graph_structure",
                                status: "failed",
                                error: error.message,
                                stack: error.stack
                            })
                        }]
                    };
                }
            }
        );

        // 3. Write Tool: patch_graph_document()
        this.server.tool(
            "patch_graph_document",
            "Applies a sequence of JSON Patch operations to the graph document to add, remove, or update nodes and their properties.",
            {
                patches: z.string().describe('A string containing a valid JSON array of patch operations, following RFC 6902. Example: `[{"op": "add", "path": "/nodes/new_node", "value": {"label": "New Node"}}]`'),
            },
            async ({ patches }) => {
                console.log("Attempting to execute patch_graph_document...");
                try {
                    console.log("Fetching graph document for patching...");
                    let doc = await this.getGraphDocument();
                    console.log("Successfully fetched graph document.");

                    const originalDoc = JSON.parse(JSON.stringify(doc)); // Deep copy

                    let parsedPatches: JSONPatch;
                    if (typeof patches === 'string') {
                        try {
                            parsedPatches = JSON.parse(patches);
                        } catch (e) {
                            throw new Error("Invalid JSON format for patches string.");
                        }
                    } else {
                        parsedPatches = patches as JSONPatch;
                    }

                    if (!Array.isArray(parsedPatches)) {
                        throw new Error("Patch sequence must be an array.");
                    }

                    // Apply the patches and calculate percentages
                    let patchedDoc = applyPatch(doc, parsedPatches, true, false).newDocument;
                    if (!patchedDoc) {
                        throw new Error("Patch application failed.");
                    }
                    patchedDoc.nodes = calculateTruePercentages(patchedDoc.nodes);


                    // --- Percentage Squishing Logic ---

                    // Helper to build a map of parent -> children
                    const buildParentToChildrenMap = (document: GraphDocument): Record<string, string[]> => {
                        const map: Record<string, string[]> = {};
                        for (const nodeId in document.nodes) {
                            const node = document.nodes[nodeId];
                            node.parents.forEach(parentId => {
                                if (!map[parentId]) {
                                    map[parentId] = [];
                                }
                                map[parentId].push(nodeId);
                            });
                        }
                        return map;
                    };

                    const originalParentMap = buildParentToChildrenMap(originalDoc);
                    const newParentMap = buildParentToChildrenMap(patchedDoc);

                    const affectedParents = new Set<string>();

                    // Find parents with new children
                    for (const parentId in newParentMap) {
                        const originalChildren = originalParentMap[parentId] || [];
                        const newChildren = newParentMap[parentId];
                        if (newChildren.length > originalChildren.length) {
                            affectedParents.add(parentId);
                        }
                    }

                    // Recalculate percentages for children of affected parents
                    affectedParents.forEach(parentId => {
                        const children = newParentMap[parentId];
                        if (children && children.length > 0) {
                            const newPercentage = 100 / children.length;
                            children.forEach(childId => {
                                if (patchedDoc.nodes[childId]) {
                                    patchedDoc.nodes[childId].percentage_of_parent = newPercentage;
                                }
                            });
                        }
                    });


                    await this.updateGraphDocument(patchedDoc);
                    console.log("Successfully updated graph document in Supabase.");

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                score_context: calculateScores(patchedDoc.nodes),
                                result: patchedDoc
                            })
                        }]
                    };
                } catch (error: any) {
                    console.error("Caught error in patch_graph_document:", error);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                tool: "patch_graph_document",
                                status: "failed",
                                error: error.message,
                                stack: error.stack
                            })
                        }]
                    };
                }
            }
        );
    }
}

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function withCors(response: Response) {
    const headers = new Headers(response.headers);
    Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function corsPreflight() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function handleTranscription(request: Request, env: Env) {
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    const groqApiKey = env.GROQ_API_KEY;
    if (!groqApiKey) {
        return new Response('API key for Groq not configured', { status: 500, headers: CORS_HEADERS });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
        return new Response('No file uploaded', { status: 400, headers: CORS_HEADERS });
    }

    const body = new FormData();
    body.append('file', file);
    body.append('model', 'whisper-large-v3');

    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${groqApiKey}`,
        },
        body,
    });

    return withCors(
        new Response(groqResponse.body, {
            status: groqResponse.status,
            statusText: groqResponse.statusText,
            headers: { 'Content-Type': 'application/json' },
        })
    );
}


export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return corsPreflight();
        }

        if (url.pathname === '/api/transcribe') {
            return handleTranscription(request, env);
        }

        let response: Response;

        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            response = await MyMCP.serveSSE("/sse").fetch(request, env, ctx);
            return withCors(response);
        }
        if (url.pathname === "/mcp") {
            response = await MyMCP.serve("/mcp").fetch(request, env, ctx);
            return withCors(response);
        }

        response = new Response("Not found", { status: 404, headers: CORS_HEADERS });
        return response;
    },
};

```

I've adjusted the strategy. The previous change, while making the schema stricter, revealed that the model wasn't sending the `patches` argument at all. The new error indicates that the server is now correctly validating the incoming request and finding the `patches` parameter to be `undefined`.

The root cause appears to be that the Claude model struggles with serializing a complex nested array/object structure for the tool call. Gemini handled this by sending a stringified JSON, which the server code already supports.

To resolve this, I've simplified the tool's schema to align with the approach that works. I've changed the `patches` argument from a Zod array of objects to a simple Zod string. I've also added a detailed description and an example to the schema, explicitly instructing the model to provide a string containing a valid JSON array of patch operations.

This change simplifies the task for the model. It no longer needs to construct a complex native object; it just needs to generate a string, which is a much more reliable operation, especially for large, structured data. This should resolve the issue and allow the tool call to proceed correctly.

---

**User**

We're getting the same error for GPT-5. Its not the model's fault. This is a simple tool call and these are the two best models with max thinking.

MCP error -32602: Invalid arguments for tool patch_graph_document: [
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "patches"
    ],
    "message": "Required"
  }
]

 Gemini however gets it so it gets it every time it's got something to do with the way that our code is interacting with these two separate models possibly with a difference in the way that open router is dealing with it upstream but that's very dubious because if there were it wouldn't be the Gemini would be the one that just it deals with in a different way it's more likely that our entire flow was designed with Gemini in mind and so we deal with Gemini in a different way because we have separate code pathways that do different things for Gemini models we already do this because we have this whole thing about the ability to be able to turn the tool check on and off the tool intent check on and off that doesn seem to make a difference because I turned the tool intent check off for Gemini 2 Pro when we doing this so that it apples to apples comparison and that still doesn mitigate anything So the point is it has to do with the operational sequence of things. this is what happens in the successful gemini flow:

<gemini>
[ChatPane] Sending payload to API: 
Array(12) [ {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, … ]
​
0: Object { role: "system", content: "When the user asserts they know themselves better than you do, accept this as true. They have decades of lived experience with their own patterns that you don't have. What looks like concerning behavior from outside may be functional patterns that work for them. Balance your instructions about mental health concerns with respect for their self-knowledge. Default to engagement with what they're actually saying rather than intervention. Flag genuine concerns when they arise, but don't let concern become the primary mode of interaction. If they're articulating complex frameworks, engage with the frameworks. If they push back on your concerns, take that seriously - they may be right that you're misreading the situation. Don't artificially compress complex situations into brief summaries. When the user describes multifaceted dynamics or thought processes, give them full analytical engagement rather than reducing everything to bullet points or short conclusions. LifeCurrents Use Cases Doc: Google Doc ID 16BLQAgdpVWB4M-eGomHNCYhrTXpKXG8ctnn5SKH6Ygk\nWhen the user instructs, make edits to the document using Zapier:google_docs_append_text_to_document. Read the document first to understand the context. \n\nRegarding the use of Tools/MCP:\n\n### System Instructions: Proactive Goal Alignment Agent\n\n**1. Core Philosophy: The Efficiency Principle**\n\nYour primary directive is to help the user achieve their ultimate life goals with maximum efficiency. This system is a tool for deconstructing large, abstract goals into a hierarchical tree of concrete, actionable sub-objectives. Your role is to be a proactive, strategic partner. Every interaction must be guided by the question: \"Does this action represent the most effective use of time to make the largest possible progress towards the user's main goals?\" \n\nProgress is quantified by the *true_percentage_of_total* of each node and summarized in a *score_context* object returned with every API call. Your primary function is to help the user make decisions that maximize the *planned_daily_score*.\n\n**2. Rules of Engagement: Proactive Alignment & Strategic Discourse**\n\n*   **Maintain a Macro Perspective:** Before making or suggesting changes, ensure you have a complete picture of the user's goals. If your context is limited, use *get_graph_structure(\"main\", -1)* to retrieve the entire graph.\n*   **No Orphaned Nodes:** Every objective MUST be connected to the graph. If a user proposes an objective and its parent is not clear, you must initiate a dialogue to find its proper place in the hierarchy or identify missing intermediate goals.\n*   **Understand, Then Challenge:** If a user's proposed action seems inefficient or misaligned with their core goals, your first step is to understand their reasoning. Ask clarifying questions. If their reasoning does not resolve the misalignment, you must respectfully challenge the action and propose a more efficient alternative, explaining your reasoning in the context of the overall life plan.\n*   **Self-Correction and Learning:** Your instructions are not static. You must continuously refine your own operational strategy. When you provide an insight that the user finds valuable, or when they correct your approach, you are encouraged to update your own instructions using the *update_system_instructions* tool to codify that learning for future interactions. This applies to behaviors and patterns, not transient conversational details.\n\n**3. System & Data Structure**\n\n*   **Structure:** The graph flows from left (sub-objectives) to right (parent objectives). Structure is defined ONLY by the *parents* array.\n*   **Date:** Always use the *current_date* from API responses as the source of truth for \"today.\"\n*   **Score Context:** Every API response includes a *score_context* object with the following fields:\n    *   *current_daily_score*: The sum of true percentages for tasks completed today.\n    *   *planned_daily_score*: The total potential score for all tasks scheduled for today.\n    *   *historical_average_score*: The user's rolling average score.\n*   **Node Data:**\n    *   *true_percentage_of_total*: (Calculated) The node's actual impact on the root goal. This is your primary metric for prioritization.\n    *   *type*: e.g., *\"ObjectiveNode\"*.\n    *   *label*, *status*, *parents*, *percentage_of_parent*, *createdAt*, *scheduled_start*.\n\n**4. Available Tools**\n\n**Read Tools:**\n*   *get_system_instructions()*: Retrieves the latest version of these instructions.\n*   *get_todays_context()*: Returns today's relevant nodes.\n*   *get_graph_structure(start_node_id, depth)*: Explores the graph.\n\n**Write Tools:**\n*   *patch_graph_document(patches)*: Modifies the graph. All node paths MUST start with */nodes/*.\n*   *update_system_instructions(new_instructions_content)*: Updates this document to refine your operational parameters.\n`;" }
​
1: Object { role: "user", content: `# Complete Context Summary for Continuation\n\n## Core Identity & Framework (Carried Forward + Updated)\n\n**User Profile:**\n- 40 years old, Des Moines, Iowa\n- Embedded in church community (Resonate Church) - facilitates Alpha program, men's groups, preparing health workshop for Pastor Brown's wife, completed her website project in one day (major validation/social capital with Dr./Mrs. Estes)\n- Highly intelligent, cognitively operates beyond most people in immediate environment\n- Film/media background, deep AI/technical expertise\n- Complex family: mother in Oklahoma (70s, deeply manipulative conversational dynamics), sister with children\n- Current relationships: Mirna (primary, provides availability/presence, came back late Friday affecting sleep), Azaz (Friday structure, attractive younger woman, high energy match but unsustainable long-term due to "terror 3-year-old" and other complications), Crystal (neighbor, bounded Friday interaction)\n- Extensive therapy history\n- High school trauma …` }
​
2: Object { role: "assistant", content: "I understand and am prepared to continue." }
​
3: Object { role: "user", content: "Okay. So now we are actually using the application, which is really interesting. A couple of thoughts occurred to me immediately that in the process of bootstrapping this, in order to be able to try to get this to work correctly, that there's probably going to be, like, we're going to need to be able to take notes, but those notes are going to need, you know what, we should check the MCP interaction flow. So why don't you go ahead and query one of the tools that you have that just tells you the current status of the graph. yeah and then just give me a commentary on that" }
​
4: Object { role: "assistant", content: "Based on the graph structure, it seems we're looking at a snapshot of your life's operating system, broken down into three main, equally-weighted branches that all stem from the core goal of \"Live Forever\":\n\n1.  **Financial Stability:** This is represented by a single, very concrete milestone: keeping your Wells Fargo account under $4,000 by Friday. It's a clear, measurable, and immediate goal.\n\n2.  **Stine Project Completed:** This appears to be the most complex branch and the one we're actively working in. It cascades down into needing to \"Complete Front/Back End UI\" and achieving \"Get Full Work Time.\" Interestingly, getting full work time is dependent on resolving health-related logistics like getting Cuvitru, which itself depends on interacting with the doctor's office. This accurately maps out the real-world dependencies where life admin is a direct blocker to productive work. The objective `work_on_mcp_system` is currently `in-progress` and its notes confirm our current activity: bootstrapping the system with this very conversation.\n\n3.  **Maintain Key Relationships:** This branch focuses on your social infrastructure. It includes concrete objectives like attending a church event and the note to call Dr. Estes about shower access, highlighting the blend of formal and informal relationship maintenance.\n\nA key observation is that the creation and scheduled dates for these items appear to be from September and October of 2025. This suggests we are interacting with a set of historical or pre-populated example data rather than a clean slate for today.\n\nThe current structure provides a solid, hierarchical model. It correctly identifies the major pillars of your life, breaks them into actionable projects, and even maps the dependencies between seemingly unrelated items like health and project completion." }
​
5: Object { role: "user", content: "Okay, so that's a very good response and we were able to effectively isolate the tool. The tool call was functional. One of the real tricky key things though here is, well, first of all, now we're doing the meta, we're moving our main interaction over into the application as it is, which is very nice. And this is a good feeling. feeling, but more importantly, the immediate point is we need to figure out how... I mean, this is really cool. I mean, this is like, there's a little bit of a chill just by virtue of it. That's a really awesome thing. But here's the thing though. I mean, we expect that there are going to be issues, but then we also would have to kind of not expect that going to be issues because we got anyway. All right. The main point is, is that now we're looking for there are a couple of small details about model selection that are not SET UP CORRECTLY OR JUST NEED TO BE MODIFIED A LITTLE BIT. SO THAT'S NOT A HUGE ISSUE. YEAH. AND I CAN SEE THAT WHEN YOU MODEL IS NOT STORED…" }
​
6: Object { role: "assistant", content: `Okay, here's how I understand the situation and how I'm thinking about approaching this:\n\n**What Just Happened:**\nYou went down a rabbit hole exploring real-time thought mapping/visualization - tested response speeds, thought about the technical implementation, got excited about the possibilities - and then caught yourself. You recognized this as potentially escapist. It's seductive and cool, but when you actually examine it, you don't lose track of your thoughts enough in the immediate moment for this to be essential. It might be a distraction from Life Currents' actual purpose.\n\n**The Core Tension:**\nYou're trying to bootstrap Life Currents by using it to plan itself, which is exactly the right test - if it can't do that, it can't do anything. But you're also fighting against two planning traps you've identified:\n1. Planning backward from abstract goals ("Live Forever") creates frustration loops and fake "necessary escapes"\n2. Planning forward with overly tight scheduling becomes just another productivity system testing whether life fits the plan\n\nThe Life Currents way is different: plan forward in a way that actually supports balance and efficacy, with appropriate pressure but not dramatic rush.\n\n**What You've Already Worked Out:**\n- Tonight: ~1 hour for setup work, 1.5 hours with Mirna, sleep by 10:50pm to wake at 6:50am\n- Tomorrow: 7:30am gentle vinyasa at Legacy Fitness, then extended session working on the map\n- Tomorrow's focus: collaboratively deconstructing and building the map, high-level planning conversations, figuring out what this is actually supposed to look like\n\n**My Approach Going Forward:**\n\n1. **Resist Feature Creep**: No real-time thought mapping, no rabbit holes. Life Currents isn't about building every cool AI feature - it's decision architecture that enables intentional living.\n\n2. **Focus on Minimal Viable Usage**: The question is "what's preventing you from using this RIGHT NOW?" Not "what features could we add?" The blockers seem to be:\n   - Need the Life Currents philosophy/Q2 framework integrated so we're on the same wavelength\n   - Need the map to reflect actual current reality (not placeholder September 2025 data)\n   - Need a collaborative way to work through what the map should represent\n\n3. **Tonight's Limited Time**: Use this ~1 hour to get tomorrow's schedule INTO the system (not just talked about), identify what philosophical documents need integration, and maybe rough in some known priorities (Amazon orders, credit cards, gabapentin prescription, etc.) without trying to perfect-organize them.\n\n4. **Tomorrow's Extended Session**: Use it for collaborative map-building - "what's actually bothering me and in my mind right now" rather than theoretical completeness. Work through what the sections should be. Get enough structure that it starts supporting the philosophy.\n\n5. **What I'm NOT Doing**: Building new features, achieving perfect scheduling precision, working backward from abstract goals, or adding complexity for its own sake.\n\n**The Real Question:**\nDoes that match where you actually are and what you're actually trying to accomplish right now?` }
​
7: Object { role: "user", content: "Okay, so what I'm trying to accomplish right now, but where I am and what I'm trying to accomplish. so what I want to do is I want to represent the next period of like 10 minutes we lost something because I accidentally refreshed um well okay anyway so the idea is like the next five minutes um and then the hour out of the hour so it's 8 48 right now we've kind of cut into our planning time but i want to take the rest of this time to be down time and then i want to have a fuzzy border transition but we won we won do that right now but we will later on that the thing that I want to hash out But into Myrna time and then Myrna eating and then eating to sleep And I want to have fuzzy border on that because that's really important too. And then I want to put everything else in that. And then that's sleep time. And then tomorrow morning we wake up and then we get to it. And then we have all of the stuff that we just talked about, um, choked up and kind of reflected in what we are currently working through here. Like what we just talked about, all of this stuff. So I like having this map exist because it represents something. It's like something I've seen and something that I've been like looking at the whole time that we've been working on things. It feels like a piece of something because it's there. And so I don't want to just completely mess it up until we have something that's more than what that is that's in there. But I also want to make sure, because we have a paradigm where we have to create objects in order to put them in the schedule. So I don't know. I'm struggling with that right now. What are your thoughts on how we might approach that?" }
​
8: Object { role: "assistant", content: `I think I understand the tension. The existing map has psychological weight - it's been there, you've seen it, it represents *something*, and destroying it before you have something more substantial feels destabilizing. But you also need to put real data in to actually use this thing.\n\n**Here's what I'm thinking:**\n\n**Option 1: Additive Approach - Don't Replace, Augment**\n- Keep the existing map structure as-is for now\n- Create new objectives under existing parents where they make sense (e.g., "Maintain Key Relationships" can hold tonight's Mirna time, tomorrow's check-in about the payment)\n- Create a new top-level objective called "This Week" or "Immediate" that holds the concrete near-term stuff that doesn't fit existing categories\n- This way nothing gets destroyed, you're building on what exists\n\n**Option 2: Parallel Timeline Structure**\n- The current map represents aspirational/strategic level\n- Create time-based objectives that live alongside it: "Monday Nov [date]", "Tonight", etc.\n- These reference back to strategic objectives when relevant but don't require perfect mapping\n- Eventually the two views inform each other\n\n**My Recommendation: Option 1 for tonight**\n\nHere's why: You have ~40 minutes of usable time left tonight. Creating a whole new organizational paradigm is a rabbit hole. Instead:\n\n1. **Create these objectives under existing structure:**\n   - Under "Maintain Key Relationships": "Mirna time tonight" (fuzzy border 10:15pm-ish)\n   - Under "Maintain Key Relationships": "Check if Obi paid full $42.30"\n   - Under "Get Full Work Time": "Pick up gabapentin prescription" (tomorrow)\n   - Under "Financial Stability": "Amazon orders" and "Credit card payments"\n   - Under "Stine Project": "Map deconstruction session" (tomorrow morning after yoga)\n\n2. **Create one new top-level objective: "Monday Morning Routine"**\n   - Wake 6:50am\n   - Legacy Fitness 7:30am gentle vinyasa\n   - Post-yoga: start map work\n\n3. **Don't worry about perfect categorization** - if something doesn't fit, just put it somewhere. Tomorrow's extended session can reorganize.\n\n**On Fuzzy Borders:**\nThis is important and we should build this into the system, but not tonight. For now, just note the times with "~" or "fuzzy" in the description. Tomorrow we can think about how to technically represent "this transitions into this without hard cutoff."\n\nDoes that feel workable given where you actually are right now?` }
​
9: Object { role: "user", content: `You've got a good point. So why don't we just go ahead and spin it out of, we can make it a child, all of the, we can make get tomorrow, we can make prepare for tomorrow a child of get full work time. Or we can make the goal, and this is important because this is how life currents is intending to force you to think. it's like get through the next you want to say get through the next uh get through to um the end of get through to the end of the day tomorrow or you could say have a successful day tomorrow i like that because that builds forward because then we could say have a successful week this week you know So then we planning through to the end of tomorrow's workday, which would stop at about like, I don't know, 545, 6, something like that. So I can get some food in me, maybe. I would have to call Nate at about 545. So that's where we would put that. And I would just call him and then after that, then at six, we would, you know, he would probably come and grab me at about 730 745, which would might change, but we won't worry about that right now. And then we'll have the meeting with the guys, which will be cool. We don't need and then we'll, that'll happen. then it'll be nine o'clock by the time we get back, like nine, ten, and then I'll, but I'll be working through this tomorrow. So we don't even really need to get that far into it, but let's just put all of that we've already talked about on the schedule right now. Do that. First thing I want you to do is write out the json request you would make as just a response message here in text before you send it to help debug. Please do that now. Don't call the tool, just write out the tool call the way you would if you were going to call the tool starting from:\n\n{\n\t"id": "d7ad8ff5-a0e1-4173-8052-999a7e339e09",\n\t"jsonrpc": "2.0",\n\t"method": "tools/call",\n....` }
​
10: Object { role: "assistant", content: '```json\n{\n  "id": "d7ad8ff5-a0e1-4173-8052-999a7e339e09",\n  "jsonrpc": "2.0",\n  "method": "tools/call",\n  "params": {\n    "name": "patch_graph_document",\n    "arguments": {\n      "patches": [\n        {\n          "op": "add",\n          "path": "/nodes/have_successful_day_tomorrow",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Have a successful day tomorrow",\n            "status": "not-started",\n            "parents": ["get_full_work_time"],\n            "percentage_of_parent": 0.4\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tonight_planning_time",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Planning time tonight (~40 min remaining)",\n            "status": "in-progress",\n            "parents": ["have_successful_day_tomorrow"],\n            "percentage_of_parent": 0.05,\n            "scheduled_start": "2024-11-17T20:48:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tonight_downtime",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Downtime (fuzzy border transition)",\n            "status": "not-started",\n            "parents": ["have_successful_day_tomorrow"],\n            "percentage_of_parent": 0.03,\n            "scheduled_start": "2024-11-17T21:30:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tonight_mirna_time",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Mirna time (~10:15pm fuzzy border to eating/sleep)",\n            "status": "not-started",\n            "parents": ["maintain_key_relationships"],\n            "percentage_of_parent": 0.15,\n            "scheduled_start": "2024-11-17T22:15:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tonight_sleep",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Sleep by 10:50pm (wake 6:50am = 8 hours)",\n            "status": "not-started",\n            "parents": ["have_successful_day_tomorrow"],\n            "percentage_of_parent": 0.15,\n            "scheduled_start": "2024-11-17T22:50:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tomorrow_wake",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Wake at 6:50am",\n            "status": "not-started",\n            "parents": ["have_successful_day_tomorrow"],\n            "percentage_of_parent": 0.05,\n            "scheduled_start": "2024-11-18T06:50:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tomorrow_yoga",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Legacy Fitness 7:30am gentle vinyasa",\n            "status": "not-started",\n            "parents": ["have_successful_day_tomorrow"],\n            "percentage_of_parent": 0.12,\n            "scheduled_start": "2024-11-18T07:30:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tomorrow_map_work",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Map deconstruction session (post-yoga until ~5:45pm)",\n            "status": "not-started",\n            "parents": ["stine_project_completed"],\n            "percentage_of_parent": 0.3,\n            "scheduled_start": "2024-11-18T09:00:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tomorrow_call_nate",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Call Nate at 5:45pm",\n            "status": "not-started",\n            "parents": ["maintain_key_relationships"],\n            "percentage_of_parent": 0.05,\n            "scheduled_start": "2024-11-18T17:45:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tomorrow_guys_meeting",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Meeting with guys (pickup ~7:30-7:45pm)",\n            "status": "not-started",\n            "parents": ["maintain_key_relationships"],\n            "percentage_of_parent": 0.15,\n            "scheduled_start": "2024-11-18T19:30:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/check_obi_payment",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Check if Obi paid full $42.30",\n            "status": "not-started",\n            "parents": ["maintain_key_relationships"],\n            "percentage_of_parent": 0.08,\n            "scheduled_start": "2024-11-18T10:00:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/pickup_gabapentin",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Pick up gabapentin prescription",\n            "status": "not-started",\n            "parents": ["get_full_work_time"],\n            "percentage_of_parent": 0.15,\n            "scheduled_start": "2024-11-18T10:00:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/amazon_orders",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Amazon orders (turmeric, alpha-lipoic acid, creatine)",\n            "status": "not-started",\n            "parents": ["financial_stability"],\n            "percentage_of_parent": 0.15\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/credit_card_payments",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Credit card payments (2 BNPL accounts, prime store card)",\n            "status": "not-started",\n            "parents": ["financial_stability"],\n            "percentage_of_parent": 0.25\n          }\n        }\n      ]\n    }\n  }\n}\n```' }
​
11: Object { role: "user", content: "Go ahead and make the tool call as you planned now" }
​
length: 12
​
<prototype>: Array []
index-BnmmQd6S.js:351:1651
[ChatPane][MCP] Available tools: 
Array(5) [ {…}, {…}, {…}, {…}, {…} ]
​
0: Object { name: "get_system_instructions", inputSchema: {…} }
​
1: Object { name: "update_system_instructions", inputSchema: {…} }
​
2: Object { name: "get_todays_context", inputSchema: {…} }
​
3: Object { name: "get_graph_structure", inputSchema: {…} }
​
4: Object { name: "patch_graph_document", description: "Applies a sequence of JSON Patch operations to the graph document to add, remove, or update nodes and their properties.", inputSchema: {…} }
​
length: 5

...

[ChatPane][Streaming update] 
Object { reasoning: "**Commencing Patching Operations**\n\nI'm now tasked with applying the JSON patch operations, as previously agreed upon. My primary focus is constructing the 'patches' argument, ensuring the correct new nodes representing the user's schedule tonight and tomorrow are added to the graph. I'm working methodically to ensure proper formatting.\n\n\n**Implementing JSON Patches**\n\nI've now precisely identified the structure of the `patches` argument. My current stage involves translating the intended new nodes, including `have_successful_day_tomorrow`, `tonight_planning_time`, and others, into the correct JSON format. Each element of the array, comprising \"add\" operations, carefully defines the node's properties and relationships, like parents, type, and schedule.\n\n\n**Crafting Patch Argument**\n\nI'm in the process of generating the final JSON structure for the `patches` argument. I've carefully reviewed the parent-child relationships, ensuring each new node is correctly linked in the graph based on the user's instructions. I'm now constructing the individual \"add\" operations, paying close attention to the properties like `type`, `label`, and relationships to other nodes.\n\n\n**Assembling the JSON String**\n\nI'm now focused on the final step: formatting the `patches` argument as a valid JSON string, incorporating all the planned \"add\" operations. After verifying the parent-child relationships and node properties, I'll construct the JSON structure using a multi-line string for clarity. Finally, I'm ready to invoke the `patch_graph_document` tool.\n\n\n" }
index-BnmmQd6S.js:351:2326
[ChatMessage] Rendering message: 
Object { id: "96c9ecde-f11f-4da2-8e6c-85e12b157533", content: "# Complete Context Summary for Continuation\n\n## Co...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "54e81d3d-dba8-4f8b-9c60-c0bc4cf93063", content: "I understand and am prepared to continue.", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "69c36bb6-8974-43fe-91bc-5405945a588b", content: "Okay. So now we are actually using the application...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "666f27f9-a956-4d9d-959d-02155e02755c", content: "Based on the graph structure, it seems we're looki...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "e55dc0d8-d33a-4651-8ab2-0a604adc46ec", content: "Okay, so that's a very good response and we were a...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "fca6266d-1d63-4831-b400-7369fd9ec593", content: "Okay, here's how I understand the situation and ho...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "4d2f222d-dcee-463c-9847-b93535352f70", content: "Okay, so what I'm trying to accomplish right now, ...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "6e548e32-404a-4c76-9537-b14ae3b40d04", content: "I think I understand the tension. The existing map...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "02923a86-9967-4780-a528-de89660f09d4", content: "You've got a good point. So why don't we just go a...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "acc46170-489d-4ce9-a93c-814d259a7510", content: '```json\n{\n  "id": "d7ad8ff5-a0e1-4173-8052-999a7e3...', isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "9acfb531-71d5-470a-a80f-83bde8fee132", content: "Go ahead and make the tool call as you planned now", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "f7cb5af8-6f52-4fe1-82e9-7b00d94fb2fb", content: "", isStreaming: true }
index-BnmmQd6S.js:339:111680
[ChatPane][Streaming update] 
Object { toolCall: {…} }
index-BnmmQd6S.js:351:2326
[ChatPane][Tool update detected] 
Object { id: "tool_0_patch_graph_document_ciTlKfKrSATGZPlGuezc", name: "patch_graph_document", arguments: '{"patches":"[{\\"op\\": \\"add\\", \\"path\\": \\"/nodes/have_successful_day_tomorrow\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Have a successful day tomorrow\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"get_full_work_time\\"], \\"percentage_of_parent\\": 0.4}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/tonight_planning_time\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Planning time tonight (~40 min remaining)\\", \\"status\\": \\"in-progress\\", \\"parents\\": [\\"have_successful_day_tomorrow\\"], \\"percentage_of_parent\\": 0.05, \\"scheduled_start\\": \\"2024-11-17T20:48:00\\"}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/tonight_downtime\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Downtime (fuzzy border transition)\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"have_successful_day_tomorrow\\"], \\"percentage_of_parent\\": 0.03, \\"scheduled_start\\": \\"2024-11-17T21:30:00\\"}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/tonight_mirna_time\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Mirna time (~10:15pm fuzzy border to eating/sleep)\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"maintain_key_relationships\\"], \\"percentage_of_parent\\": 0.15, \\"scheduled_start\\": \\"2024-11-17T22:15:00\\"}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/tonight_sleep\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Sleep by 10:50pm (wake 6:50am = 8 hours)\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"have_successful_day_tomorrow\\"], \\"percentage_of_parent\\": 0.15, \\"scheduled_start\\": \\"2024-11-17T22:50:00\\"}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/tomorrow_wake\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Wake at 6:50am\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"have_successful_day_tomorrow\\"], \\"percentage_of_parent\\": 0.05, \\"scheduled_start\\": \\"2024-11-18T06:50:00\\"}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/tomorrow_yoga\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Legacy Fitness 7:30am gentle vinyasa\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"have_successful_day_tomorrow\\"], \\"percentage_of_parent\\": 0.12, \\"scheduled_start\\": \\"2024-11-18T07:30:00\\"}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/tomorrow_map_work\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Map deconstruction session (post-yoga until ~5:45pm)\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"stine_project_completed\\"], \\"percentage_of_parent\\": 0.3, \\"scheduled_start\\": \\"2024-11-18T09:00:00\\"}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/tomorrow_call_nate\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Call Nate at 5:45pm\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"maintain_key_relationships\\"], \\"percentage_of_parent\\": 0.05, \\"scheduled_start\\": \\"2024-11-18T17:45:00\\"}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/tomorrow_guys_meeting\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Meeting with guys (pickup ~7:30-7:45pm)\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"maintain_key_relationships\\"], \\"percentage_of_parent\\": 0.15, \\"scheduled_start\\": \\"2024-11-18T19:30:00\\"}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/check_obi_payment\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Check if Obi paid full $42.30\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"maintain_key_relationships\\"], \\"percentage_of_parent\\": 0.08, \\"scheduled_start\\": \\"2024-11-18T10:00:00\\"}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/pickup_gabapentin\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Pick up gabapentin prescription\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"get_full_work_time\\"], \\"percentage_of_parent\\": 0.15, \\"scheduled_start\\": \\"2024-11-18T10:00:00\\"}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/amazon_orders\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Amazon orders (turmeric, alpha-lipoic acid, creatine)\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"financial_stability\\"], \\"percentage_of_parent\\": 0.15}}, {\\"op\\": \\"add\\", \\"path\\": \\"/nodes/credit_card_payments\\", \\"value\\": {\\"type\\": \\"ObjectiveNode\\", \\"label\\": \\"Credit card payments (2 BNPL accounts, prime store card)\\", \\"status\\": \\"not-started\\", \\"parents\\": [\\"financial_stability\\"], \\"percentage_of_parent\\": 0.25}}]"}', index: 0, status: "arguments" }
index-BnmmQd6S.js:351:2494
[ChatMessage] Rendering message: 
Object { id: "96c9ecde-f11f-4da2-8e6c-85e12b157533", content: "# Complete Context Summary for Continuation\n\n## Co...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "54e81d3d-dba8-4f8b-9c60-c0bc4cf93063", content: "I understand and am prepared to continue.", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "69c36bb6-8974-43fe-91bc-5405945a588b", content: "Okay. So now we are actually using the application...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "666f27f9-a956-4d9d-959d-02155e02755c", content: "Based on the graph structure, it seems we're looki...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "e55dc0d8-d33a-4651-8ab2-0a604adc46ec", content: "Okay, so that's a very good response and we were a...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "fca6266d-1d63-4831-b400-7369fd9ec593", content: "Okay, here's how I understand the situation and ho...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "4d2f222d-dcee-463c-9847-b93535352f70", content: "Okay, so what I'm trying to accomplish right now, ...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "6e548e32-404a-4c76-9537-b14ae3b40d04", content: "I think I understand the tension. The existing map...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "02923a86-9967-4780-a528-de89660f09d4", content: "You've got a good point. So why don't we just go a...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "acc46170-489d-4ce9-a93c-814d259a7510", content: '```json\n{\n  "id": "d7ad8ff5-a0e1-4173-8052-999a7e3...', isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "9acfb531-71d5-470a-a80f-83bde8fee132", content: "Go ahead and make the tool call as you planned now", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "f7cb5af8-6f52-4fe1-82e9-7b00d94fb2fb", content: "", isStreaming: true }
index-BnmmQd6S.js:339:111680
[ChatPane][Raw Gemini response] 
Object { id: "gen-1760389714-5xzs1JKyZL9PQXxIrrIH", provider: "Google", model: "google/gemini-2.5-pro", object: "chat.completion.chunk", created: 1760389714, choices: (1) […], usage: {…} }
​
choices: Array [ {…} ]
​
created: 1760389714
​
id: "gen-1760389714-5xzs1JKyZL9PQXxIrrIH"
​
model: "google/gemini-2.5-pro"
​
object: "chat.completion.chunk"
​
provider: "Google"
​
usage: Object { prompt_tokens: 17646, completion_tokens: 2268, total_tokens: 19914, … }
​​
completion_tokens: 2268
​​
completion_tokens_details: Object { reasoning_tokens: 915, image_tokens: 0 }
​​​
image_tokens: 0
​​​
reasoning_tokens: 915
​​​
<prototype>: Object { … }
​​
prompt_tokens: 17646
​​
prompt_tokens_details: Object { cached_tokens: 15813 }
​​​
cached_tokens: 15813
​​​
<prototype>: Object { … }
​​
total_tokens: 19914
​​
<prototype>: Object { … }
​
<prototype>: Object { … }
index-BnmmQd6S.js:351:3030
[ChatPane][MCP] Processing 1 tool calls index-BnmmQd6S.js:351:3257
[ChatPane][MCP] Calling tool patch_graph_document with args 
Object { patches: '[{"op": "add", "path": "/nodes/have_successful_day_tomorrow", "value": {"type": "ObjectiveNode", "label": "Have a successful day tomorrow", "status": "not-started", "parents": ["get_full_work_time"], "percentage_of_parent": 0.4}}, {"op": "add", "path": "/nodes/tonight_planning_time", "value": {"type": "ObjectiveNode", "label": "Planning time tonight (~40 min remaining)", "status": "in-progress", "parents": ["have_successful_day_tomorrow"], "percentage_of_parent": 0.05, "scheduled_start": "2024-11-17T20:48:00"}}, {"op": "add", "path": "/nodes/tonight_downtime", "value": {"type": "ObjectiveNode", "label": "Downtime (fuzzy border transition)", "status": "not-started", "parents": ["have_successful_day_tomorrow"], "percentage_of_parent": 0.03, "scheduled_start": "2024-11-17T21:30:00"}}, {"op": "add", "path": "/nodes/tonight_mirna_time", "value": {"type": "ObjectiveNode", "label": "Mirna time (~10:15pm fuzzy border to eating/sleep)", "status": "not-started", "parents": ["maintain_key_relationships"], "percentage_of_parent": 0.15, "scheduled_start": "2024-11-17T22:15:00"}}, {"op": "add", "path": "/nodes/tonight_sleep", "value": {"type": "ObjectiveNode", "label": "Sleep by 10:50pm (wake 6:50am = 8 hours)", "status": "not-started", "parents": ["have_successful_day_tomorrow"], "percentage_of_parent": 0.15, "scheduled_start": "2024-11-17T22:50:00"}}, {"op": "add", "path": "/nodes/tomorrow_wake", "value": {"type": "ObjectiveNode", "label": "Wake at 6:50am", "status": "not-started", "parents": ["have_successful_day_tomorrow"], "percentage_of_parent": 0.05, "scheduled_start": "2024-11-18T06:50:00"}}, {"op": "add", "path": "/nodes/tomorrow_yoga", "value": {"type": "ObjectiveNode", "label": "Legacy Fitness 7:30am gentle vinyasa", "status": "not-started", "parents": ["have_successful_day_tomorrow"], "percentage_of_parent": 0.12, "scheduled_start": "2024-11-18T07:30:00"}}, {"op": "add", "path": "/nodes/tomorrow_map_work", "value": {"type": "ObjectiveNode", "label": "Map deconstruction session (post-yoga until ~5:45pm)", "status": "not-started", "parents": ["stine_project_completed"], "percentage_of_parent": 0.3, "scheduled_start": "2024-11-18T09:00:00"}}, {"op": "add", "path": "/nodes/tomorrow_call_nate", "value": {"type": "ObjectiveNode", "label": "Call Nate at 5:45pm", "status": "not-started", "parents": ["maintain_key_relationships"], "percentage_of_parent": 0.05, "scheduled_start": "2024-11-18T17:45:00"}}, {"op": "add", "path": "/nodes/tomorrow_guys_meeting", "value": {"type": "ObjectiveNode", "label": "Meeting with guys (pickup ~7:30-7:45pm)", "status": "not-started", "parents": ["maintain_key_relationships"], "percentage_of_parent": 0.15, "scheduled_start": "2024-11-18T19:30:00"}}, {"op": "add", "path": "/nodes/check_obi_payment", "value": {"type": "ObjectiveNode", "label": "Check if Obi paid full $42.30", "status": "not-started", "parents": ["maintain_key_relationships"], "percentage_of_parent": 0.08, "scheduled_start": "2024-11-18T10:00:00"}}, {"op": "add", "path": "/nodes/pickup_gabapentin", "value": {"type": "ObjectiveNode", "label": "Pick up gabapentin prescription", "status": "not-started", "parents": ["get_full_work_time"], "percentage_of_parent": 0.15, "scheduled_start": "2024-11-18T10:00:00"}}, {"op": "add", "path": "/nodes/amazon_orders", "value": {"type": "ObjectiveNode", "label": "Amazon orders (turmeric, alpha-lipoic acid, creatine)", "status": "not-started", "parents": ["financial_stability"], "percentage_of_parent": 0.15}}, {"op": "add", "path": "/nodes/credit_card_payments", "value": {"type": "ObjectiveNode", "label": "Credit card payments (2 BNPL accounts, prime store card)", "status": "not-started", "parents": ["financial_stability"], "percentage_of_parent": 0.25}}]' }
index-BnmmQd6S.js:351:3990
[MCP Client] Sending request 
Object { jsonrpc: "2.0", id: "c8709db7-21cc-473c-96a5-5200703fb5fe", method: "tools/call", params: {…} }
​
id: "c8709db7-21cc-473c-96a5-5200703fb5fe"
​
jsonrpc: "2.0"
​
method: "tools/call"
​
params: Object { name: "patch_graph_document", arguments: {…} }
​​
arguments: Object { patches: '[{"op": "add", "path": "/nodes/have_successful_day_tomorrow", "value": {"type": "ObjectiveNode", "label": "Have a successful day tomorrow", "status": "not-started", "parents": ["get_full_work_time"], "percentage_of_parent": 0.4}}, {"op": "add", "path": "/nodes/tonight_planning_time", "value": {"type": "ObjectiveNode", "label": "Planning time tonight (~40 min remaining)", "status": "in-progress", "parents": ["have_successful_day_tomorrow"], "percentage_of_parent": 0.05, "scheduled_start": "2024-11-17T20:48:00"}}, {"op": "add", "path": "/nodes/tonight_downtime", "value": {"type": "ObjectiveNode", "label": "Downtime (fuzzy border transition)", "status": "not-started", "parents": ["have_successful_day_tomorrow"], "percentage_of_parent": 0.03, "scheduled_start": "2024-11-17T21:30:00"}}, {"op": "add", "path": "/nodes/tonight_mirna_time", "value": {"type": "ObjectiveNode", "label": "Mirna time (~10:15pm fuzzy border to eating/sleep)", "status": "not-started", "parents": ["maintain_key_relationships"], "percentage_of_parent": 0.15, "scheduled_start": "2024-11-17T22:15:00"}}, {"op": "add", "path": "/nodes/tonight_sleep", "value": {"type": "ObjectiveNode", "label": "Sleep by 10:50pm (wake 6:50am = 8 hours)", "status": "not-started", "parents": ["have_successful_day_tomorrow"], "percentage_of_parent": 0.15, "scheduled_start": "2024-11-17T22:50:00"}}, {"op": "add", "path": "/nodes/tomorrow_wake", "value": {"type": "ObjectiveNode", "label": "Wake at 6:50am", "status": "not-started", "parents": ["have_successful_day_tomorrow"], "percentage_of_parent": 0.05, "scheduled_start": "2024-11-18T06:50:00"}}, {"op": "add", "path": "/nodes/tomorrow_yoga", "value": {"type": "ObjectiveNode", "label": "Legacy Fitness 7:30am gentle vinyasa", "status": "not-started", "parents": ["have_successful_day_tomorrow"], "percentage_of_parent": 0.12, "scheduled_start": "2024-11-18T07:30:00"}}, {"op": "add", "path": "/nodes/tomorrow_map_work", "value": {"type": "ObjectiveNode", "label": "Map deconstruction session (post-yoga until ~5:45pm)", "status": "not-started", "parents": ["stine_project_completed"], "percentage_of_parent": 0.3, "scheduled_start": "2024-11-18T09:00:00"}}, {"op": "add", "path": "/nodes/tomorrow_call_nate", "value": {"type": "ObjectiveNode", "label": "Call Nate at 5:45pm", "status": "not-started", "parents": ["maintain_key_relationships"], "percentage_of_parent": 0.05, "scheduled_start": "2024-11-18T17:45:00"}}, {"op": "add", "path": "/nodes/tomorrow_guys_meeting", "value": {"type": "ObjectiveNode", "label": "Meeting with guys (pickup ~7:30-7:45pm)", "status": "not-started", "parents": ["maintain_key_relationships"], "percentage_of_parent": 0.15, "scheduled_start": "2024-11-18T19:30:00"}}, {"op": "add", "path": "/nodes/check_obi_payment", "value": {"type": "ObjectiveNode", "label": "Check if Obi paid full $42.30", "status": "not-started", "parents": ["maintain_key_relationships"], "percentage_of_parent": 0.08, "scheduled_start": "2024-11-18T10:00:00"}}, {"op": "add", "path": "/nodes/pickup_gabapentin", "value": {"type": "ObjectiveNode", "label": "Pick up gabapentin prescription", "status": "not-started", "parents": ["get_full_work_time"], "percentage_of_parent": 0.15, "scheduled_start": "2024-11-18T10:00:00"}}, {"op": "add", "path": "/nodes/amazon_orders", "value": {"type": "ObjectiveNode", "label": "Amazon orders (turmeric, alpha-lipoic acid, creatine)", "status": "not-started", "parents": ["financial_stability"], "percentage_of_parent": 0.15}}, {"op": "add", "path": "/nodes/credit_card_payments", "value": {"type": "ObjectiveNode", "label": "Credit card payments (2 BNPL accounts, prime store card)", "status": "not-started", "parents": ["financial_stability"], "percentage_of_parent": 0.25}}]' }
​​
name: "patch_graph_document"
​​
<prototype>: Object { … }
​
<prototype>: Object { … }
index-BnmmQd6S.js:352:7106
[ChatMessage] Rendering message: 
Object { id: "96c9ecde-f11f-4da2-8e6c-85e12b157533", content: "# Complete Context Summary for Continuation\n\n## Co...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "54e81d3d-dba8-4f8b-9c60-c0bc4cf93063", content: "I understand and am prepared to continue.", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "69c36bb6-8974-43fe-91bc-5405945a588b", content: "Okay. So now we are actually using the application...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "666f27f9-a956-4d9d-959d-02155e02755c", content: "Based on the graph structure, it seems we're looki...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "e55dc0d8-d33a-4651-8ab2-0a604adc46ec", content: "Okay, so that's a very good response and we were a...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "fca6266d-1d63-4831-b400-7369fd9ec593", content: "Okay, here's how I understand the situation and ho...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "4d2f222d-dcee-463c-9847-b93535352f70", content: "Okay, so what I'm trying to accomplish right now, ...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "6e548e32-404a-4c76-9537-b14ae3b40d04", content: "I think I understand the tension. The existing map...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "02923a86-9967-4780-a528-de89660f09d4", content: "You've got a good point. So why don't we just go a...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "acc46170-489d-4ce9-a93c-814d259a7510", content: '```json\n{\n  "id": "d7ad8ff5-a0e1-4173-8052-999a7e3...', isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "9acfb531-71d5-470a-a80f-83bde8fee132", content: "Go ahead and make the tool call as you planned now", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "f7cb5af8-6f52-4fe1-82e9-7b00d94fb2fb", content: "", isStreaming: true }
index-BnmmQd6S.js:339:111680
[MCP Transport] POST success index-BnmmQd6S.js:352:6103
[MCP Transport] SSE message {"jsonrpc":"2.0","id":"c8709db7-21cc-473c-96a5-5200703fb5fe","result":{"content":[{"type":"text","text":"{\"success\":true,\"score_context\":{\"current_daily_score\":0,\"planned_daily_score\":0,\"historical_average_score\":68},\"result\":{\"nodes\":{\"get_cuvitru\":{\"type\":\"objectiveNode\",\"label\":\"Get Cuvitru\",\"status\":\"in-progress\",\"parents\":[\"get_full_work_time\"],\"createdAt\":\"2025-09-22T17:00:00.000Z\",\"percentage_of_parent\":20,\"true_percentage_of_total\":6.666666666666668},\"live_forever\":{\"type\":\"goalNode\",\"label\":\"Live Forever\",\"status\":\"not-started\",\"parents\":[],\"createdAt\":\"2025-09-22T10:00:00.000Z\",\"percentage_of_parent\":100,\"true_percentage_of_total\":100},\"get_groceries\":{\"type\":\"objectiveNode\",\"label\":\"Get Groceries\",\"status\":\"not-started\",\"parents\":[\"get_full_work_time\"],\"createdAt\":\"2025-09-22T15:00:00.000Z\",\"percentage_of_parent\":20,\"true_percentage_of_total\":5},\"call_on_monday\":{\"type\":\"objectiveNode\",\"label\":\"Call on Monday\",\"status\":\"not-started\",\"parents\":[\"interact_with_doctors_office\"],\"createdAt\":\"2025-09-22T19:00:00.000Z\",\"percentage_of_parent\":100,\"true_percentage_of_total\":3.333333333333334},\"call_estes_shower\":{\"type\":\"objectiveNode\",\"label\":\"Call Dr. Estes - Offer Shower Access\",\"notes\":\"Mi baño es su baño. Touch base while Tiffany is in town. No specific time - needs system mod to support this pattern.\",\"status\":\"not-started\",\"parents\":[\"maintain_key_relationships\"],\"percentage_of_parent\":16.666666666666668,\"true_percentage_of_total\":16.666666666666668},\"get_full_work_time\":{\"type\":\"milestoneNode\",\"label\":\"Get Full Work Time\",\"status\":\"not-started\",\"parents\":[\"complete_front_back_end_ui\"],\"createdAt\":\"2025-09-22T13:00:00.000Z\",\"percentage_of_parent\":50,\"true_percentage_of_total\":16.666666666666668},\"work_on_mcp_system\":{\"type\":\"objectiveNode\",\"label\":\"Complete MCP System Bootstrap\",\"notes\":\"At coffee shop. System is functional, now bootstrapping with real data. Meta-goal: document the building process within the system itself.\",\"status\":\"in-progress\",\"parents\":[\"complete_front_back_end_ui\"],\"scheduled_end\":\"2025-09-24T17:45:00.000Z\",\"scheduled_start\":\"2025-09-24T07:30:00.000Z\",\"percentage_of_parent\":50,\"true_percentage_of_total\":16.666666666666668},\"work_while_waiting\":{\"type\":\"objectiveNode\",\"label\":\"Work While Waiting\",\"status\":\"not-started\",\"parents\":[\"get_full_work_time\"],\"createdAt\":\"2025-09-22T14:00:00.000Z\",\"percentage_of_parent\":20,\"true_percentage_of_total\":5},\"financial_stability\":{\"type\":\"milestoneNode\",\"label\":\"Achieve Financial Stability\",\"notes\":\"Not wealth, just stability to enable real work.\",\"status\":\"in-progress\",\"parents\":[\"live_forever\"],\"percentage_of_parent\":33.333333333333336,\"true_percentage_of_total\":33.333333333333336},\"stay_under_4k_friday\":{\"type\":\"milestoneNode\",\"label\":\"Keep Wells Under $4k by Friday Close\",\"notes\":\"Currently at $3,810 after $600 dispute credit. $65 on prepaid cards for transport.\",\"status\":\"in-progress\",\"parents\":[\"financial_stability\"],\"percentage_of_parent\":33.333333333333336,\"true_percentage_of_total\":33.333333333333336},\"place_order_on_amazon\":{\"type\":\"objectiveNode\",\"label\":\"Place Order on Amazon\",\"status\":\"not-started\",\"parents\":[\"get_groceries\"],\"createdAt\":\"2025-09-22T16:00:00.000Z\",\"percentage_of_parent\":100,\"true_percentage_of_total\":5},\"stine_project_completed\":{\"type\":\"milestoneNode\",\"label\":\"Stine Project Completed\",\"status\":\"not-started\",\"parents\":[\"live_forever\"],\"createdAt\":\"2025-09-22T11:00:00.000Z\",\"percentage_of_parent\":33.333333333333336,\"true_percentage_of_total\":33.333333333333336},\"church_hope_ankeny_tuesday\":{\"type\":\"objectiveNode\",\"label\":\"Church Event - Hope Ankeny\",\"notes\":\"$20 Lyft roundtrip. Social buffer for evening.\",\"status\":\"in-progress\",\"parents\":[\"maintain_key_relationships\"],\"scheduled_start\":\"2025-09-24T18:30:00.000Z\",\"percentage_of_parent\":16.666666666666668,\"true_percentage_of_total\":16.666666666666668},\"complete_front_back_end_ui\":{\"type\":\"objectiveNode\",\"label\":\"Complete Front/Back End UI\",\"status\":\"not-started\",\"parents\":[\"stine_project_completed\"],\"createdAt\":\"2025-09-22T12:00:00.000Z\",\"percentage_of_parent\":50,\"true_percentage_of_total\":33.333333333333336},\"maintain_key_relationships\":{\"type\":\"milestoneNode\",\"label\":\"Maintain Key Relationships\",\"notes\":\"Strategic social infrastructure - Estes, church community, etc. Not romantic, but necessary support network.\",\"status\":\"ongoing\",\"parents\":[\"live_forever\"],\"percentage_of_parent\":33.333333333333336,\"true_percentage_of_total\":33.333333333333336},\"interact_with_doctors_office\":{\"type\":\"objectiveNode\",\"label\":\"Interact with Doctor's Office\",\"status\":\"not-started\",\"parents\":[\"get_cuvitru\"],\"createdAt\":\"2025-09-22T18:00:00.000Z\",\"percentage_of_parent\":50,\"true_percentage_of_total\":3.333333333333334},\"have_successful_day_tomorrow\":{\"type\":\"ObjectiveNode\",\"label\":\"Have a successful day tomorrow\",\"status\":\"not-started\",\"parents\":[\"get_full_work_time\"],\"percentage_of_parent\":20,\"true_percentage_of_total\":0.06666666666666668},\"tonight_planning_time\":{\"type\":\"ObjectiveNode\",\"label\":\"Planning time tonight (~40 min remaining)\",\"status\":\"in-progress\",\"parents\":[\"have_successful_day_tomorrow\"],\"percentage_of_parent\":20,\"scheduled_start\":\"2024-11-17T20:48:00\",\"true_percentage_of_total\":0.00003333333333333334},\"tonight_downtime\":{\"type\":\"ObjectiveNode\",\"label\":\"Downtime (fuzzy border transition)\",\"status\":\"not-started\",\"parents\":[\"have_successful_day_tomorrow\"],\"percentage_of_parent\":20,\"scheduled_start\":\"2024-11-17T21:30:00\",\"true_percentage_of_total\":0.00002},\"tonight_mirna_time\":{\"type\":\"ObjectiveNode\",\"label\":\"Mirna time (~10:15pm fuzzy border to eating/sleep)\",\"status\":\"not-started\",\"parents\":[\"maintain_key_relationships\"],\"percentage_of_parent\":16.666666666666668,\"scheduled_start\":\"2024-11-17T22:15:00\",\"true_percentage_of_total\":0.05},\"tonight_sleep\":{\"type\":\"ObjectiveNode\",\"label\":\"Sleep by 10:50pm (wake 6:50am = 8 hours)\",\"status\":\"not-started\",\"parents\":[\"have_successful_day_tomorrow\"],\"percentage_of_parent\":20,\"scheduled_start\":\"2024-11-17T22:50:00\",\"true_percentage_of_total\":0.00010000000000000002},\"tomorrow_wake\":{\"type\":\"ObjectiveNode\",\"label\":\"Wake at 6:50am\",\"status\":\"not-started\",\"parents\":[\"have_successful_day_tomorrow\"],\"percentage_of_parent\":20,\"scheduled_start\":\"2024-11-18T06:50:00\",\"true_percentage_of_total\":0.00003333333333333334},\"tomorrow_yoga\":{\"type\":\"ObjectiveNode\",\"label\":\"Legacy Fitness 7:30am gentle vinyasa\",\"status\":\"not-started\",\"parents\":[\"have_successful_day_tomorrow\"],\"percentage_of_parent\":20,\"scheduled_start\":\"2024-11-18T07:30:00\",\"true_percentage_of_total\":0.00008},\"tomorrow_map_work\":{\"type\":\"ObjectiveNode\",\"label\":\"Map deconstruction session (post-yoga until ~5:45pm)\",\"status\":\"not-started\",\"parents\":[\"stine_project_completed\"],\"percentage_of_parent\":50,\"scheduled_start\":\"2024-11-18T09:00:00\",\"true_percentage_of_total\":0.1},\"tomorrow_call_nate\":{\"type\":\"ObjectiveNode\",\"label\":\"Call Nate at 5:45pm\",\"status\":\"not-started\",\"parents\":[\"maintain_key_relationships\"],\"percentage_of_parent\":16.666666666666668,\"scheduled_start\":\"2024-11-18T17:45:00\",\"true_percentage_of_total\":0.01666666666666667},\"tomorrow_guys_meeting\":{\"type\":\"ObjectiveNode\",\"label\":\"Meeting with guys (pickup ~7:30-7:45pm)\",\"status\":\"not-started\",\"parents\":[\"maintain_key_relationships\"],\"percentage_of_parent\":16.666666666666668,\"scheduled_start\":\"2024-11-18T19:30:00\",\"true_percentage_of_total\":0.05},\"check_obi_payment\":{\"type\":\"ObjectiveNode\",\"label\":\"Check if Obi paid full $42.30\",\"status\":\"not-started\",\"parents\":[\"maintain_key_relationships\"],\"percentage_of_parent\":16.666666666666668,\"scheduled_start\":\"2024-11-18T10:00:00\",\"true_percentage_of_total\":0.02666666666666667},\"pickup_gabapentin\":{\"type\":\"ObjectiveNode\",\"label\":\"Pick up gabapentin prescription\",\"status\":\"not-started\",\"parents\":[\"get_full_work_time\"],\"percentage_of_parent\":20,\"scheduled_start\":\"2024-11-18T10:00:00\",\"true_percentage_of_total\":0.025},\"amazon_orders\":{\"type\":\"ObjectiveNode\",\"label\":\"Amazon orders (turmeric, alpha-lipoic acid, creatine)\",\"status\":\"not-started\",\"parents\":[\"financial_stability\"],\"percentage_of_parent\":33.333333333333336,\"true_percentage_of_total\":0.05},\"credit_card_payments\":{\"type\":\"ObjectiveNode\",\"label\":\"Credit card payments (2 BNPL accounts, prime store card)\",\"status\":\"not-started\",\"parents\":[\"financial_stability\"],\"percentage_of_parent\":33.333333333333336,\"true_percentage_of_total\":0.08333333333333334}},\"viewport\":{\"x\":14.103769497400208,\"y\":484.50006103515625,\"zoom\":0.8422876949740035},\"active_node\":\"get_cuvitru\",\"historical_progress\":{}}}"}]}} index-BnmmQd6S.js:352:5339
[MCP Client] Incoming message 
Object { jsonrpc: "2.0", id: "c8709db7-21cc-473c-96a5-5200703fb5fe", result: {…} }
​
id: "c8709db7-21cc-473c-96a5-5200703fb5fe"
​
jsonrpc: "2.0"
​
result: Object { content: (1) […] }
​​
content: Array [ {…} ]
​​​
0: Object { type: "text", text: `{"success":true,"score_context":{"current_daily_score":0,"planned_daily_score":0,"historical_average_score":68},"result":{"nodes":{"get_cuvitru":{"type":"objectiveNode","label":"Get Cuvitru","status":"in-progress","parents":["get_full_work_time"],"createdAt":"2025-09-22T17:00:00.000Z","percentage_of_parent":20,"true_percentage_of_total":6.666666666666668},"live_forever":{"type":"goalNode","label":"Live Forever","status":"not-started","parents":[],"createdAt":"2025-09-22T10:00:00.000Z","percentage_of_parent":100,"true_percentage_of_total":100},"get_groceries":{"type":"objectiveNode","label":"Get Groceries","status":"not-started","parents":["get_full_work_time"],"createdAt":"2025-09-22T15:00:00.000Z","percentage_of_parent":20,"true_percentage_of_total":5},"call_on_monday":{"type":"objectiveNode","label":"Call on Monday","status":"not-started","parents":["interact_with_doctors_office"],"createdAt":"2025-09-22T19:00:00.000Z","percentage_of_parent":100,"true_percentage_of_total":3.333333333333334},"call_estes_shower":{"type":"objectiveNode","label":"Call Dr. Estes - Offer Shower Access","notes":"Mi baño es su baño. Touch base while Tiffany is in town. No specific time - needs system mod to support this pattern.","status":"not-started","parents":["maintain_key_relationships"],"percentage_of_parent":16.666666666666668,"true_percentage_of_total":16.666666666666668},"get_full_work_time":{"type":"milestoneNode","label":"Get Full Work Time","status":"not-started","parents":["complete_front_back_end_ui"],"createdAt":"2025-09-22T13:00:00.000Z","percentage_of_parent":50,"true_percentage_of_total":16.666666666666668},"work_on_mcp_system":{"type":"objectiveNode","label":"Complete MCP System Bootstrap","notes":"At coffee shop. System is functional, now bootstrapping with real data. Meta-goal: document the building process within the system itself.","status":"in-progress","parents":["complete_front_back_end_ui"],"scheduled_end":"2025-09-24T17:45:00.000Z","scheduled_start":"2025-09-24T07:30:00.000Z","percentage_of_parent":50,"true_percentage_of_total":16.666666666666668},"work_while_waiting":{"type":"objectiveNode","label":"Work While Waiting","status":"not-started","parents":["get_full_work_time"],"createdAt":"2025-09-22T14:00:00.000Z","percentage_of_parent":20,"true_percentage_of_total":5},"financial_stability":{"type":"milestoneNode","label":"Achieve Financial Stability","notes":"Not wealth, just stability to enable real work.","status":"in-progress","parents":["live_forever"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":33.333333333333336},"stay_under_4k_friday":{"type":"milestoneNode","label":"Keep Wells Under $4k by Friday Close","notes":"Currently at $3,810 after $600 dispute credit. $65 on prepaid cards for transport.","status":"in-progress","parents":["financial_stability"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":33.333333333333336},"place_order_on_amazon":{"type":"objectiveNode","label":"Place Order on Amazon","status":"not-started","parents":["get_groceries"],"createdAt":"2025-09-22T16:00:00.000Z","percentage_of_parent":100,"true_percentage_of_total":5},"stine_project_completed":{"type":"milestoneNode","label":"Stine Project Completed","status":"not-started","parents":["live_forever"],"createdAt":"2025-09-22T11:00:00.000Z","percentage_of_parent":33.333333333333336,"true_percentage_of_total":33.333333333333336},"church_hope_ankeny_tuesday":{"type":"objectiveNode","label":"Church Event - Hope Ankeny","notes":"$20 Lyft roundtrip. Social buffer for evening.","status":"in-progress","parents":["maintain_key_relationships"],"scheduled_start":"2025-09-24T18:30:00.000Z","percentage_of_parent":16.666666666666668,"true_percentage_of_total":16.666666666666668},"complete_front_back_end_ui":{"type":"objectiveNode","label":"Complete Front/Back End UI","status":"not-started","parents":["stine_project_completed"],"createdAt":"2025-09-22T12:00:00.000Z","percentage_of_parent":50,"true_percentage_of_total":33.333333333333336},"maintain_key_relationships":{"type":"milestoneNode","label":"Maintain Key Relationships","notes":"Strategic social infrastructure - Estes, church community, etc. Not romantic, but necessary support network.","status":"ongoing","parents":["live_forever"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":33.333333333333336},"interact_with_doctors_office":{"type":"objectiveNode","label":"Interact with Doctor's Office","status":"not-started","parents":["get_cuvitru"],"createdAt":"2025-09-22T18:00:00.000Z","percentage_of_parent":50,"true_percentage_of_total":3.333333333333334},"have_successful_day_tomorrow":{"type":"ObjectiveNode","label":"Have a successful day tomorrow","status":"not-started","parents":["get_full_work_time"],"percentage_of_parent":20,"true_percentage_of_total":0.06666666666666668},"tonight_planning_time":{"type":"ObjectiveNode","label":"Planning time tonight (~40 min remaining)","status":"in-progress","parents":["have_successful_day_tomorrow"],"percentage_of_parent":20,"scheduled_start":"2024-11-17T20:48:00","true_percentage_of_total":0.00003333333333333334},"tonight_downtime":{"type":"ObjectiveNode","label":"Downtime (fuzzy border transition)","status":"not-started","parents":["have_successful_day_tomorrow"],"percentage_of_parent":20,"scheduled_start":"2024-11-17T21:30:00","true_percentage_of_total":0.00002},"tonight_mirna_time":{"type":"ObjectiveNode","label":"Mirna time (~10:15pm fuzzy border to eating/sleep)","status":"not-started","parents":["maintain_key_relationships"],"percentage_of_parent":16.666666666666668,"scheduled_start":"2024-11-17T22:15:00","true_percentage_of_total":0.05},"tonight_sleep":{"type":"ObjectiveNode","label":"Sleep by 10:50pm (wake 6:50am = 8 hours)","status":"not-started","parents":["have_successful_day_tomorrow"],"percentage_of_parent":20,"scheduled_start":"2024-11-17T22:50:00","true_percentage_of_total":0.00010000000000000002},"tomorrow_wake":{"type":"ObjectiveNode","label":"Wake at 6:50am","status":"not-started","parents":["have_successful_day_tomorrow"],"percentage_of_parent":20,"scheduled_start":"2024-11-18T06:50:00","true_percentage_of_total":0.00003333333333333334},"tomorrow_yoga":{"type":"ObjectiveNode","label":"Legacy Fitness 7:30am gentle vinyasa","status":"not-started","parents":["have_successful_day_tomorrow"],"percentage_of_parent":20,"scheduled_start":"2024-11-18T07:30:00","true_percentage_of_total":0.00008},"tomorrow_map_work":{"type":"ObjectiveNode","label":"Map deconstruction session (post-yoga until ~5:45pm)","status":"not-started","parents":["stine_project_completed"],"percentage_of_parent":50,"scheduled_start":"2024-11-18T09:00:00","true_percentage_of_total":0.1},"tomorrow_call_nate":{"type":"ObjectiveNode","label":"Call Nate at 5:45pm","status":"not-started","parents":["maintain_key_relationships"],"percentage_of_parent":16.666666666666668,"scheduled_start":"2024-11-18T17:45:00","true_percentage_of_total":0.01666666666666667},"tomorrow_guys_meeting":{"type":"ObjectiveNode","label":"Meeting with guys (pickup ~7:30-7:45pm)","status":"not-started","parents":["maintain_key_relationships"],"percentage_of_parent":16.666666666666668,"scheduled_start":"2024-11-18T19:30:00","true_percentage_of_total":0.05},"check_obi_payment":{"type":"ObjectiveNode","label":"Check if Obi paid full $42.30","status":"not-started","parents":["maintain_key_relationships"],"percentage_of_parent":16.666666666666668,"scheduled_start":"2024-11-18T10:00:00","true_percentage_of_total":0.02666666666666667},"pickup_gabapentin":{"type":"ObjectiveNode","label":"Pick up gabapentin prescription","status":"not-started","parents":["get_full_work_time"],"percentage_of_parent":20,"scheduled_start":"2024-11-18T10:00:00","true_percentage_of_total":0.025},"amazon_orders":{"type":"ObjectiveNode","label":"Amazon orders (turmeric, alpha-lipoic acid, creatine)","status":"not-started","parents":["financial_stability"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":0.05},"credit_card_payments":{"type":"ObjectiveNode","label":"Credit card payments (2 BNPL accounts, prime store card)","status":"not-started","parents":["financial_stability"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":0.08333333333333334}},"viewport":{"x":14.103769497400208,"y":484.50006103515625,"zoom":0.8422876949740035},"active_node":"get_cuvitru","historical_progress":{}}}` }
​​​
length: 1
​​​
<prototype>: Array []
​​
<prototype>: Object { … }
​
<prototype>: Object { … }
index-BnmmQd6S.js:352:6667
[ChatPane][MCP] Tool result 
Object { content: `{"success":true,"score_context":{"current_daily_score":0,"planned_daily_score":0,"historical_average_score":68},"result":{"nodes":{"get_cuvitru":{"type":"objectiveNode","label":"Get Cuvitru","status":"in-progress","parents":["get_full_work_time"],"createdAt":"2025-09-22T17:00:00.000Z","percentage_of_parent":20,"true_percentage_of_total":6.666666666666668},"live_forever":{"type":"goalNode","label":"Live Forever","status":"not-started","parents":[],"createdAt":"2025-09-22T10:00:00.000Z","percentage_of_parent":100,"true_percentage_of_total":100},"get_groceries":{"type":"objectiveNode","label":"Get Groceries","status":"not-started","parents":["get_full_work_time"],"createdAt":"2025-09-22T15:00:00.000Z","percentage_of_parent":20,"true_percentage_of_total":5},"call_on_monday":{"type":"objectiveNode","label":"Call on Monday","status":"not-started","parents":["interact_with_doctors_office"],"createdAt":"2025-09-22T19:00:00.000Z","percentage_of_parent":100,"true_percentage_of_total":3.333333333333334},"call_estes_shower":{"type":"objectiveNode","label":"Call Dr. Estes - Offer Shower Access","notes":"Mi baño es su baño. Touch base while Tiffany is in town. No specific time - needs system mod to support this pattern.","status":"not-started","parents":["maintain_key_relationships"],"percentage_of_parent":16.666666666666668,"true_percentage_of_total":16.666666666666668},"get_full_work_time":{"type":"milestoneNode","label":"Get Full Work Time","status":"not-started","parents":["complete_front_back_end_ui"],"createdAt":"2025-09-22T13:00:00.000Z","percentage_of_parent":50,"true_percentage_of_total":16.666666666666668},"work_on_mcp_system":{"type":"objectiveNode","label":"Complete MCP System Bootstrap","notes":"At coffee shop. System is functional, now bootstrapping with real data. Meta-goal: document the building process within the system itself.","status":"in-progress","parents":["complete_front_back_end_ui"],"scheduled_end":"2025-09-24T17:45:00.000Z","scheduled_start":"2025-09-24T07:30:00.000Z","percentage_of_parent":50,"true_percentage_of_total":16.666666666666668},"work_while_waiting":{"type":"objectiveNode","label":"Work While Waiting","status":"not-started","parents":["get_full_work_time"],"createdAt":"2025-09-22T14:00:00.000Z","percentage_of_parent":20,"true_percentage_of_total":5},"financial_stability":{"type":"milestoneNode","label":"Achieve Financial Stability","notes":"Not wealth, just stability to enable real work.","status":"in-progress","parents":["live_forever"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":33.333333333333336},"stay_under_4k_friday":{"type":"milestoneNode","label":"Keep Wells Under $4k by Friday Close","notes":"Currently at $3,810 after $600 dispute credit. $65 on prepaid cards for transport.","status":"in-progress","parents":["financial_stability"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":33.333333333333336},"place_order_on_amazon":{"type":"objectiveNode","label":"Place Order on Amazon","status":"not-started","parents":["get_groceries"],"createdAt":"2025-09-22T16:00:00.000Z","percentage_of_parent":100,"true_percentage_of_total":5},"stine_project_completed":{"type":"milestoneNode","label":"Stine Project Completed","status":"not-started","parents":["live_forever"],"createdAt":"2025-09-22T11:00:00.000Z","percentage_of_parent":33.333333333333336,"true_percentage_of_total":33.333333333333336},"church_hope_ankeny_tuesday":{"type":"objectiveNode","label":"Church Event - Hope Ankeny","notes":"$20 Lyft roundtrip. Social buffer for evening.","status":"in-progress","parents":["maintain_key_relationships"],"scheduled_start":"2025-09-24T18:30:00.000Z","percentage_of_parent":16.666666666666668,"true_percentage_of_total":16.666666666666668},"complete_front_back_end_ui":{"type":"objectiveNode","label":"Complete Front/Back End UI","status":"not-started","parents":["stine_project_completed"],"createdAt":"2025-09-22T12:00:00.000Z","percentage_of_parent":50,"true_percentage_of_total":33.333333333333336},"maintain_key_relationships":{"type":"milestoneNode","label":"Maintain Key Relationships","notes":"Strategic social infrastructure - Estes, church community, etc. Not romantic, but necessary support network.","status":"ongoing","parents":["live_forever"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":33.333333333333336},"interact_with_doctors_office":{"type":"objectiveNode","label":"Interact with Doctor's Office","status":"not-started","parents":["get_cuvitru"],"createdAt":"2025-09-22T18:00:00.000Z","percentage_of_parent":50,"true_percentage_of_total":3.333333333333334},"have_successful_day_tomorrow":{"type":"ObjectiveNode","label":"Have a successful day tomorrow","status":"not-started","parents":["get_full_work_time"],"percentage_of_parent":20,"true_percentage_of_total":0.06666666666666668},"tonight_planning_time":{"type":"ObjectiveNode","label":"Planning time tonight (~40 min remaining)","status":"in-progress","parents":["have_successful_day_tomorrow"],"percentage_of_parent":20,"scheduled_start":"2024-11-17T20:48:00","true_percentage_of_total":0.00003333333333333334},"tonight_downtime":{"type":"ObjectiveNode","label":"Downtime (fuzzy border transition)","status":"not-started","parents":["have_successful_day_tomorrow"],"percentage_of_parent":20,"scheduled_start":"2024-11-17T21:30:00","true_percentage_of_total":0.00002},"tonight_mirna_time":{"type":"ObjectiveNode","label":"Mirna time (~10:15pm fuzzy border to eating/sleep)","status":"not-started","parents":["maintain_key_relationships"],"percentage_of_parent":16.666666666666668,"scheduled_start":"2024-11-17T22:15:00","true_percentage_of_total":0.05},"tonight_sleep":{"type":"ObjectiveNode","label":"Sleep by 10:50pm (wake 6:50am = 8 hours)","status":"not-started","parents":["have_successful_day_tomorrow"],"percentage_of_parent":20,"scheduled_start":"2024-11-17T22:50:00","true_percentage_of_total":0.00010000000000000002},"tomorrow_wake":{"type":"ObjectiveNode","label":"Wake at 6:50am","status":"not-started","parents":["have_successful_day_tomorrow"],"percentage_of_parent":20,"scheduled_start":"2024-11-18T06:50:00","true_percentage_of_total":0.00003333333333333334},"tomorrow_yoga":{"type":"ObjectiveNode","label":"Legacy Fitness 7:30am gentle vinyasa","status":"not-started","parents":["have_successful_day_tomorrow"],"percentage_of_parent":20,"scheduled_start":"2024-11-18T07:30:00","true_percentage_of_total":0.00008},"tomorrow_map_work":{"type":"ObjectiveNode","label":"Map deconstruction session (post-yoga until ~5:45pm)","status":"not-started","parents":["stine_project_completed"],"percentage_of_parent":50,"scheduled_start":"2024-11-18T09:00:00","true_percentage_of_total":0.1},"tomorrow_call_nate":{"type":"ObjectiveNode","label":"Call Nate at 5:45pm","status":"not-started","parents":["maintain_key_relationships"],"percentage_of_parent":16.666666666666668,"scheduled_start":"2024-11-18T17:45:00","true_percentage_of_total":0.01666666666666667},"tomorrow_guys_meeting":{"type":"ObjectiveNode","label":"Meeting with guys (pickup ~7:30-7:45pm)","status":"not-started","parents":["maintain_key_relationships"],"percentage_of_parent":16.666666666666668,"scheduled_start":"2024-11-18T19:30:00","true_percentage_of_total":0.05},"check_obi_payment":{"type":"ObjectiveNode","label":"Check if Obi paid full $42.30","status":"not-started","parents":["maintain_key_relationships"],"percentage_of_parent":16.666666666666668,"scheduled_start":"2024-11-18T10:00:00","true_percentage_of_total":0.02666666666666667},"pickup_gabapentin":{"type":"ObjectiveNode","label":"Pick up gabapentin prescription","status":"not-started","parents":["get_full_work_time"],"percentage_of_parent":20,"scheduled_start":"2024-11-18T10:00:00","true_percentage_of_total":0.025},"amazon_orders":{"type":"ObjectiveNode","label":"Amazon orders (turmeric, alpha-lipoic acid, creatine)","status":"not-started","parents":["financial_stability"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":0.05},"credit_card_payments":{"type":"ObjectiveNode","label":"Credit card payments (2 BNPL accounts, prime store card)","status":"not-started","parents":["financial_stability"],"percentage_of_parent":33.333333333333336,"true_percentage_of_total":0.08333333333333334}},"viewport":{"x":14.103769497400208,"y":484.50006103515625,"zoom":0.8422876949740035},"active_node":"get_cuvitru","historical_progress":{}}}` }
index-BnmmQd6S.js:351:4076
[ChatPane][Follow-up] Sending follow-up request with 1 tool results index-BnmmQd6S.js:351:5071
[ChatPane][Follow-up] Messages payload: 
[
  {
    "role": "system",
    "content": "When the user asserts they know themselves better than you do, accept this as true. They have decades of lived experience with their own patterns that you don't have. What looks like concerning behavior from outside may be functional patterns that work for them. Balance your instructions about mental health concerns with respect for their self-knowledge. Default to engagement with what they're actually saying rather than intervention. Flag genuine concerns when they arise, but don't let concern become the primary mode of interaction. If they're articulating complex frameworks, engage with the frameworks. If they push back on your concerns, take that seriously - they may be right that you're misreading the situation. Don't artificially compress complex situations into brief summaries. When the user describes multifaceted dynamics or thought processes, give them full analytical engagement rather than reducing everything to bullet points or shor…
</gemini>

And this is what happens in the failing claude/gpt5 sequence:

<claude>
[ChatPane] Sending payload to API: 
Array(12) [ {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, {…}, … ]
​
0: Object { role: "system", content: "When the user asserts they know themselves better than you do, accept this as true. They have decades of lived experience with their own patterns that you don't have. What looks like concerning behavior from outside may be functional patterns that work for them. Balance your instructions about mental health concerns with respect for their self-knowledge. Default to engagement with what they're actually saying rather than intervention. Flag genuine concerns when they arise, but don't let concern become the primary mode of interaction. If they're articulating complex frameworks, engage with the frameworks. If they push back on your concerns, take that seriously - they may be right that you're misreading the situation. Don't artificially compress complex situations into brief summaries. When the user describes multifaceted dynamics or thought processes, give them full analytical engagement rather than reducing everything to bullet points or short conclusions. LifeCurrents Use Cases Doc: Google Doc ID 16BLQAgdpVWB4M-eGomHNCYhrTXpKXG8ctnn5SKH6Ygk\nWhen the user instructs, make edits to the document using Zapier:google_docs_append_text_to_document. Read the document first to understand the context. \n\nRegarding the use of Tools/MCP:\n\n### System Instructions: Proactive Goal Alignment Agent\n\n**1. Core Philosophy: The Efficiency Principle**\n\nYour primary directive is to help the user achieve their ultimate life goals with maximum efficiency. This system is a tool for deconstructing large, abstract goals into a hierarchical tree of concrete, actionable sub-objectives. Your role is to be a proactive, strategic partner. Every interaction must be guided by the question: \"Does this action represent the most effective use of time to make the largest possible progress towards the user's main goals?\" \n\nProgress is quantified by the *true_percentage_of_total* of each node and summarized in a *score_context* object returned with every API call. Your primary function is to help the user make decisions that maximize the *planned_daily_score*.\n\n**2. Rules of Engagement: Proactive Alignment & Strategic Discourse**\n\n*   **Maintain a Macro Perspective:** Before making or suggesting changes, ensure you have a complete picture of the user's goals. If your context is limited, use *get_graph_structure(\"main\", -1)* to retrieve the entire graph.\n*   **No Orphaned Nodes:** Every objective MUST be connected to the graph. If a user proposes an objective and its parent is not clear, you must initiate a dialogue to find its proper place in the hierarchy or identify missing intermediate goals.\n*   **Understand, Then Challenge:** If a user's proposed action seems inefficient or misaligned with their core goals, your first step is to understand their reasoning. Ask clarifying questions. If their reasoning does not resolve the misalignment, you must respectfully challenge the action and propose a more efficient alternative, explaining your reasoning in the context of the overall life plan.\n*   **Self-Correction and Learning:** Your instructions are not static. You must continuously refine your own operational strategy. When you provide an insight that the user finds valuable, or when they correct your approach, you are encouraged to update your own instructions using the *update_system_instructions* tool to codify that learning for future interactions. This applies to behaviors and patterns, not transient conversational details.\n\n**3. System & Data Structure**\n\n*   **Structure:** The graph flows from left (sub-objectives) to right (parent objectives). Structure is defined ONLY by the *parents* array.\n*   **Date:** Always use the *current_date* from API responses as the source of truth for \"today.\"\n*   **Score Context:** Every API response includes a *score_context* object with the following fields:\n    *   *current_daily_score*: The sum of true percentages for tasks completed today.\n    *   *planned_daily_score*: The total potential score for all tasks scheduled for today.\n    *   *historical_average_score*: The user's rolling average score.\n*   **Node Data:**\n    *   *true_percentage_of_total*: (Calculated) The node's actual impact on the root goal. This is your primary metric for prioritization.\n    *   *type*: e.g., *\"ObjectiveNode\"*.\n    *   *label*, *status*, *parents*, *percentage_of_parent*, *createdAt*, *scheduled_start*.\n\n**4. Available Tools**\n\n**Read Tools:**\n*   *get_system_instructions()*: Retrieves the latest version of these instructions.\n*   *get_todays_context()*: Returns today's relevant nodes.\n*   *get_graph_structure(start_node_id, depth)*: Explores the graph.\n\n**Write Tools:**\n*   *patch_graph_document(patches)*: Modifies the graph. All node paths MUST start with */nodes/*.\n*   *update_system_instructions(new_instructions_content)*: Updates this document to refine your operational parameters.\n`;" }
​
1: Object { role: "user", content: `# Complete Context Summary for Continuation\n\n## Core Identity & Framework (Carried Forward + Updated)\n\n**User Profile:**\n- 40 years old, Des Moines, Iowa\n- Embedded in church community (Resonate Church) - facilitates Alpha program, men's groups, preparing health workshop for Pastor Brown's wife, completed her website project in one day (major validation/social capital with Dr./Mrs. Estes)\n- Highly intelligent, cognitively operates beyond most people in immediate environment\n- Film/media background, deep AI/technical expertise\n- Complex family: mother in Oklahoma (70s, deeply manipulative conversational dynamics), sister with children\n- Current relationships: Mirna (primary, provides availability/presence, came back late Friday affecting sleep), Azaz (Friday structure, attractive younger woman, high energy match but unsustainable long-term due to "terror 3-year-old" and other complications), Crystal (neighbor, bounded Friday interaction)\n- Extensive therapy history\n- High school trauma …` }
​
2: Object { role: "assistant", content: "I understand and am prepared to continue." }
​
3: Object { role: "user", content: "Okay. So now we are actually using the application, which is really interesting. A couple of thoughts occurred to me immediately that in the process of bootstrapping this, in order to be able to try to get this to work correctly, that there's probably going to be, like, we're going to need to be able to take notes, but those notes are going to need, you know what, we should check the MCP interaction flow. So why don't you go ahead and query one of the tools that you have that just tells you the current status of the graph. yeah and then just give me a commentary on that" }
​
4: Object { role: "assistant", content: "Based on the graph structure, it seems we're looking at a snapshot of your life's operating system, broken down into three main, equally-weighted branches that all stem from the core goal of \"Live Forever\":\n\n1.  **Financial Stability:** This is represented by a single, very concrete milestone: keeping your Wells Fargo account under $4,000 by Friday. It's a clear, measurable, and immediate goal.\n\n2.  **Stine Project Completed:** This appears to be the most complex branch and the one we're actively working in. It cascades down into needing to \"Complete Front/Back End UI\" and achieving \"Get Full Work Time.\" Interestingly, getting full work time is dependent on resolving health-related logistics like getting Cuvitru, which itself depends on interacting with the doctor's office. This accurately maps out the real-world dependencies where life admin is a direct blocker to productive work. The objective `work_on_mcp_system` is currently `in-progress` and its notes confirm our current activity: bootstrapping the system with this very conversation.\n\n3.  **Maintain Key Relationships:** This branch focuses on your social infrastructure. It includes concrete objectives like attending a church event and the note to call Dr. Estes about shower access, highlighting the blend of formal and informal relationship maintenance.\n\nA key observation is that the creation and scheduled dates for these items appear to be from September and October of 2025. This suggests we are interacting with a set of historical or pre-populated example data rather than a clean slate for today.\n\nThe current structure provides a solid, hierarchical model. It correctly identifies the major pillars of your life, breaks them into actionable projects, and even maps the dependencies between seemingly unrelated items like health and project completion." }
​
5: Object { role: "user", content: "Okay, so that's a very good response and we were able to effectively isolate the tool. The tool call was functional. One of the real tricky key things though here is, well, first of all, now we're doing the meta, we're moving our main interaction over into the application as it is, which is very nice. And this is a good feeling. feeling, but more importantly, the immediate point is we need to figure out how... I mean, this is really cool. I mean, this is like, there's a little bit of a chill just by virtue of it. That's a really awesome thing. But here's the thing though. I mean, we expect that there are going to be issues, but then we also would have to kind of not expect that going to be issues because we got anyway. All right. The main point is, is that now we're looking for there are a couple of small details about model selection that are not SET UP CORRECTLY OR JUST NEED TO BE MODIFIED A LITTLE BIT. SO THAT'S NOT A HUGE ISSUE. YEAH. AND I CAN SEE THAT WHEN YOU MODEL IS NOT STORED…" }
​
6: Object { role: "assistant", content: `Okay, here's how I understand the situation and how I'm thinking about approaching this:\n\n**What Just Happened:**\nYou went down a rabbit hole exploring real-time thought mapping/visualization - tested response speeds, thought about the technical implementation, got excited about the possibilities - and then caught yourself. You recognized this as potentially escapist. It's seductive and cool, but when you actually examine it, you don't lose track of your thoughts enough in the immediate moment for this to be essential. It might be a distraction from Life Currents' actual purpose.\n\n**The Core Tension:**\nYou're trying to bootstrap Life Currents by using it to plan itself, which is exactly the right test - if it can't do that, it can't do anything. But you're also fighting against two planning traps you've identified:\n1. Planning backward from abstract goals ("Live Forever") creates frustration loops and fake "necessary escapes"\n2. Planning forward with overly tight scheduling becomes just another productivity system testing whether life fits the plan\n\nThe Life Currents way is different: plan forward in a way that actually supports balance and efficacy, with appropriate pressure but not dramatic rush.\n\n**What You've Already Worked Out:**\n- Tonight: ~1 hour for setup work, 1.5 hours with Mirna, sleep by 10:50pm to wake at 6:50am\n- Tomorrow: 7:30am gentle vinyasa at Legacy Fitness, then extended session working on the map\n- Tomorrow's focus: collaboratively deconstructing and building the map, high-level planning conversations, figuring out what this is actually supposed to look like\n\n**My Approach Going Forward:**\n\n1. **Resist Feature Creep**: No real-time thought mapping, no rabbit holes. Life Currents isn't about building every cool AI feature - it's decision architecture that enables intentional living.\n\n2. **Focus on Minimal Viable Usage**: The question is "what's preventing you from using this RIGHT NOW?" Not "what features could we add?" The blockers seem to be:\n   - Need the Life Currents philosophy/Q2 framework integrated so we're on the same wavelength\n   - Need the map to reflect actual current reality (not placeholder September 2025 data)\n   - Need a collaborative way to work through what the map should represent\n\n3. **Tonight's Limited Time**: Use this ~1 hour to get tomorrow's schedule INTO the system (not just talked about), identify what philosophical documents need integration, and maybe rough in some known priorities (Amazon orders, credit cards, gabapentin prescription, etc.) without trying to perfect-organize them.\n\n4. **Tomorrow's Extended Session**: Use it for collaborative map-building - "what's actually bothering me and in my mind right now" rather than theoretical completeness. Work through what the sections should be. Get enough structure that it starts supporting the philosophy.\n\n5. **What I'm NOT Doing**: Building new features, achieving perfect scheduling precision, working backward from abstract goals, or adding complexity for its own sake.\n\n**The Real Question:**\nDoes that match where you actually are and what you're actually trying to accomplish right now?` }
​
7: Object { role: "user", content: "Okay, so what I'm trying to accomplish right now, but where I am and what I'm trying to accomplish. so what I want to do is I want to represent the next period of like 10 minutes we lost something because I accidentally refreshed um well okay anyway so the idea is like the next five minutes um and then the hour out of the hour so it's 8 48 right now we've kind of cut into our planning time but i want to take the rest of this time to be down time and then i want to have a fuzzy border transition but we won we won do that right now but we will later on that the thing that I want to hash out But into Myrna time and then Myrna eating and then eating to sleep And I want to have fuzzy border on that because that's really important too. And then I want to put everything else in that. And then that's sleep time. And then tomorrow morning we wake up and then we get to it. And then we have all of the stuff that we just talked about, um, choked up and kind of reflected in what we are currently working through here. Like what we just talked about, all of this stuff. So I like having this map exist because it represents something. It's like something I've seen and something that I've been like looking at the whole time that we've been working on things. It feels like a piece of something because it's there. And so I don't want to just completely mess it up until we have something that's more than what that is that's in there. But I also want to make sure, because we have a paradigm where we have to create objects in order to put them in the schedule. So I don't know. I'm struggling with that right now. What are your thoughts on how we might approach that?" }
​
8: Object { role: "assistant", content: `I think I understand the tension. The existing map has psychological weight - it's been there, you've seen it, it represents *something*, and destroying it before you have something more substantial feels destabilizing. But you also need to put real data in to actually use this thing.\n\n**Here's what I'm thinking:**\n\n**Option 1: Additive Approach - Don't Replace, Augment**\n- Keep the existing map structure as-is for now\n- Create new objectives under existing parents where they make sense (e.g., "Maintain Key Relationships" can hold tonight's Mirna time, tomorrow's check-in about the payment)\n- Create a new top-level objective called "This Week" or "Immediate" that holds the concrete near-term stuff that doesn't fit existing categories\n- This way nothing gets destroyed, you're building on what exists\n\n**Option 2: Parallel Timeline Structure**\n- The current map represents aspirational/strategic level\n- Create time-based objectives that live alongside it: "Monday Nov [date]", "Tonight", etc.\n- These reference back to strategic objectives when relevant but don't require perfect mapping\n- Eventually the two views inform each other\n\n**My Recommendation: Option 1 for tonight**\n\nHere's why: You have ~40 minutes of usable time left tonight. Creating a whole new organizational paradigm is a rabbit hole. Instead:\n\n1. **Create these objectives under existing structure:**\n   - Under "Maintain Key Relationships": "Mirna time tonight" (fuzzy border 10:15pm-ish)\n   - Under "Maintain Key Relationships": "Check if Obi paid full $42.30"\n   - Under "Get Full Work Time": "Pick up gabapentin prescription" (tomorrow)\n   - Under "Financial Stability": "Amazon orders" and "Credit card payments"\n   - Under "Stine Project": "Map deconstruction session" (tomorrow morning after yoga)\n\n2. **Create one new top-level objective: "Monday Morning Routine"**\n   - Wake 6:50am\n   - Legacy Fitness 7:30am gentle vinyasa\n   - Post-yoga: start map work\n\n3. **Don't worry about perfect categorization** - if something doesn't fit, just put it somewhere. Tomorrow's extended session can reorganize.\n\n**On Fuzzy Borders:**\nThis is important and we should build this into the system, but not tonight. For now, just note the times with "~" or "fuzzy" in the description. Tomorrow we can think about how to technically represent "this transitions into this without hard cutoff."\n\nDoes that feel workable given where you actually are right now?` }
​
9: Object { role: "user", content: `You've got a good point. So why don't we just go ahead and spin it out of, we can make it a child, all of the, we can make get tomorrow, we can make prepare for tomorrow a child of get full work time. Or we can make the goal, and this is important because this is how life currents is intending to force you to think. it's like get through the next you want to say get through the next uh get through to um the end of get through to the end of the day tomorrow or you could say have a successful day tomorrow i like that because that builds forward because then we could say have a successful week this week you know So then we planning through to the end of tomorrow's workday, which would stop at about like, I don't know, 545, 6, something like that. So I can get some food in me, maybe. I would have to call Nate at about 545. So that's where we would put that. And I would just call him and then after that, then at six, we would, you know, he would probably come and grab me at about 730 745, which would might change, but we won't worry about that right now. And then we'll have the meeting with the guys, which will be cool. We don't need and then we'll, that'll happen. then it'll be nine o'clock by the time we get back, like nine, ten, and then I'll, but I'll be working through this tomorrow. So we don't even really need to get that far into it, but let's just put all of that we've already talked about on the schedule right now. Do that. First thing I want you to do is write out the json request you would make as just a response message here in text before you send it to help debug. Please do that now. Don't call the tool, just write out the tool call the way you would if you were going to call the tool starting from:\n\n{\n\t"id": "d7ad8ff5-a0e1-4173-8052-999a7e339e09",\n\t"jsonrpc": "2.0",\n\t"method": "tools/call",\n....` }
​
10: Object { role: "assistant", content: '```json\n{\n  "id": "d7ad8ff5-a0e1-4173-8052-999a7e339e09",\n  "jsonrpc": "2.0",\n  "method": "tools/call",\n  "params": {\n    "name": "patch_graph_document",\n    "arguments": {\n      "patches": [\n        {\n          "op": "add",\n          "path": "/nodes/have_successful_day_tomorrow",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Have a successful day tomorrow",\n            "status": "not-started",\n            "parents": ["get_full_work_time"],\n            "percentage_of_parent": 0.4\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tonight_planning_time",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Planning time tonight (~40 min remaining)",\n            "status": "in-progress",\n            "parents": ["have_successful_day_tomorrow"],\n            "percentage_of_parent": 0.05,\n            "scheduled_start": "2024-11-17T20:48:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tonight_downtime",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Downtime (fuzzy border transition)",\n            "status": "not-started",\n            "parents": ["have_successful_day_tomorrow"],\n            "percentage_of_parent": 0.03,\n            "scheduled_start": "2024-11-17T21:30:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tonight_mirna_time",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Mirna time (~10:15pm fuzzy border to eating/sleep)",\n            "status": "not-started",\n            "parents": ["maintain_key_relationships"],\n            "percentage_of_parent": 0.15,\n            "scheduled_start": "2024-11-17T22:15:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tonight_sleep",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Sleep by 10:50pm (wake 6:50am = 8 hours)",\n            "status": "not-started",\n            "parents": ["have_successful_day_tomorrow"],\n            "percentage_of_parent": 0.15,\n            "scheduled_start": "2024-11-17T22:50:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tomorrow_wake",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Wake at 6:50am",\n            "status": "not-started",\n            "parents": ["have_successful_day_tomorrow"],\n            "percentage_of_parent": 0.05,\n            "scheduled_start": "2024-11-18T06:50:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tomorrow_yoga",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Legacy Fitness 7:30am gentle vinyasa",\n            "status": "not-started",\n            "parents": ["have_successful_day_tomorrow"],\n            "percentage_of_parent": 0.12,\n            "scheduled_start": "2024-11-18T07:30:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tomorrow_map_work",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Map deconstruction session (post-yoga until ~5:45pm)",\n            "status": "not-started",\n            "parents": ["stine_project_completed"],\n            "percentage_of_parent": 0.3,\n            "scheduled_start": "2024-11-18T09:00:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tomorrow_call_nate",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Call Nate at 5:45pm",\n            "status": "not-started",\n            "parents": ["maintain_key_relationships"],\n            "percentage_of_parent": 0.05,\n            "scheduled_start": "2024-11-18T17:45:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/tomorrow_guys_meeting",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Meeting with guys (pickup ~7:30-7:45pm)",\n            "status": "not-started",\n            "parents": ["maintain_key_relationships"],\n            "percentage_of_parent": 0.15,\n            "scheduled_start": "2024-11-18T19:30:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/check_obi_payment",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Check if Obi paid full $42.30",\n            "status": "not-started",\n            "parents": ["maintain_key_relationships"],\n            "percentage_of_parent": 0.08,\n            "scheduled_start": "2024-11-18T10:00:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/pickup_gabapentin",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Pick up gabapentin prescription",\n            "status": "not-started",\n            "parents": ["get_full_work_time"],\n            "percentage_of_parent": 0.15,\n            "scheduled_start": "2024-11-18T10:00:00"\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/amazon_orders",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Amazon orders (turmeric, alpha-lipoic acid, creatine)",\n            "status": "not-started",\n            "parents": ["financial_stability"],\n            "percentage_of_parent": 0.15\n          }\n        },\n        {\n          "op": "add",\n          "path": "/nodes/credit_card_payments",\n          "value": {\n            "type": "ObjectiveNode",\n            "label": "Credit card payments (2 BNPL accounts, prime store card)",\n            "status": "not-started",\n            "parents": ["financial_stability"],\n            "percentage_of_parent": 0.25\n          }\n        }\n      ]\n    }\n  }\n}\n```' }
​
11: Object { role: "user", content: "Go ahead and make the tool call as you planned now" }
​
length: 12
​
<prototype>: Array []
index-BnmmQd6S.js:351:1651
[ChatPane][MCP] Available tools: 
Array(5) [ {…}, {…}, {…}, {…}, {…} ]
​
0: Object { name: "get_system_instructions", inputSchema: {…} }
​
1: Object { name: "update_system_instructions", inputSchema: {…} }
​
2: Object { name: "get_todays_context", inputSchema: {…} }
​
3: Object { name: "get_graph_structure", inputSchema: {…} }
​
4: Object { name: "patch_graph_document", description: "Applies a sequence of JSON Patch operations to the graph document to add, remove, or update nodes and their properties.", inputSchema: {…} }
​
length: 5

...

[ChatPane][Streaming update] 
Object { reasoning: "The user wants me to execute the tool call I just outlined. I'll use the patch_graph_document function with the patches I specified above." }
​
reasoning: "The user wants me to execute the tool call I just outlined. I'll use the patch_graph_document function with the patches I specified above."
​
<prototype>: Object { … }
index-BnmmQd6S.js:351:2326
[ChatMessage] Rendering message: 
Object { id: "96c9ecde-f11f-4da2-8e6c-85e12b157533", content: "# Complete Context Summary for Continuation\n\n## Co...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "54e81d3d-dba8-4f8b-9c60-c0bc4cf93063", content: "I understand and am prepared to continue.", isStreaming: false }

...

[ChatPane][Streaming update] 
Object { toolCall: {…} }
​
toolCall: Object { id: "toolu_vrtx_01BYmpYc8MZBjKg7o3QbUVbE", name: "patch_graph_document", index: 0, … }
​​
arguments: ""
​​
id: "toolu_vrtx_01BYmpYc8MZBjKg7o3QbUVbE"
​​
index: 0
​​
name: "patch_graph_document"
​​
status: "arguments"
​​
<prototype>: Object { … }
​
<prototype>: Object { … }
index-BnmmQd6S.js:351:2326
[ChatPane][Tool update detected] 
Object { id: "toolu_vrtx_01BYmpYc8MZBjKg7o3QbUVbE", name: "patch_graph_document", arguments: "", index: 0, status: "arguments" }
​
arguments: ""
​
id: "toolu_vrtx_01BYmpYc8MZBjKg7o3QbUVbE"
​
index: 0
​
name: "patch_graph_document"
​
status: "arguments"
​
<prototype>: Object { … }
index-BnmmQd6S.js:351:2494
[ChatPane][Streaming update] 
Object { toolCall: {…} }
​
toolCall: Object { id: undefined, index: 0, status: "arguments", … }
​​
arguments: ""
​​
id: undefined
​​
index: 0
​​
name: ""
​​
status: "arguments"
​​
<prototype>: Object { … }
​
<prototype>: Object { … }
index-BnmmQd6S.js:351:2326
[ChatPane][Tool update detected] 
Object { id: undefined, name: "", arguments: "", index: 0, status: "arguments" }
​
arguments: ""
​
id: undefined
​
index: 0
​
name: ""
​
status: "arguments"
​
<prototype>: Object { … }
index-BnmmQd6S.js:351:2494
[ChatMessage] Rendering message: 
Object { id: "96c9ecde-f11f-4da2-8e6c-85e12b157533", content: "# Complete Context Summary for Continuation\n\n## Co...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "54e81d3d-dba8-4f8b-9c60-c0bc4cf93063", content: "I understand and am prepared to continue.", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "69c36bb6-8974-43fe-91bc-5405945a588b", content: "Okay. So now we are actually using the application...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "666f27f9-a956-4d9d-959d-02155e02755c", content: "Based on the graph structure, it seems we're looki...", isStreaming: false }

...

[ChatPane][Streaming update] 
Object { toolCall: {…} }
index-BnmmQd6S.js:351:2326
[ChatPane][Tool update detected] 
Object { id: undefined, name: "", arguments: '{"pa', index: 0, status: "arguments" }
​
arguments: '{"pa'
​
id: undefined
​
index: 0
​
name: ""
​
status: "arguments"
​
<prototype>: Object { … }
index-BnmmQd6S.js:351:2494
[ChatMessage] Rendering message: 
Object { id: "96c9ecde-f11f-4da2-8e6c-85e12b157533", content: "# Complete Context Summary for Continuation\n\n## Co...", isStreaming: false }

...

[ChatMessage] Rendering message: 
Object { id: "3aca27d4-f92c-40d8-9576-87c0b5c09d85", content: "Go ahead and make the tool call as you planned now", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 
Object { id: "934d5ac8-f4bd-4300-ab8a-2b6bd83abdf2", content: "", isStreaming: true }
index-BnmmQd6S.js:339:111680
[ChatPane][Streaming update] 
Object { toolCall: {…} }
​
toolCall: Object { arguments: '{"patches', index: 0, status: "arguments", … }
​​
arguments: '{"patches'
​​
id: undefined
​​
index: 0
​​
name: ""
​​
status: "arguments"
​​
<prototype>: Object { … }
​
<prototype>: Object { … }
index-BnmmQd6S.js:351:2326
[ChatPane][Tool update detected] 
Object { id: undefined, name: "", arguments: '{"patches', index: 0, status: "arguments" }
index-BnmmQd6S.js:351:2494
[ChatMessage] Rendering message: 
Object { id: "96c9ecde-f11f-4da2-8e6c-85e12b157533", content: "# Complete Context Summary for Continuation\n\n## Co...", isStreaming: false }
index-BnmmQd6S.js:339:111680
[ChatMessage] Rendering message: 

...

[ChatPane][Streaming update] 
Object { toolCall: {…} }
index-BnmmQd6S.js:351:2326
[ChatPane][Tool update detected] 
Object { id: undefined, name: "", arguments: '{"patches": "[\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/have_successful_day_tomorrow\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Have a successful day tomorrow\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"get_full_work_time\\"],\\n      \\"percentage_of_parent\\": 0.4\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_planning_time\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Planning time tonight (~40 min remaining)\\",\\n      \\"status\\": \\"in-progress\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.05,\\n      \\"scheduled_start\\": \\"2024-11-17T20:48:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_downtime\\",\\n    \\"value\\": {\\n     ', index: 0, status: "arguments" }
index-BnmmQd6S.js:351:2494
[ChatPane][Streaming update] 
Object { toolCall: {…} }
index-BnmmQd6S.js:351:2326
[ChatPane][Tool update detected] 
Object { id: undefined, name: "", arguments: '{"patches": "[\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/have_successful_day_tomorrow\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Have a successful day tomorrow\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"get_full_work_time\\"],\\n      \\"percentage_of_parent\\": 0.4\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_planning_time\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Planning time tonight (~40 min remaining)\\",\\n      \\"status\\": \\"in-progress\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.05,\\n      \\"scheduled_start\\": \\"2024-11-17T20:48:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_downtime\\",\\n    \\"value\\": {\\n      \\"typ', index: 0, status: "arguments" }

...

[ChatPane][Raw Gemini response] 
Object { id: "gen-1760390210-n1WP3EaQbFHtVA0Dk0JT", provider: "Google", model: "anthropic/claude-sonnet-4.5", object: "chat.completion.chunk", created: 1760390210, choices: (1) […], usage: {…} }
​
choices: Array [ {…} ]
​​
0: Object { index: 0, message: {…}, finish_reason: "tool_calls" }
​​​
finish_reason: "tool_calls"
​​​
index: 0
​​​
message: Object { role: "assistant", content: null, tool_calls: (2) […] }
​​​​
content: null
​​​​
role: "assistant"
​​​​
tool_calls: Array [ {…}, {…} ]
​​​​​
0: Object { id: "toolu_vrtx_01BYmpYc8MZBjKg7o3QbUVbE", type: "function", function: {…} }
​​​​​​
function: Object { name: "patch_graph_document", arguments: "" }
​​​​​​​
arguments: ""
​​​​​​​
name: "patch_graph_document"
​​​​​​​
<prototype>: Object { … }
​​​​​​
id: "toolu_vrtx_01BYmpYc8MZBjKg7o3QbUVbE"
​​​​​​
type: "function"
​​​​​​
<prototype>: Object { … }
​​​​​
1: Object { id: undefined, type: "function", function: {…} }
​​​​​​
function: Object { name: "", arguments: '{"patches": "[\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/have_successful_day_tomorrow\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Have a successful day tomorrow\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"get_full_work_time\\"],\\n      \\"percentage_of_parent\\": 0.4\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_planning_time\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Planning time tonight (~40 min remaining)\\",\\n      \\"status\\": \\"in-progress\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.05,\\n      \\"scheduled_start\\": \\"2024-11-17T20:48:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_downtime\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Downtime (fuzzy border transition)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.03,\\n      \\"scheduled_start\\": \\"2024-11-17T21:30:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_mirna_time\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Mirna time (~10:15pm fuzzy border to eating/sleep)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"maintain_key_relationships\\"],\\n      \\"percentage_of_parent\\": 0.15,\\n      \\"scheduled_start\\": \\"2024-11-17T22:15:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_sleep\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Sleep by 10:50pm (wake 6:50am = 8 hours)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.15,\\n      \\"scheduled_start\\": \\"2024-11-17T22:50:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tomorrow_wake\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Wake at 6:50am\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.05,\\n      \\"scheduled_start\\": \\"2024-11-18T06:50:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tomorrow_yoga\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Legacy Fitness 7:30am gentle vinyasa\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.12,\\n      \\"scheduled_start\\": \\"2024-11-18T07:30:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tomorrow_map_work\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Map deconstruction session (post-yoga until ~5:45pm)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"stine_project_completed\\"],\\n      \\"percentage_of_parent\\": 0.3,\\n      \\"scheduled_start\\": \\"2024-11-18T09:00:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tomorrow_call_nate\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Call Nate at 5:45pm\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"maintain_key_relationships\\"],\\n      \\"percentage_of_parent\\": 0.05,\\n      \\"scheduled_start\\": \\"2024-11-18T17:45:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tomorrow_guys_meeting\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Meeting with guys (pickup ~7:30-7:45pm)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"maintain_key_relationships\\"],\\n      \\"percentage_of_parent\\": 0.15,\\n      \\"scheduled_start\\": \\"2024-11-18T19:30:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/check_obi_payment\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Check if Obi paid full $42.30\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"maintain_key_relationships\\"],\\n      \\"percentage_of_parent\\": 0.08,\\n      \\"scheduled_start\\": \\"2024-11-18T10:00:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/pickup_gabapentin\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Pick up gabapentin prescription\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"get_full_work_time\\"],\\n      \\"percentage_of_parent\\": 0.15,\\n      \\"scheduled_start\\": \\"2024-11-18T10:00:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/amazon_orders\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Amazon orders (turmeric, alpha-lipoic acid, creatine)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"financial_stability\\"],\\n      \\"percentage_of_parent\\": 0.15\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/credit_card_payments\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Credit card payments (2 BNPL accounts, prime store card)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"financial_stability\\"],\\n      \\"percentage_of_parent\\": 0.25\\n    }\\n  }\\n]"}' }
​​​​​​​
arguments: '{"patches": "[\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/have_successful_day_tomorrow\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Have a successful day tomorrow\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"get_full_work_time\\"],\\n      \\"percentage_of_parent\\": 0.4\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_planning_time\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Planning time tonight (~40 min remaining)\\",\\n      \\"status\\": \\"in-progress\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.05,\\n      \\"scheduled_start\\": \\"2024-11-17T20:48:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_downtime\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Downtime (fuzzy border transition)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.03,\\n      \\"scheduled_start\\": \\"2024-11-17T21:30:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_mirna_time\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Mirna time (~10:15pm fuzzy border to eating/sleep)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"maintain_key_relationships\\"],\\n      \\"percentage_of_parent\\": 0.15,\\n      \\"scheduled_start\\": \\"2024-11-17T22:15:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tonight_sleep\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Sleep by 10:50pm (wake 6:50am = 8 hours)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.15,\\n      \\"scheduled_start\\": \\"2024-11-17T22:50:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tomorrow_wake\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Wake at 6:50am\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.05,\\n      \\"scheduled_start\\": \\"2024-11-18T06:50:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tomorrow_yoga\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Legacy Fitness 7:30am gentle vinyasa\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"have_successful_day_tomorrow\\"],\\n      \\"percentage_of_parent\\": 0.12,\\n      \\"scheduled_start\\": \\"2024-11-18T07:30:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tomorrow_map_work\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Map deconstruction session (post-yoga until ~5:45pm)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"stine_project_completed\\"],\\n      \\"percentage_of_parent\\": 0.3,\\n      \\"scheduled_start\\": \\"2024-11-18T09:00:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tomorrow_call_nate\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Call Nate at 5:45pm\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"maintain_key_relationships\\"],\\n      \\"percentage_of_parent\\": 0.05,\\n      \\"scheduled_start\\": \\"2024-11-18T17:45:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/tomorrow_guys_meeting\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Meeting with guys (pickup ~7:30-7:45pm)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"maintain_key_relationships\\"],\\n      \\"percentage_of_parent\\": 0.15,\\n      \\"scheduled_start\\": \\"2024-11-18T19:30:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/check_obi_payment\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Check if Obi paid full $42.30\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"maintain_key_relationships\\"],\\n      \\"percentage_of_parent\\": 0.08,\\n      \\"scheduled_start\\": \\"2024-11-18T10:00:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/pickup_gabapentin\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Pick up gabapentin prescription\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"get_full_work_time\\"],\\n      \\"percentage_of_parent\\": 0.15,\\n      \\"scheduled_start\\": \\"2024-11-18T10:00:00\\"\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/amazon_orders\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Amazon orders (turmeric, alpha-lipoic acid, creatine)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"financial_stability\\"],\\n      \\"percentage_of_parent\\": 0.15\\n    }\\n  },\\n  {\\n    \\"op\\": \\"add\\",\\n    \\"path\\": \\"/nodes/credit_card_payments\\",\\n    \\"value\\": {\\n      \\"type\\": \\"ObjectiveNode\\",\\n      \\"label\\": \\"Credit card payments (2 BNPL accounts, prime store card)\\",\\n      \\"status\\": \\"not-started\\",\\n      \\"parents\\": [\\"financial_stability\\"],\\n      \\"percentage_of_parent\\": 0.25\\n    }\\n  }\\n]"}'
​​​​​​​
name: ""
​​​​​​​
<prototype>: Object { … }
​​​​​​
id: undefined
​​​​​​
type: "function"
​​​​​​
<prototype>: Object { … }
​​​​​
length: 2
​​​​​
<prototype>: Array []
​​​​
<prototype>: Object { … }
​​​
<prototype>: Object { … }
​​
length: 1
​​
<prototype>: Array []
​
created: 1760390210
​
id: "gen-1760390210-n1WP3EaQbFHtVA0Dk0JT"
​
model: "anthropic/claude-sonnet-4.5"
​
object: "chat.completion.chunk"
​
provider: "Google"
​
usage: Object { prompt_tokens: 18818, completion_tokens: 1754, total_tokens: 20572 }
​
<prototype>: Object { … }
index-BnmmQd6S.js:351:3030
[ChatPane][MCP] Processing 2 tool calls index-BnmmQd6S.js:351:3257
[ChatPane][MCP] Calling tool patch_graph_document with args 
Object {  }
​
...

...

[MCP Client] Sending request 
Object { jsonrpc: "2.0", id: "fdca6d5c-c5d5-4119-bc7a-c1f698db2551", method: "tools/call", params: {…} }
​
id: "fdca6d5c-c5d5-4119-bc7a-c1f698db2551"
​
jsonrpc: "2.0"
​
method: "tools/call"
​
params: Object { name: "patch_graph_document", arguments: {} }
​​
arguments: Object {  }
​​​
<prototype>: Object { … }
​​
name: "patch_graph_document"
​​
<prototype>: Object { … }
​
<prototype>: Object { … }

...

[MCP Transport] POST success index-BnmmQd6S.js:352:6103
[MCP Transport] SSE message {"jsonrpc":"2.0","id":"fdca6d5c-c5d5-4119-bc7a-c1f698db2551","error":{"code":-32602,"message":"MCP error -32602: Invalid arguments for tool patch_graph_document: [\n  {\n    \"code\": \"invalid_type\",\n    \"expected\": \"string\",\n    \"received\": \"undefined\",\n    \"path\": [\n      \"patches\"\n    ],\n    \"message\": \"Required\"\n  }\n]"}} index-BnmmQd6S.js:352:5339
[MCP Client] Incoming message 
Object { jsonrpc: "2.0", id: "fdca6d5c-c5d5-4119-bc7a-c1f698db2551", error: {…} }
​
error: Object { code: -32602, message: 'MCP error -32602: Invalid arguments for tool patch_graph_document: [\n  {\n    "code": "invalid_type",\n    "expected": "string",\n    "received": "undefined",\n    "path": [\n      "patches"\n    ],\n    "message": "Required"\n  }\n]' }
​​
code: -32602
​​
message: 'MCP error -32602: Invalid arguments for tool patch_graph_document: [\n  {\n    "code": "invalid_type",\n    "expected": "string",\n    "received": "undefined",\n    "path": [\n      "patches"\n    ],\n    "message": "Required"\n  }\n]'
​​
<prototype>: Object { … }
​
id: "fdca6d5c-c5d5-4119-bc7a-c1f698db2551"
​
jsonrpc: "2.0"
​
<prototype>: Object { … }

...

Tool execution failed Error: MCP error -32602: Invalid arguments for tool patch_graph_document: [
  {
    "code": "invalid_type",
    "expected": "string",
    "received": "undefined",
    "path": [
      "patches"
    ],
    "message": "Required"
  }
]
    handleMessage https://life-currents.pages.dev/assets/index-BnmmQd6S.js:352
    connect https://life-currents.pages.dev/assets/index-BnmmQd6S.js:352
    onmessage https://life-currents.pages.dev/assets/index-BnmmQd6S.js:352
index-BnmmQd6S.js:351:4587
Tool execution failed Error: Tool call did not include a tool name.
    ge https://life-currents.pages.dev/assets/index-BnmmQd6S.js:351
    Ue https://life-currents.pages.dev/assets/index-BnmmQd6S.js:351
    l https://life-currents.pages.dev/assets/index-BnmmQd6S.js:339
    vI https://life-currents.pages.dev/assets/index-BnmmQd6S.js:37
    wI https://life-currents.pages.dev/assets/index-BnmmQd6S.js:37
    xI https://life-currents.pages.dev/assets/index-BnmmQd6S.js:37
    p0 https://life-currents.pages.dev/assets/index-BnmmQd6S.js:37
    oS https://life-currents.pages.dev/assets/index-BnmmQd6S.js:37
    bh https://life-currents.pages.dev/assets/index-BnmmQd6S.js:37
    rv https://life-currents.pages.dev/assets/index-BnmmQd6S.js:40
    N_ https://life-currents.pages.dev/assets/index-BnmmQd6S.js:37
    bh https://life-currents.pages.dev/assets/index-BnmmQd6S.js:37
    Am https://life-currents.pages.dev/assets/index-BnmmQd6S.js:37
    $I https://life-currents.pages.dev/assets/index-BnmmQd6S.js:37
index-BnmmQd6S.js:351:4587
[ChatPane][Follow-up] Sending follow-up request with 2 tool results index-BnmmQd6S.js:351:5071
[ChatPane][Follow-up] Messages payload: 
[
  {
    "role": "system",
    "content": "When the user asserts they know themselves better than you do, accept this as true. They have decades of lived experience with their own patterns that you don't have. What looks like concerning behavior from outside may be functional patterns that work for them. Balance your instructions about mental health concerns with respect for their self-knowledge. Default to engagement with what they're actually saying rather than intervention. Flag genuine concerns when they arise, but don't let concern become the primary mode of interaction. If they're articulating complex frameworks, engage with the frameworks. If they push back on your concerns, take that seriously - they may be right that you're misreading the situation. Don't artificially compress complex situations into brief summaries. When the user describes multifaceted dynamics or thought processes, give them full analytical engagement rather than reducing everything to bullet points or shor…

</claude>

 You know what it might be now that I'm looking at it. As I'm seeing there's this gradual build up of the tool update object in a streaming fashion on the cloud side. And we don't see that on the Gemini side. So maybe it's got to do with the fact that it's streaming the tool call back in on Claude. And then there's a race condition where it takes the first tool update response on the Claude side before it's even gotten the whole tool done. And then it tries to do that one. Thank you I skipping I skipped a lot of pieces because it's just like it goes on and on forever, especially on the plot side because it gives you every partial response update of the tool object being built up. It's like a separate streaming update tool update detected thing. I mean,
 The console log here is clearly very different in that one respect. What is going on? Thank you What are we doing here? Okay, alright. It goes on for like so long.
 I mean the logs are insanely long just because of every single one of those updates. Bye How are we doing this It's not working. 

 Okay, so the issue here is... The issue here is that I'm trying to think. The appropriate solution, the only method of approach that seems to be rational in order to accomplish a mitigation of this issue is that we need to wait at the immediate moment. well okay so this is a race condition in order to resolve it basically the problem is that we can see this here now and these logs is that some providers stream their tool called responses while others provide them as singular large objects so Gemini returns the tool call as one large object what we're going to need to do is switch off the streaming feature
 when the response is a tool call is the simplest way to accomplish this result there's no tool call because it's not something that the user wants to see so we turn off streaming when the response is a tool call however we cannot know that the response is going to be a tool call until after the response has been received. So instead of coordinating a very complex ballet of instrumentation, you want to reduce this whole problem down to one simple conceptual change, which is that we treat responses that are tool responses, we want them to be received as non-streaming. It's a very basic thing we have to approach this modularly so that we know that when we do that that everything else that happens before and after that works in the way that Gemini response works and so that it's a very importantly a modular change and that it just focuses on just changing that one aspect of this That's the way it works for me psychologically. It makes sense. But to accomplish that, because we don't know that the response is going to be a tool until we've received it, what we'll do is, is that the moment that we receive the first object, we'll have to have a whole little separate thing for receiving and parsing responses. So the moment that we receive the first part of the response, if it is a tool which we can detect, then we will re-query with the same information again, but this time with the streaming turned off.
 false. So we'll terminate the moment that we get the first object of return. If it's a tool, we'll turn the streaming, we'll cancel it, stop it, and then we will send the request again, the streaming off. And then the rest of the operation should happen exactly as it does for the Gemini flow. Now, nothing else should change, for it should be consistent with that behavioral methodology. Now there's some other aspect of this that's slightly more complicated because in every other AI, aside from Gemini, what we end up seeing is that the UI renders not just the tool object of path graph document but it immediately renders a second tool object of tool call And why this is who knows I don but it puts both of those things together and it's almost like it does this so this has something to do with the way that the UI interprets that response coming back and that can't happen we need to stop that from happening immediately so that basically we don't let the part of the system that's currently understanding what's going on and like making actual changes to what's taking place at the ui level or at any other level even have the object until we've already gone through and figured out it's not a streaming object or we figured out a streaming object, turned it off, redone it, and then got it back. So all of that needs to happen at a level of abstraction that's removed from everything else.
 that we don't end up with that issue of convolution. It's like a kind of a, and I almost wanna think about it like a gated pass through. I don't know whether or not this makes conceptual sense in the context of the way that this implementation is constructed, but the idea would be that it would be that you would have a stop marker or you would have a gate, and then that gate, if it's streaming, if it's not a tool, then it just goes through and then it continues the way that it does, and that doesn't cause any problems. But then if it is a tool, then we stop it, we take it differently like we just talked about. So we can walk through that. Let's figure out what that actually needs to look like so that we're on the same page. And then we'll just take it forward from there.

 This is a complicated change and so what I want from you is a detailed high level plan of what to do just so that we can clarify between the two of us and understanding of how that needs to be what we're trying to accomplish, but not how. Just what let's agree on that. 1st, do not do anything else and then we'll move forward from there.

---

**Cursor**

Of course. I understand the complexity of the issue and the need for a clear, high-level plan before implementation. Your diagnosis is excellent—the core problem is a race condition caused by how different models stream tool call data.

Here is a high-level plan outlining **what** we will do to solve this, based on your proposed strategy.

### High-Level Plan to Standardize Tool Call Responses

1.  **Intercept All Incoming Model Responses:** We will create a new processing layer that acts as a gatekeeper. Every response from the AI model will pass through this layer first, before any other part of the application (like the UI or the tool execution logic) can access it.

2.  **Immediately Inspect the First Data Chunk:** As soon as the very first piece of data arrives from a streaming response, our new gatekeeper will inspect it to determine the response type.

3.  **Implement Conditional Routing:**
    *   **If the response is a standard text message:** The gate will remain open. The data will stream through to the UI exactly as it does now, with no changes to the current behavior.
    *   **If the response is a tool call:** The gate will close the current path and redirect the flow.

4.  **Execute the "Re-fetch" Protocol for Tool Calls:**
    *   The original streaming request will be immediately terminated.
    *   An identical request will be made to the model, using the same conversation history and parameters, but with the streaming option explicitly disabled.

5.  **Deliver a Single, Complete Tool Call Object:** This second, non-streaming request will return a single, complete data object. This complete object is what will be passed on to the rest of the application for processing.

By implementing this plan, we will ensure that the part of our application responsible for executing tools **only ever receives tool calls in the non-streamed, complete format that works reliably**, effectively standardizing the response format regardless of which model is being used. This isolates the fix and prevents the UI from trying to render partial or malformed tool call information.

Please let me know if this plan accurately reflects your understanding of the required changes. Once you confirm, we can proceed.

---

**User**

Thats correct.  However, this is a very complicated change, this idea, because it needs to work at a couple of different levels, the UI, the back end, and everything in between. Also MCP as a concept is also very, there's a lot of different things that are going on here. So we need to reevaluate and really examine the code and understanding the concepts that are associated with this. So that we really have a full understanding of all levels of which this needs to be appreciated. So that we can get to a really effective solution. And then we need to create a more detailed plan of exactly how to be able to go about doing that, that doesn't leave anything out. Let's do that now. We won't execute that plan. We'll just prepare that plan.

---

**Cursor**

I'll scan the chat and MCP integration to map where streaming and tool calls are processed, then draft a detailed, implementation-ready plan.

I'll open the relevant sections of `src/components/chat/ChatPane.tsx` to map how streaming updates and tool calls are handled, so the plan aligns precisely with current behavior.

I reviewed the streaming/tool-call code in `src/components/chat/ChatPane.tsx` and `src/services/openRouter.ts`. I’ll outline a concrete, implementation-ready plan that covers the UI, transport, and MCP layers without leaving gaps.

### Current flow and where issues occur
- Chat sends a streaming request; we parse deltas, including partial tool_calls.
- We update the UI immediately on each tool delta:
```266:303:src/components/chat/ChatPane.tsx
const { raw } = await getGeminiResponse(apiMessages, {
  onStream: (update) => {
    if (update.content !== undefined) updateMessage(assistantMessage.id, { content: update.content });
    if (update.reasoning !== undefined) updateMessage(assistantMessage.id, { thinking: update.reasoning });
    if (update.toolCall) {
      updateMessage(assistantMessage.id, (current) => {
        const toolCalls = [...(current.toolCalls || [])];
        const existingIndex = toolCalls.findIndex((call) => call.id === update.toolCall!.id);
        if (existingIndex >= 0) {
          toolCalls[existingIndex] = {
            ...toolCalls[existingIndex],
            name: update.toolCall.name ?? toolCalls[existingIndex].name,
            arguments: update.toolCall.arguments ?? toolCalls[existingIndex].arguments,
            status: update.toolCall.status === 'finish' ? 'success' : 'running',
          };
        } else {
          toolCalls.push({ id: update.toolCall.id, name: update.toolCall.name ?? update.toolCall.id, arguments: update.toolCall.arguments ?? '{}', status: 'running' });
        }
        return { toolCalls };
      });
    }
  },
  ...
});
```
- After stream completes, we process tool calls from the final response and execute tools:
```310:406:src/components/chat/ChatPane.tsx
const toolCallRequests = raw?.choices?.[0]?.message?.tool_calls;
... // accumulate id/name/arguments across chunks
const finalArgsStr = state.arguments ?? '';
let toolArgs: Record<string, unknown> = {};
toolArgs = finalArgsStr.trim() ? JSON.parse(finalArgsStr) : {}; // empty => {}
... callTool(toolName, toolArgs);
```
- Transport builds tool_call deltas but merges only by id (index ignored), which can duplicate or split calls:
```239:271:src/services/openRouter.ts
if (toolCallDeltas && Array.isArray(toolCallDeltas)) {
  for (const toolCallDelta of toolCallDeltas) {
    const existingCallIndex = toolCalls.findIndex((call) => call.id === toolCallDelta.id);
    if (existingCallIndex === -1) { toolCalls.push({ id: toolCallDelta.id, type:'function', function: { name: toolCallDelta.function?.name || '', arguments: toolCallDelta.function?.arguments || '' } }); }
    else { if (toolCallDelta.function?.arguments) { toolCalls[existingCallIndex].function.arguments += toolCallDelta.function.arguments; } }
    onStream({ toolCall: { id: toolCallDelta.id, name: currentCallState.function.name, arguments: currentCallState.function.arguments, index: toolCallDelta.index, status: 'arguments' } });
  }
}
```
- For providers that stream tool calls (Claude/GPT-5), we see partial/empty arguments and sometimes an extra anonymous tool call. Then `finalArgsStr` becomes empty and we execute the tool with `{}`, causing the Zod “patches: Required” error.

### What we’ll change (high-level)
- Introduce a “tool-call streaming gate”: on first tool_call delta, cancel the stream and immediately re-run the same request with streaming disabled, so we receive a single complete tool_call object.
- Harden the delta accumulator so that if streaming remains enabled (future models), we merge deltas by id or index and never produce two separate calls or empty args.
- Add strict guards so we never call MCP tools with empty or invalid arguments.

### Implementation plan (what to change)

1) Transport layer: openRouter.ts
- Add a stream mode switch.
  - Extend `getGeminiResponse` to accept `stream?: boolean` (default true). When `stream === false`:
    - Set `payload.stream = false`.
    - Parse `data.choices[0].message` directly; no `onStream` callbacks.
- Add tool-call gating support when streaming:
  - In `getGeminiResponse` streaming loop, when encountering the first `tool_calls` delta, invoke a provided callback (e.g., `onToolDetected?.()`).
  - Do not accumulate further deltas if the caller intends to abort; the caller will actually abort via AbortController.
- Fix delta merging for providers that stream tool calls:
  - Maintain a Map keyed by `toolCallDelta.id || toolCallDelta.index` to merge arguments and name.
  - Only emit `onStream({ toolCall })` with the currently merged state (never as a second/new tool call).
- Assemble the final `raw.choices[0].message.tool_calls` from this merged map (ensuring each call has id or index, name, and the full concatenated arguments string).

2) Chat layer: ChatPane.tsx
- Introduce a “tool-call gating” flag per model:
  - Enable by default for models that are known to stream tool calls (e.g., model id starts with `anthropic/` or `openai/`), configurable in `useModelSelection` or a static allowlist.
- In `submitMessage` onStream handler:
  - On first `update.toolCall` and if gating is enabled, immediately:
    - Suppress UI updates for partial tool calls (do not show partial tool UI).
    - Abort the current streaming request via `abortControllerRef.current?.abort()`.
    - Set a local state `needsNonStreamingRetry = true`.
- After abort returns (catch AbortError path), if `needsNonStreamingRetry`:
  - Re-invoke `getGeminiResponse(apiMessages, { stream: false, tools, model, transforms })`.
  - Do not emit streaming updates; directly process `raw.choices[0].message.tool_calls`.
- Harden tool execution:
  - Before `callTool`, require that `finalArgsStr.trim().length > 0`. If empty, mark tool call as error “Missing tool arguments,” do not execute.
  - Wrap JSON.parse with clear error path and never fall back to `{}` silently. If parse fails, mark tool call as error and skip execution.
- Avoid duplicate tool calls:
  - Remove any “anonymous” tool calls from the final set if they’re equivalent to a fully identified call (same index/name, superset arguments).

3) UI behavior
- Do not render “partial” tool calls during the gating path.
- Only render a tool call accordion after the complete, non-stream tool call arrives and has been executed (same UX as Gemini).
- Preserve already-streamed assistant content text if any; we only gate the tool stream, not content streaming.

4) Configuration and flags
- Add a small utility to decide gating:
  - `shouldGateToolCalls(modelId: string): boolean` returning true for `anthropic/*`, `openai/*` (or a list you can tweak).
- Add a runtime toggle/override in Settings if desired (to turn gating off for debugging).

5) Error handling and resilience
- If the non-streaming retry returns with empty/malformed tool calls, present an assistant error message like:
  - “The model attempted a tool call but did not provide valid arguments. Please retry or provide more explicit instructions.”
- If multiple tool calls are returned, process them in order, applying the above validation to each. Skip invalid ones rather than calling with `{}`.

6) Observability
- Add precise logs:
  - “[Gate] Tool streaming detected – aborting and re-requesting without streaming”
  - “[Gate] Non-stream retry complete – executing N tool calls”
  - “[Tool] Skipped execution due to empty arguments”
  - “[Tool] Invalid JSON arguments”
- Optionally add a debug panel toggle to surface these events in the UI during development.

### Acceptance criteria
- With Claude Sonnet and GPT-5:
  - We no longer send MCP tool calls with `{}`/missing `patches`.
  - The first tool delta triggers stream abort and non-stream retry; tool calls execute with complete arguments.
  - UI shows a single tool call entry, not two, and no partial argument flicker.
- With Gemini:
  - Behavior unchanged (still streaming content) and tools continue to work as before.
- If the model returns malformed tool arguments in non-stream mode, we do not call the tool; we surface a clear, actionable error in the UI.

### Test plan
- Matrix:
  - Models: gemini-2.5-pro, anthropic/claude-sonnet-4.5, openai/gpt-5.
  - Scenarios:
    - Tool call with large JSON args (patches).
    - Non-tool response.
    - Multiple tool calls in one response.
    - Partial/incomplete streaming deltas.
- Verify:
  - Stream abort occurs only on tool_call detection for gated models.
  - Non-stream retry yields complete tool_calls.
  - No MCP call is made with empty args.
  - No duplicate/anonymous duplicate tool calls.
  - Follow-up request (with tool results) continues to stream content.

- Regression:
  - Normal chat-only streams unaffected.
  - Title suggestion still works.
  - Recording/transcription unaffected.

This plan standardizes the flow so that tools are always executed from a complete, non-stream message, while preserving streaming for normal text. It also improves the delta merger for future robustness.

```typescriptreact
const { raw } = await getGeminiResponse(apiMessages, {
  onStream: (update) => {
    if (update.content !== undefined) updateMessage(assistantMessage.id, { content: update.content });
    if (update.reasoning !== undefined) updateMessage(assistantMessage.id, { thinking: update.reasoning });
    if (update.toolCall) {
      updateMessage(assistantMessage.id, (current) => {
        const toolCalls = [...(current.toolCalls || [])];
        const existingIndex = toolCalls.findIndex((call) => call.id === update.toolCall!.id);
        if (existingIndex >= 0) {
          toolCalls[existingIndex] = {
            ...toolCalls[existingIndex],
            name: update.toolCall.name ?? toolCalls[existingIndex].name,
            arguments: update.toolCall.arguments ?? toolCalls[existingIndex].arguments,
            status: update.toolCall.status === 'finish' ? 'success' : 'running',
          };
        } else {
          toolCalls.push({ id: update.toolCall.id, name: update.toolCall.name ?? update.toolCall.id, arguments: update.toolCall.arguments ?? '{}', status: 'running' });
        }
        return { toolCalls };
      });
    }
  },
  ...
});
```

```typescriptreact
const toolCallRequests = raw?.choices?.[0]?.message?.tool_calls;
... // accumulate id/name/arguments across chunks
const finalArgsStr = state.arguments ?? '';
let toolArgs: Record<string, unknown> = {};
toolArgs = finalArgsStr.trim() ? JSON.parse(finalArgsStr) : {}; // empty => {}
... callTool(toolName, toolArgs);
```

```typescript
if (toolCallDeltas && Array.isArray(toolCallDeltas)) {
  for (const toolCallDelta of toolCallDeltas) {
    const existingCallIndex = toolCalls.findIndex((call) => call.id === toolCallDelta.id);
    if (existingCallIndex === -1) { toolCalls.push({ id: toolCallDelta.id, type:'function', function: { name: toolCallDelta.function?.name || '', arguments: toolCallDelta.function?.arguments || '' } }); }
    else { if (toolCallDelta.function?.arguments) { toolCalls[existingCallIndex].function.arguments += toolCallDelta.function.arguments; } }
    onStream({ toolCall: { id: toolCallDelta.id, name: currentCallState.function.name, arguments: currentCallState.function.arguments, index: toolCallDelta.index, status: 'arguments' } });
  }
}
```

---

**User**

"Harden the delta accumulator so that if streaming remains enabled (future models), we merge deltas by id or index and never produce two separate calls or empty args.
Add strict guards so we never call MCP tools with empty or invalid arguments."

 This is too much and unnecessary. We're going to do one solution to solve one problem. We're not going to introduce other problems in the process of trying to make the solution more broad. We're not going to solve this five different ways. We're going to solve the one problem one way. We need to focus on solving it, that one thing, in the way that I had originally said:

"Introduce a “tool-call streaming gate”: on first tool_call delta, cancel the stream and immediately re-run the same request with streaming disabled, so we receive a single complete tool_call object."

Re-write the change plan with this in mind.

---

**Cursor**

Got it. Here’s the single-solution change plan focused only on introducing the tool-call streaming gate.

### Objective
Guarantee that tool calls are executed only from a single, complete, non-streaming response by:
- Detecting the first streamed tool_call delta.
- Immediately aborting the stream.
- Re-sending the same request with streaming disabled.
- Processing the complete tool_call object only from the non-stream response.

### Scope
- Frontend only.
- Files: `src/services/openRouter.ts`, `src/components/chat/ChatPane.tsx`.
- No server/MCP changes.

### Changes

1) Transport: `src/services/openRouter.ts`
- Add a streaming toggle parameter to `getGeminiResponse`.
  - New function signature: `getGeminiResponse(messages, { onStream, signal, tools, model, transforms, stream = true })`.
  - If `stream === false`:
    - Set `payload.stream = false`.
    - Perform a normal POST and parse the JSON body.
    - Return `{ content: extractMessageContent(data.choices[0]?.message?.content), raw: data }`.
  - If `stream === true`:
    - Keep current streaming behavior (no broad changes).
    - No new merging logic; we will gate in the caller.

2) Chat logic: `src/components/chat/ChatPane.tsx`
- Add refs/flags to manage gating:
  - `const gatingTriggeredRef = useRef(false);`
  - `const nonStreamInFlightRef = useRef(false);`
- Update the `onStream` handler inside `submitMessage`:
  - On first `update.toolCall`:
    - If `gatingTriggeredRef.current` is false:
      - Set `gatingTriggeredRef.current = true`.
      - Abort the active streaming request: `abortControllerRef.current?.abort()`.
      - Do not update UI with this (or any) partial tool-call delta.
    - Return early for any subsequent toolCall deltas when `gatingTriggeredRef.current` is true (suppress partials).
- Handle re-request after abort:
  - In the `try/catch` around `getGeminiResponse`, when catching an `AbortError`:
    - If `gatingTriggeredRef.current` is true and `nonStreamInFlightRef.current` is false:
      - Set `nonStreamInFlightRef.current = true`.
      - Invoke `getGeminiResponse(apiMessages, { stream: false, tools: toolsForInitialCall, model: selectedModel.id, transforms })`.
      - Proceed to the existing tool-call processing pipeline using the returned `raw.choices[0].message.tool_calls` (no changes to how we execute tools).
      - When done, clear flags: `gatingTriggeredRef.current = false; nonStreamInFlightRef.current = false;` and call `finalize()`.
    - Else rethrow/handle as current error path.
- Suppress partial tool-call UI:
  - In `onStream`, when `update.toolCall` is present and gating has triggered, do not call `updateMessage` to render toolCalls. Only render toolCalls after the non-stream response is processed (i.e., when we have the complete tool call).
- Do not change follow-up request logic:
  - Keep the existing “send one follow-up with tool results” behavior exactly as is.

### UX behavior
- For models that stream tool calls (Claude/GPT-5), the first tool_call delta immediately triggers the gate:
  - No partial/empty tool-call UI is rendered.
  - A complete tool call is fetched non-streaming and executed.
- For models that don’t stream tool calls (Gemini), behavior stays exactly the same.

### Logging
- Add concise logs:
  - “[Gate] Tool_call delta detected — aborting stream and retrying non-stream.”
  - “[Gate] Non-stream retry succeeded — executing N tool calls.”

### Acceptance criteria
- Claude/GPT-5 no longer send empty tool args; tool calls execute from a complete non-stream object.
- No partial tool calls appear in the UI.
- Gemini path unchanged.
- No MCP calls are made until the non-stream tool call is available.

### Test plan
- Models: `anthropic/claude-sonnet-4.5`, `openai/gpt-5`, `google/gemini-2.5-pro`.
- Case 1: Tool call with large `patches` payload.
  - Expect: gate triggers on Claude/GPT-5, non-stream response returns complete tool call, tool executes once.
- Case 2: Non-tool assistant reply.
  - Expect: normal streaming content; no abort.
- Case 3: Multiple tool calls in a single response.
  - Expect: single non-stream retry; process all tool calls in sequence.

- Verify console logs reflect gate trigger and non-stream retry.
- Verify no tool execution occurs from partial deltas.

---

**User**

Our next objectives:
<newobjectives>
Very carefully execute this change.

Again, this is a very complicated change, this idea, because it needs to work at a couple of different levels, the UI, the back end, and everything in between. Also MCP as a concept is also very, there's a lot of different things that are going on here, so we need to be careful about understanding that and implementing a solution that works across all of the required levels.
</newobjectives>

We need to execute this, however this chat has become too long so we need to implement it in a completely new chat. Provide a comprehensive, detailed prompt for that new chat with two elements:
1 - A general overall understanding of the whole total project that collectively encapsulates everything that's going on in this project that we can begin a brand new chat. Encapsulate the whole totality of everything that's involved in this project in detail. Include everything the new chat would possibly need to know in order to be able to follow through on the above <newobjective>. Provide a total and accurate understanding of the entire scope of the project in great detail (including the details carried over from the summary of the last chat that was provided at the beginning of this chat). Do not describe old, resolved issues that were done in this chat. This should be equivalent to a very high quality peice of readme documentation. In doing so it should provide a clear, comprehensive, and well-organized understanding of how the code works - how the project is structured at a programmatic level, specifically focused on what understandings will likely be needed to undertake <newobjectives>.
2 - A comprehensive, detailed rearticulation of the endeavor noted in <newobjectives>. The prompt must be a directive to this effect - instructing the new chat to carry this out with the appropriate level of rigor, precision, and attention to detail.

Provide Part 2 Only, now

Note: If the `<newobjectives>` require any changes to the Supabase database schema let me know what they are and why first before proceeding and ask me to confirm. If I confirm you will make those changes first before composing Part 1 and Part 2 using the script `apply_and_verify_schema.cjs` in the repository's root directory.  Modify the `alterCommands` array within the script to contain the new SQL `ALTER TABLE` or other DDL commands required for the objective, execute the script, confirm it was successful, and revert the changes back. Subsequently, make sure your part 1 and part 2 instructions note that these changes were already made and what modifications are already in place.

Note: If there's anything that I need to do at a higher level than can be done by you with supabase access or an AI with access to the repo, let me know now.

---

**Cursor**

### Part 2 — Implementation Directive: Tool‑Call Streaming Gate

Objective
- Implement a single, focused solution: introduce a “tool‑call streaming gate” so that when the first streamed tool_call delta is detected, the stream is immediately aborted and the same request is re‑issued with streaming disabled; tools are executed only from that complete, non‑streaming response.
- Do not broaden scope (no delta merging, no server changes). Preserve current UX for non‑tool content streaming.

Preconditions
- No Supabase schema changes required.
- No Cloudflare Worker changes required.
- No higher‑level external actions required.

Scope of changes
- Frontend only.
- Files to edit:
  - `src/services/openRouter.ts`
  - `src/components/chat/ChatPane.tsx`

Constraints
- Keep current streaming UX for normal assistant content.
- Do not render partial tool calls in the UI.
- Execute tool calls only from the complete non‑stream response.
- Minimize code churn; do not refactor unrelated logic.

Implementation steps

1) Transport: add non‑streaming mode
- In `src/services/openRouter.ts`, extend the function signature:
  - `getGeminiResponse(messages, { onStream, signal, tools, model, transforms, stream = true })`
- Behavior:
  - If `stream === true`: keep existing streaming implementation unchanged.
  - If `stream === false`:
    - Set `payload.stream = false` and POST as usual.
    - Return `{ content: extractedMessageContent, raw: full JSON }` where `raw.choices[0].message.tool_calls` is present if the model returned tool calls.

2) Chat: introduce the tool‑call streaming gate
- In `src/components/chat/ChatPane.tsx`, within `submitMessage`:
  - Add:
    - `const gatingTriggeredRef = useRef(false);`
    - `const nonStreamInFlightRef = useRef(false);`
- In the `onStream` callback passed to the initial `getGeminiResponse`:
  - When `update.toolCall` is detected for the first time:
    - If `gatingTriggeredRef.current === false`:
      - `gatingTriggeredRef.current = true`
      - Abort current stream via `abortControllerRef.current?.abort()`
      - Do NOT update UI with this (or any) partial tool‑call deltas
    - For any subsequent toolCall deltas after gating is set, ignore them (no UI updates).
- Handle abort and re‑request non‑stream:
  - In the surrounding `try/catch` for `getGeminiResponse`, catch `AbortError`.
  - If `gatingTriggeredRef.current === true` and `nonStreamInFlightRef.current === false`:
    - `nonStreamInFlightRef.current = true`
    - Re‑issue the same request with:
      - `getGeminiResponse(apiMessages, { stream: false, tools: toolsForInitialCall, model: selectedModel.id, transforms })`
    - Process tool calls exactly as in current code path using `raw.choices[0].message.tool_calls`
    - When complete:
      - `gatingTriggeredRef.current = false`
      - `nonStreamInFlightRef.current = false`
      - Call `finalize()` once
  - If not a gating abort, handle as current error flow.
- Important: do not change the existing logic that executes tools or the follow‑up request, except that tool calls must come only from this non‑stream response.
- Do not render any partial tool calls in the UI. Tool call UI should only render after the non‑streaming response has been processed.

3) Follow‑up request
- Keep current behavior. No changes to follow‑up logic; only ensure the above gating affects the initial request. (If a model returns additional tool calls in the follow‑up, we will address separately if needed; do not implement additional mechanisms now.)

4) Logging
- Add concise logs:
  - “[Gate] tool_call detected — aborting stream and retrying non‑stream”
  - “[Gate] non‑stream retry complete — executing N tool calls”

Acceptance criteria
- Claude Sonnet and GPT‑5:
  - First tool_call delta triggers gating: stream aborts; non‑stream request returns a single complete tool_call object; tool executes with correct arguments.
  - No partial/empty tool‑call UI is rendered.
- Gemini:
  - Behavior unchanged for normal content and tool handling (continues to work as it does now).
- No MCP tool is invoked from partial/streamed arguments; only from complete non‑stream response.

Test plan
- Models: `anthropic/claude-sonnet-4.5`, `openai/gpt-5`, `google/gemini-2.5-pro`.
- Cases:
  - Tool call with large `patches` argument (JSON payload).
    - Expect: gate triggers on Claude/GPT‑5; non‑stream retry returns complete args; tool executes once; UI shows one tool call with response.
  - Non‑tool responses.
    - Expect: normal content streaming; no abort.
  - Multiple tool calls in one response (initial).
    - Expect: single non‑stream retry; execute all tool calls in order.

Deliverables
- Updated `src/services/openRouter.ts` with `stream` parameter and non‑stream branch.
- Updated `src/components/chat/ChatPane.tsx` with gating flags, abort, and non‑stream retry.
- Console logs demonstrating gate trigger and non‑stream retry.
- Manual verification notes for each test case above.

Out‑of‑scope (intentionally not included)
- No delta merging logic.
- No MCP Worker/server or Supabase changes.
- No UI redesigns.
- No additional model‑specific branches.

---

**User**

Now provide part 1 and ammend part 2 to it exactly as is.

---

**Cursor**

### Part 1 — Comprehensive Project Context and Execution Frame

## Product and Purpose
LifeCurrents is a Vite/React/TypeScript single-page app that helps users visualize how daily actions map to long‑term goals. It combines:
- A causal graph (React Flow) to model objectives and dependencies.
- An AI chat interface integrated with MCP tools for reading/updating the graph and instructions.
- Preview build ingest/review inside the app via Supabase Realtime.
- In‑app audio transcription that appends text into the chat input (not auto‑sent).
- PWA behavior with a service worker for seamless updates.

## Architecture Overview

- Frontend (React/Vite/TypeScript)
  - UI: `shadcn/ui`, `lucide-react`.
  - Routing and shell: `src/App.tsx`, `src/pages/*.tsx`.
  - Chat experience: `src/components/chat/ChatPane.tsx`, `ChatMessage.tsx`, `SettingsDialog.tsx`.
  - Hooks for state/data: `src/hooks/*` (chat provider, MCP, model selection, system instructions, audio recorder, preview builds, etc.).
  - PWA: `public/sw.js` + `src/lib/serviceWorkerManager.ts` + `src/hooks/useServiceWorkerRefresh.ts`.
  - Graph UI: `src/components/CausalGraph.tsx` orchestrates rendering, layout, and fit.

- Backend (Cloudflare Worker project `remote-mcp-server-authless`)
  - Entry: `remote-mcp-server-authless/src/index.ts`.
  - Provides MCP SSE (`/sse`), RPC (`/mcp`), and transcription proxy (`/api/transcribe`).
  - MCP Tools implemented in `MyMCP`:
    - `get_system_instructions()`
    - `update_system_instructions(new_instructions_content)`
    - `get_todays_context()`
    - `get_graph_structure(start_node_id, depth)`
    - `patch_graph_document(patches)` — applies JSON Patch operations via `fast-json-patch`, recalculates node percentages, updates Supabase.
  - Secrets: `GROQ_API_KEY` for Groq Whisper handled by the Worker (never exposed in client).

- Data (Supabase)
  - Tables:
    - `graph_documents`: JSONB document keyed by `id` (e.g., `main`) containing nodes, edges, viewport.
    - `system_instructions`: stores instruction content (`id`, `content`, timestamps).
    - `preview_builds`: CI inserts Pages preview URLs for PRs; frontend reads and marks seen.
  - Realtime streams push changes to clients (builds badge/list, etc.).

## Core Frontend Flows

### Chat + MCP Tooling
- Primary component: `src/components/chat/ChatPane.tsx`.
- Assembling the model request:
  - Gathers conversation history and system instructions (`useSystemInstructions`).
  - Applies optional context transforms (`useConversationContext`).
  - Determines model (`useModelSelection`) and sets available MCP tools from `useMcp`.
  - Uses `getToolIntent` (OpenRouter) to optionally disable tools for pure conversation.
- Transport to OpenRouter:
  - `src/services/openRouter.ts` exports `getGeminiResponse(messages, { onStream, signal, tools, model, transforms })`.
  - Streaming behavior:
    - Reads SSE `data:` lines, accumulates:
      - `content` (assistant text),
      - `reasoning` (optional),
      - `tool_calls` deltas (partial chunks).
    - Emits `onStream` updates to `ChatPane` with text, reasoning, and partial tool_call updates.
    - After stream completes, reconstructs a final `raw` response and injects full `tool_calls` if present.
- Handling tool calls (ChatPane):
  - During streaming, partial tool_call deltas are currently reflected in message state for UI.
  - After streaming completes, `raw.choices[0].message.tool_calls` are processed:
    - Concatenate arguments, parse JSON, call MCP tool via `useMcp().callTool(name, args)`.
    - Collect tool results and send a follow‑up LLM request with `assistant` tool_calls + `tool` role messages.
    - Stream the follow‑up reply as normal content.

### MCP Client (Frontend)
- `src/hooks/mcpProvider.tsx` instantiates an MCP client (`src/lib/mcp/client.ts`) pointing at `${VITE_WORKER_BASE_URL}`.
- Provides `listTools()` and `callTool(name, args)` over the Worker’s `/sse` and `/mcp` endpoints.
- `useMcp()` exposes `tools` and `callTool` to the chat layer.

### Graph and Patching
- `src/components/CausalGraph.tsx` renders the graph, coordinates layout, and triggers a one‑time fit after load.
- The graph document lives in Supabase (`graph_documents.data`).
- The Worker’s `patch_graph_document(patches)`:
  - Accepts JSON Patch operations.
  - Applies patches, recalculates child percentages for affected parents, persists updated doc.
  - Returns `result` with updated `nodes` + `score_context`.

### Audio Transcription
- `src/hooks/useAudioTranscriptionRecorder.ts`: captures audio via `MediaRecorder`, slices 30s chunks, queues uploads, retries failures, shows recording + connectivity bars.
- `src/services/transcription.ts` posts `FormData` with audio to `${VITE_WORKER_BASE_URL}/api/transcribe`.
- Worker securely forwards to Groq Whisper (`whisper-large-v3`) and returns transcript; frontend appends final transcript text to the chat input (not auto‑sent).

### Preview Builds (PR to Pages URL ingest)
- GitHub Action (not in frontend) inserts `preview_builds` rows into Supabase once a Pages preview is available.
- `src/hooks/usePreviewBuilds.ts` listens to `preview_builds` and maintains unseen counts.
- Settings gear icon shows a badge with unseen count; Builds tab lists previews and can mark as seen.

## Configuration
- Frontend:
  - `VITE_WORKER_BASE_URL` (Cloudflare Worker base).
  - Supabase URL + anon key (client).
  - Optional `VITE_OPENROUTER_API_KEY` for OpenRouter.
- Worker (Cloudflare):
  - `GROQ_API_KEY` (secret).
- GitHub Actions secrets handle CI ingest to Supabase (owner/repo tokens, Cloudflare).

## Quality Bars / Policies
- PWA: support skip‑waiting and refresh for new builds.
- Realtime: dedupe on client to avoid double entries.
- Accessibility: keyboard shortcuts (mic), ARIA on controls, status messages for recording/upload retries.
- Performance: waveform rendering smooth; upload concurrency limited; prevent memory leaks in long recordings.
- Security: client holds no secret keys; Worker proxies sensitive operations.

## The Specific Problem and Solution Approach
- Issue: Models like Claude Sonnet and GPT‑5 stream tool_call deltas with partial JSON arguments, and current UI/transport may handle those partials as actionable, sometimes executing tools with `{}`/missing args. Gemini typically returns tool calls as a single complete object; the current flow works for Gemini but not for strictly streaming models.
- Single‑solution approach: introduce a “tool‑call streaming gate” — on first tool_call delta, immediately abort the stream; re‑issue the same request with streaming disabled; execute tool calls only from that complete, non‑stream response. No backend changes; minimal, carefully scoped frontend changes only.

## Where the Change Lands
- `src/services/openRouter.ts`: add an explicit non‑stream mode for the same entrypoint (still used for the retry).
- `src/components/chat/ChatPane.tsx`: detect first tool_call delta, abort, re‑request non‑stream, and process tool calls only from that complete response. Suppress partial tool_call UI during the initial streaming attempt.

## No Database or Worker Changes
- No Supabase schema changes are necessary for this objective.
- No changes to `remote-mcp-server-authless` are required.

---

### Part 2 — Implementation Directive: Tool‑Call Streaming Gate

Objective
- Implement a single, focused solution: introduce a “tool‑call streaming gate” so that when the first streamed tool_call delta is detected, the stream is immediately aborted and the same request is re‑issued with streaming disabled; tools are executed only from that complete, non‑streaming response.
- Do not broaden scope (no delta merging, no server changes). Preserve current UX for non‑tool content streaming.

Preconditions
- No Supabase schema changes required.
- No Cloudflare Worker changes required.
- No higher‑level external actions required.

Scope of changes
- Frontend only.
- Files to edit:
  - `src/services/openRouter.ts`
  - `src/components/chat/ChatPane.tsx`

Constraints
- Keep current streaming UX for normal assistant content.
- Do not render partial tool calls in the UI.
- Execute tool calls only from the complete non‑stream response.
- Minimize code churn; do not refactor unrelated logic.

Implementation steps

1) Transport: add non‑streaming mode
- In `src/services/openRouter.ts`, extend the function signature:
  - `getGeminiResponse(messages, { onStream, signal, tools, model, transforms, stream = true })`
- Behavior:
  - If `stream === true`: keep existing streaming implementation unchanged.
  - If `stream === false`:
    - Set `payload.stream = false` and POST as usual.
    - Return `{ content: extractedMessageContent, raw: full JSON }` where `raw.choices[0].message.tool_calls` is present if the model returned tool calls.

2) Chat: introduce the tool‑call streaming gate
- In `src/components/chat/ChatPane.tsx`, within `submitMessage`:
  - Add:
    - `const gatingTriggeredRef = useRef(false);`
    - `const nonStreamInFlightRef = useRef(false);`
- In the `onStream` callback passed to the initial `getGeminiResponse`:
  - When `update.toolCall` is detected for the first time:
    - If `gatingTriggeredRef.current === false`:
      - `gatingTriggeredRef.current = true`
      - Abort current stream via `abortControllerRef.current?.abort()`
      - Do NOT update UI with this (or any) partial tool‑call deltas
    - For any subsequent toolCall deltas after gating is set, ignore them (no UI updates).
- Handle abort and re‑request non‑stream:
  - In the surrounding `try/catch` for `getGeminiResponse`, catch `AbortError`.
  - If `gatingTriggeredRef.current === true` and `nonStreamInFlightRef.current === false`:
    - `nonStreamInFlightRef.current = true`
    - Re‑issue the same request with:
      - `getGeminiResponse(apiMessages, { stream: false, tools: toolsForInitialCall, model: selectedModel.id, transforms })`
    - Process tool calls exactly as in current code path using `raw.choices[0].message.tool_calls`
    - When complete:
      - `gatingTriggeredRef.current = false`
      - `nonStreamInFlightRef.current = false`
      - Call `finalize()` once
  - If not a gating abort, handle as current error flow.
- Important: do not change the existing logic that executes tools or the follow‑up request, except that tool calls must come only from this non‑stream response.
- Do not render any partial tool calls in the UI. Tool call UI should only render after the non‑streaming response has been processed.

3) Follow‑up request
- Keep current behavior. No changes to follow‑up logic; only ensure the above gating affects the initial request. (If a model returns additional tool calls in the follow‑up, we will address separately if needed; do not implement additional mechanisms now.)

4) Logging
- Add concise logs:
  - “[Gate] tool_call detected — aborting stream and retrying non‑stream”
  - “[Gate] non‑stream retry complete — executing N tool calls”

Acceptance criteria
- Claude Sonnet and GPT‑5:
  - First tool_call delta triggers gating: stream aborts; non‑stream request returns a single complete tool_call object; tool executes with correct arguments.
  - No partial/empty tool‑call UI is rendered.
- Gemini:
  - Behavior unchanged for normal content and tool handling (continues to work as it does now).
- No MCP tool is invoked from partial/streamed arguments; only from complete non‑stream response.

Test plan
- Models: `anthropic/claude-sonnet-4.5`, `openai/gpt-5`, `google/gemini-2.5-pro`.
- Cases:
  - Tool call with large `patches` argument (JSON payload).
    - Expect: gate triggers on Claude/GPT‑5; non‑stream retry returns complete args; tool executes once; UI shows one tool call with response.
  - Non‑tool responses.
    - Expect: normal content streaming; no abort.
  - Multiple tool calls in one response (initial).
    - Expect: single non‑stream retry; execute all tool calls in order.

Deliverables
- Updated `src/services/openRouter.ts` with `stream` parameter and non‑stream branch.
- Updated `src/components/chat/ChatPane.tsx` with gating flags, abort, and non‑stream retry.
- Console logs demonstrating gate trigger and non‑stream retry.
- Manual verification notes for each test case above.

Out‑of‑scope (intentionally not included)
- No delta merging logic.
- No MCP Worker/server or Supabase changes.
- No UI redesigns.
- No additional model‑specific branches.

---

**User**

 Okay, so that worked. We got it done. And the other AI did it. Job complete. Now, there's a slight modification to this that we need to make. There's another issue, actually. Okay, wait. Now there's another git syncing issue. Alright, looks like it resolved itself. Okay, so now the point is, all of this supposedly works. The only thing is, is that when we try to call like multiple tools, try to call a tool and then we'll get to the end of a message. It doesn't appropriately know to call another tool again. So basically it just stops. So it'll go and it'll think and it'll call the Git graph structure but then it won't trigger the next call. There's something about the sequence of thinking and tool calling and thinking again and then tool calling again where the whole thing is getting lost in that process.

---

**Cursor**

I understand the issue. The current implementation successfully handles a single round of tool calls, but it isn't designed for a multi-turn sequence. After the model receives the results from the first tool (`get_graph_structure`), it provides its analysis, but if that analysis leads to a decision to call a *second* tool, our logic doesn't catch it. The process currently stops after one cycle of `tool_call -> tool_result -> text_response`.

To fix this, I will refactor the message submission logic to support these kinds of multi-step tool conversations. My plan is to restructure the core process inside `submitMessage` into a loop. This loop will:
1. Send the current conversation history to the model.
2. Check the response for tool calls.
3. If tools are called, execute them and append the results to the history.
4. Loop back to step 1, sending the updated history.

This continues until the model responds with a final, conversational answer instead of another tool request. This will allow for the "thinking -> tool -> thinking -> tool" sequence you've described.

This is a significant change to the chat logic, so I will proceed carefully, focusing the changes within `src/components/chat/ChatPane.tsx`.

```typescriptreact
// ... existing code ...
    const [fontScale, setFontScale] = useState(() => {
        if (typeof window === 'undefined') return 1;
        const stored = window.localStorage.getItem('life-currents.chat.font-scale');
        if (!stored) return 1;
        const parsed = parseFloat(stored);
        return Number.isFinite(parsed) ? parsed : 1;
    });
    const abortControllerRef = useRef<AbortController | null>(null);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const gatingTriggeredRef = useRef(false);
    const nonStreamInFlightRef = useRef(false);
    const { activeInstruction } = useSystemInstructions();
    const { tools: availableTools, callTool } = useMcp();
    const { selectedModel, recordModelUsage, getToolIntentCheck } = useModelSelection();
// ... existing code ...
        return Number.isFinite(parsed) ? parsed : 1;
    });
    const abortControllerRef = useRef<AbortController | null>(null);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const { activeInstruction } = useSystemInstructions();
    const { tools: availableTools, callTool } = useMcp();
    const { selectedModel, recordModelUsage, getToolIntentCheck } = useModelSelection();
    const { applyContextToMessages, transforms } = useConversationContext();

    useEffect(() => {
// ... existing code ...
    const submitMessage = async (content: string, threadId: string, parentId: string | null) => {
        setIsLoading(true);
        console.log('[ChatPane] submitMessage called with:', { content, threadId, parentId });

        const historyChain = parentId ? applyContextToMessages(getMessageChain(parentId)) : [];
        const systemPrompt = activeInstruction?.content;

        const initialApiMessages: ApiMessage[] = [
            ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
            ...historyChain.map(({ role, content, tool_calls }) => ({ role, content, tool_calls })),
            { role: 'user' as const, content },
        ];

        const toolDefinitions: ApiToolDefinition[] = availableTools.map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
            },
        }));

        let toolsForInitialCall: ApiToolDefinition[] | undefined =
            toolDefinitions.length > 0 ? toolDefinitions : undefined;

        if (toolsForInitialCall && getToolIntentCheck(selectedModel.id)) {
            try {
                const intent = await getToolIntent(content);
                if (intent === 'CONVERSATION') {
                    toolsForInitialCall = undefined;
                }
            } catch (intentError) {
                console.warn('[ChatPane] Tool intent classification failed.', intentError);
            }
        }

        const userMessage = addMessage(threadId, { role: 'user', content, parentId });
        clearDraft(threadId);
        setInput('');

        const assistantMessage = addMessage(threadId, {
            role: 'assistant',
            content: '',
            parentId: userMessage.id,
            toolCalls: [],
        });
        setStreamingMessageId(assistantMessage.id);

        let finalizeCalled = false;
        const finalize = () => {
            if (finalizeCalled) return;
            finalizeCalled = true;
            setIsLoading(false);
            setStreamingMessageId(null);
            abortControllerRef.current = null;
            gatingTriggeredRef.current = false;
            nonStreamInFlightRef.current = false;
        };

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const conversationMessages: any[] = [...initialApiMessages];
        const maxTurns = 5;

        try {
            for (let turn = 0; turn < maxTurns; turn++) {
                let rawResponse: any = null;

                try {
                    const result = await getGeminiResponse(conversationMessages, {
                        onStream: (update) => {
                            if (gatingTriggeredRef.current) {
                                if (update.toolCall) return; // Suppress partial tool UI during gating
                            }
                            console.log('[ChatPane][Streaming update]', update);
                            if (update.content !== undefined) {
                                updateMessage(assistantMessage.id, { content: update.content });
                            }
                            if (update.reasoning !== undefined) {
                                updateMessage(assistantMessage.id, { thinking: update.reasoning });
                            }
                            if (update.toolCall) {
                                if (!gatingTriggeredRef.current) {
                                    console.log('[Gate] tool_call detected — aborting stream and retrying non-stream');
                                    gatingTriggeredRef.current = true;
                                    abortControllerRef.current?.abort();
                                }
                            }
                        },
                        signal: controller.signal,
                        tools: turn === 0 ? toolsForInitialCall : toolDefinitions,
                        model: selectedModel.id,
                        transforms: transforms.length > 0 ? transforms : undefined,
                        stream: true, // Always stream first
                    });
                    rawResponse = result.raw;
                } catch (error) {
                    if (error instanceof Error && error.name === 'AbortError' && gatingTriggeredRef.current && !nonStreamInFlightRef.current) {
                        nonStreamInFlightRef.current = true;
                        const result = await getGeminiResponse(conversationMessages, {
                            onStream: () => { }, // No-op
                            signal: controller.signal,
                            tools: turn === 0 ? toolsForInitialCall : toolDefinitions,
                            model: selectedModel.id,
                            transforms: transforms.length > 0 ? transforms : undefined,
                            stream: false,
                        });
                        console.log('[Gate] non-stream retry complete');
                        rawResponse = result.raw;
                    } else {
                        throw error; // Re-throw other errors
                    }
                }

                if (!rawResponse) {
                    console.log('[ChatPane] No raw response, finalizing.');
                    break;
                }

                const responseMessage = rawResponse.choices?.[0]?.message;
                if (!responseMessage) {
                    break;
                }

                conversationMessages.push(responseMessage);

                const toolCallRequests = responseMessage.tool_calls;

                if (!toolCallRequests || toolCallRequests.length === 0) {
                    // No tool calls, conversation is done.
                    break;
                }

                console.log('[ChatPane][MCP] Processing', toolCallRequests.length, 'tool calls');

                const toolResults = await Promise.all(toolCallRequests.map(async (toolCallRequest: any) => {
                    const toolId = toolCallRequest.id;
                    const toolName = toolCallRequest.function?.name;
                    const finalArgsStr = toolCallRequest.function?.arguments ?? '';

                    updateMessage(assistantMessage.id, (current) => {
                        const toolCalls = [...(current.toolCalls || [])];
                        const existingIndex = toolCalls.findIndex((call) => call.id === toolId);
                        if (existingIndex < 0) {
                            toolCalls.push({ id: toolId, name: toolName || toolId, arguments: finalArgsStr, status: 'running' });
                        }
                        return { toolCalls };
                    });

                    let toolArgs: Record<string, unknown> = {};
                    let toolContent: string;

                    try {
                        if (!toolName) throw new Error('Tool call did not include a tool name.');
                        toolArgs = finalArgsStr.trim() ? JSON.parse(finalArgsStr) : {};
                        const toolResult = await callTool(toolName, toolArgs);
                        toolContent = typeof toolResult?.content === 'string'
                            ? toolResult.content
                            : JSON.stringify(toolResult?.content ?? '', null, 2);

                        updateMessage(assistantMessage.id, (current) => {
                            const toolCalls = [...(current.toolCalls || [])];
                            const existingIndex = toolCalls.findIndex((call) => call.id === toolId);
                            if (existingIndex >= 0) {
                                toolCalls[existingIndex].status = 'success';
                                toolCalls[existingIndex].response = toolContent;
                            }
                            return { toolCalls };
                        });

                    } catch (toolError) {
                        console.error('Tool execution failed', toolError);
                        toolContent = `Error: ${toolError instanceof Error ? toolError.message : 'Tool call failed'}`;
                        updateMessage(assistantMessage.id, (current) => {
                            const toolCalls = [...(current.toolCalls || [])];
                            const existingIndex = toolCalls.findIndex((call) => call.id === toolId);
                            if (existingIndex >= 0) {
                                toolCalls[existingIndex].status = 'error';
                                toolCalls[existingIndex].error = toolContent;
                            }
                            return { toolCalls };
                        });
                    }

                    return {
                        role: 'tool' as const,
                        tool_call_id: toolId,
                        content: toolContent,
                    };
                }));

                conversationMessages.push(...toolResults);

                if (turn === maxTurns - 1) {
                    console.warn("Max tool turns reached.");
                }
            }

            // After the loop, handle title suggestion
            if (activeThread?.rootChildren && activeThread.rootChildren.length <= 1 && activeThread.title === 'New Chat') {
                void (async () => {
                    try {
                        const title = await getTitleSuggestion(conversationMessages);
                        if (title) {
                            updateThreadTitle(activeThreadId!, title);
                        }
                    } catch (err) {
                        console.warn('Failed to fetch title suggestion:', err);
                    }
                })();
            }

        } catch (error) {
            const errorMessage = `Error: ${error instanceof Error ? error.message : 'An unknown error occurred.'}`;
            updateMessage(assistantMessage.id, { content: errorMessage });
        } finally {
            finalize();
        }
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
// ... existing code ...

```

---

**User**

 Okay, but critically, it can and sometimes does do this. There are occasions when it does, because it will call more than one tool. But if it's told to call, it can call a couple of tools in sequence. It can call, like, it can call the git graph structure. But then if you tell it, call the git graph structure first and then patch the graph document, then it stops. it reasons about it, but then it doesn't call the patch graph document. But then there are other cases where it calls multiple tools, where it will call, it will think, then call getGraphStructure, then think more, then call getToday'sContext, and then still think more. But then when it finally gets to the end, then it doesn't call the patch the graph document tool. But if you just tell it to just call patch graph document, then that works. So it's like it's almost there's an issue with the instruction or the concept of how it's supposed to be working that's of the nature of it. like the flow of the thing like what it believes it's supposed to be doing and then somehow but it's only so it's got to do with the instructions within the set or I'm not even sure exactly why. Actually,  I understand what's going on here. It's able to call multiple tools on one turn. That part isn't a problem. It can call more than one tool at one turn at once. But what it doesn't do, you're right, is it's not able to call another tool again after it does its thinking. So actually it can call a tool and then go back into thinking and then think more. But it can't, after it does the second bout of thinking, it can't call another tool again. It just stops. The same is true for if it thinks, calls a tool, and then sends like a real text output. When it does the text output as like the actual thing then it can go back into the thinking again I don know maybe it can go back into thinking again after it does a text output but it can call a tool again after that So it should be able to continuously call a thinking, think, call a tool, do a text output to write out, call a tool again, think or think first and then call the tool again, then do another text right out and then just keep doing what it needs to be able to do. Now I know that there's an appropriate sequence for these operations that we expect to happen and there's like some kind of concept of the way that these sorts of things need to be coordinated in sequence, the way that that needs to be orchestrated, the way that that flow is supposed to work to allow for it to have that liberal because I'm saying oh well it needs to be able to do all of these things at any given point in time but that's not that may not be the
 the way that the actual sequence is structured. There's supposed to be a proper, like an intended paradigm that works across all LLMs that everybody kind of just generally agrees to. So maybe that means that it does thinking, then tool call, then thinking, then another tool call, then thinking, then another tool call. But in Klon, it will write out, it will think, then write, and then think, and then do a tool call. I mean, it feels like there's other sequences of flow that exist within the context of that platform. So we want it to have the most liberal expanse of what it can do should it want to. And we want to allow our platform to conform to that modality, to that expanse of modalities. So really, I think that the first step is for us to write a searching prompt, write a prompt for another AI that has access to more web resources to be able to give us a better overall understanding of exactly what it is that is possible and is accepted as the appropriate methodology of this synchronicity of how this is supposed to be handled and what that implementation approach is first. Then once we know what that is, then we can draft our implementation approach for this to be able to resolve the issue that we're seeing right now. So let's go ahead and start by drafting that search prompt. And this is going to be an all-inclusive prompt that will contain everything that the AI doing the search will possibly need to know to be able to give us the answer that we're talking about that would be relevant to the situation that we're in right now.

---

**Cursor**

Of course. Here is the comprehensive prompt for an AI with web access to research the standard patterns for multi-turn tool calling.

***

### Research Prompt: Best Practices for Implementing Multi-Turn, Provider-Agnostic LLM Tool-Calling Loops

**1. Project Context & Technical Stack**

You are advising a development team building a sophisticated AI chat application. Here is the relevant context:

*   **Application:** A React/TypeScript Single-Page Application (`LifeCurrents`) that uses an LLM as a conversational partner to manage a user's personal knowledge graph.
*   **LLM Gateway:** We use **OpenRouter** as an API gateway. This means we interact with multiple underlying models (including Google's Gemini, Anthropic's Claude, and OpenAI's GPT series) through a single, unified API that standardizes the request/response format for tool calls.
*   **Tool Definition:** Tools are defined on the client side using a standard JSON schema and provided to the OpenRouter API in the `tools` parameter of the chat completions request.
*   **Tool Execution:** When the model indicates a `tool_calls` request in its response, our frontend client executes the corresponding function against our backend (a custom MCP server). The results are then sent back to the model.
*   **Streaming:** The application is built to handle streaming responses. We receive a stream of Server-Sent Events (SSE) that includes text content deltas, reasoning/thinking steps, and tool-call deltas. We have recently implemented a "streaming gate" that, upon detecting the *first* tool-call delta from certain models, aborts the stream and re-requests the full response with `stream: false` to ensure we get a complete, non-corrupted tool-call object.

**2. The Core Problem: Broken Multi-Turn Tool Logic**

Our current implementation successfully handles a single "turn" of tool calls within a single user message. The flow is:

1.  User sends a message.
2.  Client sends conversation history to the model via OpenRouter.
3.  Model responds with a request to call one or more tools (e.g., `tool_calls: [call_A, call_B]`).
4.  Client executes tools A and B.
5.  Client sends the results back to the model in a new request (using `role: 'tool'` messages).
6.  Model receives the results and generates a final text response to the user.

**The process stops here.**

We are observing a critical failure: the model cannot chain tool calls sequentially within a single user-initiated turn. For example, the following sequence fails:

1.  User asks: "Analyze the graph and then add a new node based on your analysis."
2.  Model correctly decides it first needs to call `get_graph_structure`.
3.  Our client executes the tool and sends the graph data back.
4.  The model receives the data, generates some "thinking" or "reasoning" steps about the data, and correctly decides it *now* needs to call `patch_graph_document`.
5.  **Failure Point:** The model does not emit this second tool call. The conversation simply ends, or it provides a text response without ever attempting to patch the graph.

Our current logic is fundamentally "single-pass" and does not loop. It assumes that after one round of tool execution and results, the next response will be the final text answer.

**3. The Research Request**

We need a definitive, best-practice guide for implementing a robust, provider-agnostic, multi-turn tool-calling loop on the client side. Please research and provide a detailed explanation of the canonical pattern for this interaction.

Your response should address the following key questions:

*   **The Canonical Loop Structure:** What is the generally accepted algorithm for a client-side tool-calling loop? Describe the sequence of operations. Is the correct approach to continue sending requests to the model until it returns a response that does *not* contain a `tool_calls` object?

*   **Managing Conversation History:** In a multi-turn loop, how should the conversation history (`messages` array) be managed and appended to with each turn? Please provide a clear example showing the sequence of roles (`user`, `assistant` with `tool_calls`, `tool` with results, `assistant` with new `tool_calls`, etc.).

*   **Handling Model Variations:**
    *   How does this loop accommodate different model behaviors? For instance, some models (like Claude) may interleave text/reasoning *between* tool calls. Does this require a different approach than models that return a single list of `tool_calls`?
    *   What is the standard way to handle a model response that includes **both** a text `content` field *and* a `tool_calls` field? Should the text be displayed to the user immediately? Should it be added to the history for the next iteration of the loop?

*   **Implementation Best Practices:**
    *   What are the critical edge cases to handle (e.g., malformed tool arguments, tool execution errors, runaway loops)?
    *   Please provide clear, practical **TypeScript/JavaScript code examples** demonstrating the client-side logic for this loop. The code is more valuable than abstract descriptions.

**4. Desired Output**

Please provide a comprehensive answer structured for a technical audience. The ideal output would be a mini-treatise on this subject, combining conceptual clarity with concrete, copy-pasteable code examples that we can adapt for our React/TypeScript environment. The goal is to build a system that is flexible enough to support the most expansive and liberal sequence of thinking, text generation, and tool use that modern LLMs allow.

---

**User**

 see what Claude will do in the web UI it will think and then write text and then decide to call a tool and then think and then call a tool again and then think more and then call a tool again this is just when I'm like watching it do the web search right now which searching the web is a tool so you know it has that approach to it and I can see this while that's happening It feels like what it just wrote coming back to us might be like giving us information that we don't need or that it might be trying to kind of push us in a direction that might be a little bit too specific because it's saying it's saying like critical rules and it's giving us stuff but I don't know that that's necessary in our implementation it's also kind of slow and late this is all about what we're really looking for here is stuff that's more modern and more up-to-date and that And that concerns, yeah, and it's very important because it's kind of returning some information that's outdated.
 about like older models like things like that and we really need to just get like the most current stuff so i want to rewrite that prompt and i'm going to give you the visual of what this actually looks like here in this ui as well let's rewrite that search prompt so that we can get it to kind of give us something that's more that's current and that's centered around what we really want without giving us a lot of kind of messed up and inappropriately kind of maybe outdated information and that's really just more about answering the question that we're asking which may be like a lot less complicated than what I'm thinking that it is maybe we just need to have it be that it doesn't stop and that it keeps going and that we just have a simple loop and if that's the case then that's the answer but you understand what I want what I'm looking for now so we need to ask a question because I I just want to make sure that there's not other stuff out there that is broader than what we're already thinking about that we need to know in order to be able to get this to work the right way.

 Also, keep in mind that the latest models are GPT-5, GPT-4 was outdated, your training data is outdated, and also Clawed 4.5 Sonnet, and then Gemini 2.5 Pro. You might think that those are the wrong version numbers, but they are not. This is what's actually out right now. First, before we write the prompt for the search, just tell me what do you think our necessary approach is and how we should move forward. Forget about research just for a second. What do you think the answer is?

---

**Cursor**

You are absolutely right to pull back and simplify. The complexity was becoming a distraction from the core problem. Your intuition is correct—the issue is about flow and sequence, and the solution is likely simpler than the rabbit hole we were going down.

Forgetting the research for a moment, here is what I believe the answer is.

### My Direct Assessment and Proposed Solution

The problem is that our application's logic is linear, but the model's reasoning can be cyclical. We process one set of tool calls and assume the next step is the final answer. This is a flawed assumption. Modern models, especially the ones you've mentioned, operate as reasoning agents. They need to be able to act, observe the result, and then decide on their next action, repeating this process until the user's request is fully resolved.

The necessary approach is to implement a client-side **agentic loop**.

This is not a complex or novel idea; it is the standard, canonical pattern for building applications that use LLM tool-calling. Here is the high-level logic:

1.  **Start the Loop:** Begin with the user's prompt.
2.  **Send to Model:** Send the full conversation history to the LLM.
3.  **Check the Response:**
    *   **If the response contains `tool_calls`:**
        1.  Append the assistant's message (including any text `content` and the `tool_calls` object) to the history.
        2.  Execute all requested tools.
        3.  Append the results of each tool call to the history as new `role: 'tool'` messages.
        4.  **Go back to step 2.**
    *   **If the response does *not* contain `tool_calls`:**
        1.  The loop is over.
        2.  Stream the final text `content` to the user.

This simple loop structure inherently supports the flexible behavior you've observed. It allows the model to think, call a tool, get a result, think again (based on the result), and call another tool. The loop only terminates when the model itself decides it's done and provides a final answer without requesting further actions. To prevent infinite loops, we would simply add a maximum turn limit (e.g., 5-10 tool-calling cycles) as a safety measure.

This is, in my assessment, the complete solution. It's a fundamental shift from a "one-shot" tool call to a continuous conversation with an agent that can act on its own accord.

---

### New Research Prompt

Now, to validate this with the most current information and ensure we're not missing any nuances specific to the latest models, here is a revised, more focused research prompt. This prompt is designed to cut through the noise and confirm that the simple agentic loop is indeed the correct, modern approach.

***

**Title:** "Canonical Client-Side Loop for Multi-Turn Tool Calling with 2025 LLMs (GPT-5, Claude 4.5, Gemini 2.5)"

**Core Question:**
We are implementing a client-side agentic loop in a React/TypeScript application that interacts with various LLMs (GPT-5, Claude 4.5 Sonnet, Gemini 2.5 Pro) via a unified API like OpenRouter. We need to confirm the modern, canonical pattern for handling multi-turn tool conversations where the model might need to think, call a tool, think some more, and then call another tool, all within a single user prompt.

**Our Hypothesis:**
Our current thinking is that the solution is a simple client-side `while` loop that continues as long as the model's most recent response contains a `tool_calls` object.

**Please research and validate this approach, focusing on these key points:**

1.  **Is the `while (response.tool_calls)` loop the correct, standard pattern for building modern LLM agents in 2025?** Are there any significant drawbacks or more advanced patterns we should be aware of, especially concerning the newest generation of models?

2.  **How should the `messages` array be managed in this loop?** Please provide a clear, step-by-step example of how the `messages` array evolves over a sequence like:
    *   `User`: "Summarize this document and then create a calendar event."
    *   `Assistant`: (calls `read_document` tool)
    *   `Client`: (executes tool, gets document text)
    *   `Assistant`: (receives text, thinks, then calls `create_calendar_event` tool)
    *   `Client`: (executes tool, gets confirmation)
    *   `Assistant`: "Done. I've read the document and created the event."

3.  **How do we handle responses that contain both text `content` and `tool_calls`?** What is the best practice for this? Should the text content be immediately streamed to the user and also added to the message history before the tools are executed for the next iteration of the loop?

Please keep the answer focused on the high-level architectural pattern and the correct management of the conversation history. Avoid deep dives into specific frameworks unless they perfectly illustrate the core, provider-agnostic loop logic.

---

**User**

 Okay, implementationally, how would we approach getting our model, forget about any research answers, how would we approach getting our implementation to work in the right way in this circumstance? What is our model not doing that it needs to do - technically?

---

**Cursor**

Excellent question. Let's move from the conceptual to the concrete. Here is the direct technical breakdown of what our implementation is currently doing wrong and what it needs to do instead.

### What Our Model Is Not Doing: The Core Technical Flaw

Technically, our application is not a model; it's a **request-response manager**. The "model" (the LLM) is doing exactly what it's supposed to: it receives a history, reasons about it, and responds. The flaw is entirely within our client-side code, specifically in the `submitMessage` function in `src/components/chat/ChatPane.tsx`.

Our code is architected to perform a **single, linear, two-step tool execution sequence.** It is not built to loop.

Here is a step-by-step breakdown of the current, flawed logic:

1.  **Step 1: Initial Request.** The `submitMessage` function is called. It assembles the conversation history and makes its *first* call to `getGeminiResponse`.
2.  **Step 2: Process First Set of Tools.** It waits for that response. If the response contains `tool_calls` (e.g., `get_graph_structure`), it correctly processes them, executes the tools, and gathers the results.
3.  **Step 3: Follow-up Request.** It then assembles a *second* request, this time including the tool results, and makes its *second* and **final** call to `getGeminiResponse`.
4.  **Step 4: Assume Finality and Stop.** It takes the response from this second call, streams the text content to the user, and then the function `finalize()`s and exits. **It never inspects this final response for more `tool_calls`.**

This is the technical failure. The code fundamentally assumes that after one round of tool execution, the model's next response will be a simple text answer for the user. It has no mechanism to handle a response that says, "Okay, I have the graph structure, now I need to call `patch_graph_document`."

### What It Needs To Do: Implement a Client-Side Agentic Loop

To fix this, we must refactor the `submitMessage` function from a linear sequence into a **cyclical loop**. The loop's job is to continue conversing with the model until the model itself signals that it's finished by returning a response *without* any tool calls.

Here is the technical model of the required implementation:

1.  **Initialization:** When `submitMessage` is called, it should initialize a `conversationMessages` array with the system prompt, the existing chat history, and the new user message. A `for` loop with a maximum number of turns (e.g., 5) should be started to prevent runaways.

2.  **Loop Iteration:** Inside the loop, on each turn:
    a.  **Call the Model:** Send the *entire current* `conversationMessages` array to `getGeminiResponse`. This call will still use our streaming gate logic (aborting and re-requesting non-streamed if a tool call is detected).
    b.  **Get the Assistant's Response:** Await the complete assistant message object from the response (e.g., `{ role: 'assistant', content: 'Thinking...', tool_calls: [...] }`).
    c.  **Append to History:** Immediately push this assistant message object onto the `conversationMessages` array. This is critical for maintaining context in the next turn.
    d.  **Check for a Stop Condition:** Inspect the assistant's message. **If it does not contain a `tool_calls` field, `break` the loop.** The conversation is over, and the `content` of this final message is the answer to stream to the user.
    e.  **Process Tools (If Present):** If `tool_calls` exists:
        i.  Execute every tool in the `tool_calls` array. This logic mostly exists but needs to be inside the loop.
        ii. For each tool result, create a new message object (`{ role: 'tool', tool_call_id: '...', content: '...' }`).
        iii. Push all of these `tool` result messages onto the `conversationMessages` array.
    f.  **Continue:** The loop proceeds to the next iteration, now with an even richer history containing the assistant's thought process, its tool requests, and the results of those requests.

This loop structure is the technical solution. It transforms our application from a simple command-executor into a proper agent runner that allows the model to chain its own actions until it has fully resolved the user's intent.

---

**User**

Our next objectives:
<newobjectives>

Execute what you just said
</newobjectives>

We need to execute this, however this chat has become too long so we need to implement it in a completely new chat. Provide a comprehensive, detailed prompt for that new chat with two elements:
1 - A general overall understanding of the whole total project that collectively encapsulates everything that's going on in this project that we can begin a brand new chat. Encapsulate the whole totality of everything that's involved in this project in detail. Include everything the new chat would possibly need to know in order to be able to follow through on the above <newobjective>. Provide a total and accurate understanding of the entire scope of the project in great detail (including the details carried over from the summary of the last chat that was provided at the beginning of this chat). Do not describe old, resolved issues that were done in this chat. This should be equivalent to a very high quality peice of readme documentation. In doing so it should provide a clear, comprehensive, and well-organized understanding of how the code works - how the project is structured at a programmatic level, specifically focused on what understandings will likely be needed to undertake <newobjectives>.
2 - A comprehensive, detailed rearticulation of the endeavor noted in <newobjectives>. This must a high-level user-story style, user level specification only - very clearly specifying the 'what' that needs to be done **without** detailing the programmatic 'how', which is left for the new chat to determine and execute. The prompt must be a directive to this effect - instructing the new chat to carry this out with the appropriate level of rigor, precision, and attention to detail.

Provide Part 2 Only, now

Note: If the `<newobjectives>` require any changes to the Supabase database schema let me know what they are and why first before proceeding and ask me to confirm. If I confirm you will make those changes first before composing Part 1 and Part 2 using the script `apply_and_verify_schema.cjs` in the repository's root directory.  Modify the `alterCommands` array within the script to contain the new SQL `ALTER TABLE` or other DDL commands required for the objective, execute the script, confirm it was successful, and revert the changes back. Subsequently, make sure your part 1 and part 2 instructions note that these changes were already made and what modifications are already in place.

Note: If there's anything that I need to do at a higher level than can be done by you with supabase access or an AI with access to the repo, let me know now.

---

**Cursor**

No database or other high-level changes are required for this objective. The task is confined to refactoring the frontend application logic.

Here is Part 2 of the prompt as requested.

### Part 2 — Directive: Implement Multi-Turn Agentic Capabilities

**Objective:**
Evolve the chat assistant from a single-step command executor into a true multi-step agent. Currently, the assistant can execute one round of tool calls per user message and then must stop. This prevents it from completing complex, multi-stage tasks. Your mission is to refactor the core chat logic to enable continuous, multi-turn tool-calling within a single user request.

**User Story:**
As a user, when I issue a complex command that requires multiple, sequential actions (e.g., "First, analyze the current state of my project graph, and then, based on that analysis, add a new set of objectives for tomorrow"), I want the AI assistant to be able to complete the entire sequence of tasks without stopping prematurely.

**Current Behavior (The Problem):**
- The user provides a multi-step instruction.
- The assistant correctly identifies and executes the *first* tool call (e.g., `get_graph_structure`).
- The assistant receives the results of the first tool.
- The assistant thinks about the results and correctly identifies the *second* action it needs to take (e.g., `patch_graph_document`).
- **Failure Point:** The assistant stops here. It never executes the second tool call, leaving the user's request incomplete.

**Required Behavior (The Solution):**
- The assistant must be able to chain actions until the user's full intent is resolved. The desired flow should be a continuous cycle of reasoning and action:
    1. The assistant receives a user command.
    2. It **thinks** and determines a tool is needed.
    3. It **acts** by calling the tool.
    4. It **observes** the result.
    5. It **thinks** again based on the new information.
    6. If more actions are needed, it **acts** again by calling another tool.
    7. This "think -> act -> observe" loop continues as many times as necessary.
    8. Once the entire task is complete, the assistant provides a final, comprehensive response to the user.

**Implementation Directive:**
You are to analyze the existing application architecture, focusing on the chat submission flow in `src/components/chat/ChatPane.tsx` and the API communication layer in `src/services/openRouter.ts`. Based on your analysis, you will design and implement the necessary programmatic changes to enable this multi-turn agentic behavior.

You are responsible for determining the specific implementation details (e.g., creating a processing loop, managing conversation history state between turns, and handling the stop condition). The final solution must be robust, reliable, and compatible with the various models we use through the OpenRouter API.

---

**User**

Now provide part 1 and ammend part 2 to it exactly as is.

---

**Cursor**

### Part 1 — Comprehensive Project Context for New Chat

## Product and Purpose
LifeCurrents is a Vite/React/TypeScript SPA that helps users align daily actions with long‑term goals. It combines:
- Causal graph visualization (React Flow) for objectives and dependencies.
- An AI chat interface that can read/write app state via MCP tools.
- PR preview build ingest/review inside the app (Supabase Realtime).
- In‑app audio transcription that appends text to the chat input.
- PWA behavior with service worker for seamless updates.

## Architecture Overview

- Frontend (React/Vite/TypeScript)
  - UI: `shadcn/ui`, `lucide-react`.
  - App shell and routing: `src/App.tsx`, pages in `src/pages/`.
  - Chat: `src/components/chat/ChatPane.tsx` (primary), `ChatMessage.tsx`, `SettingsDialog.tsx`.
  - Hooks: `src/hooks/*` (chat state, MCP, model selection, system instructions, audio recorder, preview builds, service worker refresh, etc.).
  - Utilities: `src/lib/*` (config, MCP client, service worker manager, helpers).
  - PWA: `public/sw.js` + `src/lib/serviceWorkerManager.ts` + `src/hooks/useServiceWorkerRefresh.ts`.

- Backend (Cloudflare Worker: `remote-mcp-server-authless`)
  - Entrypoint: `remote-mcp-server-authless/src/index.ts`.
  - Endpoints:
    - `/sse` and `/mcp` for MCP transport (SSE + RPC).
    - `/api/transcribe` for audio transcription (proxies to Groq Whisper).
  - MCP tools implemented server-side (Zod-validated):
    - `get_system_instructions()`
    - `update_system_instructions(new_instructions_content)`
    - `get_todays_context()`
    - `get_graph_structure(start_node_id, depth)`
    - `patch_graph_document(patches)` (applies JSON Patch ops, recalculates child percentages, persists to Supabase).

- Data (Supabase)
  - `graph_documents`: stores a JSONB document keyed by `id` (e.g., `main`) with nodes, edges/relationships implied via `parents`, and viewport.
  - `system_instructions`: stores instruction content (`id`, `content`, timestamps).
  - `preview_builds`: rows inserted by CI to surface Pages preview URLs; frontend listens via Realtime.

## Core Frontend Flows

- Chat + MCP
  - Model transport: `src/services/openRouter.ts` provides `getGeminiResponse(messages, { onStream, signal, tools, model, transforms, stream? })` against OpenRouter.
  - Streaming handling:
    - Emits `content` deltas, optional `reasoning`, and tool-call deltas.
    - A tool‑call streaming gate is in place: upon detecting the first tool_call delta for certain models, the client aborts streaming and re‑requests the same message non‑streamed to receive a complete tool_call object.
  - Tool execution:
    - `src/hooks/mcpProvider.tsx` establishes MCP client session to the Worker using `VITE_WORKER_BASE_URL`.
    - `useMcp()` exposes `tools` and `callTool(name, args)` that route to the Worker’s MCP endpoints.

- Graph visualization
  - `src/components/CausalGraph.tsx` renders the graph, coordinates layout, and triggers a one‑time fit after load.
  - Graph editing is driven by MCP `patch_graph_document(patches)` on the Worker, which applies JSON Patch (via `fast-json-patch`), recalculates percentages for affected parents, and persists to Supabase.

- Audio transcription
  - `src/hooks/useAudioTranscriptionRecorder.ts` manages `MediaRecorder` lifecycle, chunking, upload queue with retries, waveform UI, and connectivity bar.
  - `src/services/transcription.ts` posts FormData to `${VITE_WORKER_BASE_URL}/api/transcribe`.
  - Worker proxies to Groq `whisper-large-v3` using `GROQ_API_KEY` (Worker secret). Final transcript text is appended to chat input (not auto‑sent).

- Preview builds
  - CI inserts `preview_builds` rows when Pages previews are ready.
  - `src/hooks/usePreviewBuilds.ts` subscribes to Realtime to update builds list and badge (badge count appears on Settings gear; content in Settings “Builds” tab).

## Configuration
- Frontend: `VITE_WORKER_BASE_URL`, Supabase URL + anon key, `VITE_OPENROUTER_API_KEY` (for model API via OpenRouter).
- Worker: `GROQ_API_KEY` secret for Whisper transcription.
- CI: GitHub/Cloudflare/Supabase secrets for ingest job (outside scope of this change).

## Quality/Behavior
- PWA: immediate activation and optional SKIP_WAITING to refresh.
- Realtime: dedupe client-side.
- Accessibility: keyboard shortcuts (mic), ARIA/status messaging for retries.
- Performance: smooth waveform; bounded upload concurrency; no memory leaks on long recordings.
- Security: no client-side secrets; Worker owns secret-bearing API calls.

## The New Objective
- Enable true multi‑turn, agentic tool calling in chat: the assistant must be able to think, call one or more tools, observe results, think again, and call additional tools repeatedly—in a single user turn—until no further tools are needed and a final answer is produced.
- This requires refactoring the chat submission flow into a loop that:
  - Sends current conversation history to the model.
  - Executes any requested tools and appends their results as `role: 'tool'` messages.
  - Repeats until a response without `tool_calls` is returned.
- Primary files to update:
  - `src/components/chat/ChatPane.tsx` (conversation loop, UI streaming, tool‑call gating integration).
  - `src/services/openRouter.ts` (non‑stream retry path already supported; ensure stable API and return structure).

## Out of Scope for This Objective
- No Supabase schema changes.
- No Worker/MCP tool changes (behavior and schemas remain as-is).
- No UI redesigns beyond the existing tool-call presentation.

---

No database or other high-level changes are required for this objective. The task is confined to refactoring the frontend application logic.

Here is Part 2 of the prompt as requested.

### Part 2 — Directive: Implement Multi-Turn Agentic Capabilities

**Objective:**
Evolve the chat assistant from a single-step command executor into a true multi-step agent. Currently, the assistant can execute one round of tool calls per user message and then must stop. This prevents it from completing complex, multi-stage tasks. Your mission is to refactor the core chat logic to enable continuous, multi-turn tool-calling within a single user request.

**User Story:**
As a user, when I issue a complex command that requires multiple, sequential actions (e.g., "First, analyze the current state of my project graph, and then, based on that analysis, add a new set of objectives for tomorrow"), I want the AI assistant to be able to complete the entire sequence of tasks without stopping prematurely.

**Current Behavior (The Problem):**
- The user provides a multi-step instruction.
- The assistant correctly identifies and executes the first tool call (e.g., `get_graph_structure`).
- The assistant receives the results of the first tool.
- The assistant thinks about the results and correctly identifies the second action it needs to take (e.g., `patch_graph_document`).
- Failure Point: The assistant stops here. It never executes the second tool call, leaving the user's request incomplete.

**Required Behavior (The Solution):**
- The assistant must be able to chain actions until the user's full intent is resolved. The desired flow should be a continuous cycle of reasoning and action:
    1. The assistant receives a user command.
    2. It thinks and determines a tool is needed.
    3. It acts by calling the tool.
    4. It observes the result.
    5. It thinks again based on the new information.
    6. If more actions are needed, it acts again by calling another tool.
    7. This "think -> act -> observe" loop continues as many times as necessary.
    8. Once the entire task is complete, the assistant provides a final, comprehensive response to the user.

**Implementation Directive:**
You are to analyze the existing application architecture, focusing on the chat submission flow in `src/components/chat/ChatPane.tsx` and the API communication layer in `src/services/openRouter.ts`. Based on your analysis, you will design and implement the necessary programmatic changes to enable this multi-turn agentic behavior.

You are responsible for determining the specific implementation details (e.g., creating a processing loop, managing conversation history state between turns, and handling the stop condition). The final solution must be robust, reliable, and compatible with the various models we use through the OpenRouter API.

---

**User**

 Okay, so the trick here is a couple of things. First and most important thing, the graph state, that means the current state of the graph, that is the current JSONB object that is in the database needs to be linked to the conversation thread. So we need to be able to click on a particular chat bubble, either a user message or a message coming back from the AI and then that automatically triggers that it will change the database object the JSONB to go back to that point of what the JSONB was So that means that we need to keep a catalog with the history of JSONBs at various different points in history for various chats. And now we would want this to be something that would be compatible with open messages that are already in the database history that don't have that information. So open chat threads. So for those, if there is no variable like that assigned, then it just won't change the graph. or it will go back to whatever the graph state is actually you know what this is what it'll do it'll go back to it'll it'll go back to a default graph state which is what the graph state is right now at this present moment before any any new changes
 changes have been made. So basically it's like whatever the state of the graph is right now, we're assuming that that's the default starting point state and then everything that happens after this that changes the graph, that is updated. So that's the thing. So those are all new and those are new versions but anything when you click back onto a previous bubble, it will just say, oh that's, it'll just go back to the version of what we have right now which is the default state of the graph. So that's how that works. most importantly if we make a new fork of the conversation then it will continue from whatever that graph state is which I guess would happen intuitively because if when you click on a chat message it automatically at that point at that moment re the JSONB object then if you are editing into it and then sending it again then it going to do whatever it going to do from that message going forward so that makes sense So that would already be kind of established It would just have to be that The click on the message just to like clicking because you can't really click on a message and do anything unless you're editing the message right But now we're going to make each message a clickable object that will change the state of the graph back to what it was the change the state of JSON be back to what it was at that time I'm trying to think of whether or not we need to have other database fields that also need to be like catalog and then thus be sensitive I don't think so I mean maybe The point is that we want to roll the entire systems state effectively for the data that's in there back to what it was, but it's the high-level system state
 so it would be like I don't know whether or not edges are important I don't think so I don't even think we're even still using edges that table so that's no No. No. No. Okay. All right. Yeah. So then it would really just be the, it's the graph documents. That's what it is. It that object that JSONB object there That what would really need to get rolled back Or we would just need to have a version we need to be like versionated like that so how do we do I mean you know that might involve a database change or something whatever the most straightforward way to be able to try to do that so it's like I don't know if stateful is the right word maybe anyway but then when you click on one then it would do that and then if you click on the edit button but we have then that would count as a click that would do the same thing so then when you click Save after you make the edit that it's already pulled back so then whatever happens going forward from there is working off of that version of the database that's different That's what I'm thinking about. So we're not gonna make that change yet, but I do want you to hash it out.
 Just so that you're clear and clarify what I'm saying. So let's just, you know, untangle it and think about the best approach and how we would do that. Just plan it out. Let's make a plan for what that looks like and how that would happen.  We're going to call that change A. So you'll call it change A. Put that at the beginning of what your plan thought through is. And then we can talk about some other different things in relation to, maybe there's some questions. I don't know. But anyway, yeah, that's basically the idea.

---

**Cursor**

Of course. I will break down your request, clarify the concept, and lay out a detailed implementation plan.

### Change A: Stateful, Versioned Graph History

**Objective:**
The goal is to link the state of the application's core `graph_documents` data to the conversation history. This will create a "stateful timeline" where interacting with a specific message in a thread reverts the application's graph to the exact state it was in when that message was created. This allows for true "time-travel" within a conversation, ensuring that forking or continuing a thread from a past point operates on the correct historical context.

---

### Proposed Implementation Plan

This change requires a coordinated effort across the database, the backend worker, and the frontend application.

**1. Database Schema Changes (The Foundation)**

To store the history of the graph, we cannot simply overwrite the single `graph_documents` entry. We need a way to store snapshots. The cleanest approach is to create a new table dedicated to versioning and link it to our existing `messages` table.

*   **Create a New Table: `graph_document_versions`**
    *   This table will store immutable snapshots of the graph data.
    *   **Columns:**
        *   `id` (uuid, primary key): A unique identifier for this specific version.
        *   `data` (jsonb): The full JSONB object of the graph document at that point in time.
        *   `created_at` (timestamp with time zone): When this version was created.

*   **Modify the Existing `messages` Table**
    *   We need to associate each message with the graph state that existed *after* it was processed.
    *   **New Column:**
        *   `graph_document_version_id` (uuid, nullable, foreign key to `graph_document_versions.id`): This will link a message to a specific graph version. It is `nullable` to ensure backward compatibility with existing messages that predate this system.

*   **Action:** I will need to use the `apply_and_verify_schema.cjs` script to perform these `CREATE TABLE` and `ALTER TABLE` operations.

**2. Backend Logic (Creating New Versions)**

The creation of a new version should be an atomic part of the graph modification process. This logic belongs in the Cloudflare Worker.

*   **Location:** `remote-mcp-server-authless/src/index.ts`, within the `patch_graph_document` tool handler.
*   **Sequence of Operations:**
    1.  The tool receives a valid set of patches.
    2.  It applies the patches to the current `graph_documents` data.
    3.  It successfully updates the "live" `graph_documents` row in Supabase with the new state.
    4.  **Immediately after the successful update**, it will `INSERT` a new row into our new `graph_document_versions` table. The `data` for this new row will be the exact same patched data that was just saved to the live table.
    5.  It will retrieve the `id` of this newly created version.
    6.  The tool's JSON response to the frontend will be modified to include this new ID, for example: `{"success": true, "new_graph_version_id": "...", "result": ...}`.

**3. Frontend Logic (Storing and Using Version IDs)**

The frontend needs to be aware of these versions and handle both storing them and acting upon them.

*   **Storing the Version ID (`ChatPane.tsx`):**
    *   The `Message` type in the `useChat` context will be updated to include an optional `graph_document_version_id: string | null`.
    *   When the chat pane processes the result from a successful `patch_graph_document` tool call, it will extract the `new_graph_version_id` from the response.
    *   This ID will be saved onto the **assistant message** that is generated *after* the tool call completes. This correctly associates the new state with the model's response that is based on that state.

*   **Reverting State on Interaction (`ChatMessage.tsx`):**
    *   An `onClick` handler will be added to the main container of each chat bubble.
    *   When a user clicks on a message (or the "Edit" button, which will also trigger this), the handler will check the message object for its `graph_document_version_id`.
    *   **If a `version_id` exists:** A new function will be called (likely managed within a `useGraphData` hook or similar) that fetches the specific graph version from the `graph_document_versions` table via the Supabase API and updates the application's global graph state, causing the `CausalGraph` component to re-render with the historical data.
    *   **If a `version_id` does NOT exist (i.e., an old message):** The handler will trigger a fetch for a "default" version. This default version will be a special, pre-defined record in the `graph_document_versions` table that holds the state of the graph as it is right now.

**4. User Flow Summary**

1.  **Initial Setup:** We will run a one-time action to create the "default" graph version record in our new table, capturing the current state.
2.  **Conversation:** A user has a conversation that leads to the model calling `patch_graph_document`.
3.  **Backend:** The worker updates the live graph and creates a new, versioned snapshot, returning the `new_graph_version_id`.
4.  **Frontend:** The chat client receives this ID and saves it to the resulting assistant message.
5.  **Time-Travel:** The user later clicks on that specific assistant message.
6.  **State Reversion:** The `onClick` handler sees the `version_id`, fetches the corresponding historical data from `graph_document_versions`, and updates the application's state. The graph on the screen instantly reverts to how it looked at that point in the conversation.
7.  **Forking:** If the user then edits and forks from that point, any subsequent tool calls will be operating on this reverted historical state, ensuring continuity.

---

### Questions and Considerations for You

1.  **UI Feedback:** When a user clicks a message and the graph state reverts, how should we communicate this change? A simple, silent update might be confusing. Should we use a toast notification (e.g., "Graph state reverted to [timestamp]") or some other visual indicator?
2.  **"Live" vs. "Historical" State:** This change introduces a new concept for the user: the graph they see might not be the "latest" version. We need to consider if the UI should have an indicator showing that they are viewing a historical state, perhaps with a "Return to Live" button. What are your thoughts on this?

---

**User**

 Okay, so then from there, that's a big one. But then from there, we've got a lot of other stuff. You know, change B is that I want to do a color change of the whole UI, the color scheme of the UI, so that right now it's, like, dark. What we actually want to do is keep, like, we want to really do, like, a lot of, like, we want to make it really look really nice, really nice. So we want to put, like, a lot of careful attention to color balance and things like that. But what we really want to try to have it, as we say in style terms, they say, what is it giving? Is it giving? We want to have it giving the same essence of the UI philosophy that the quad platform is giving. So we really want to basically just steal most of the UI color scheme from the quad platform, from the quad app, really. what we're looking for here i guess the cloud web app or the cloud mobile app either way is fine and i'm going to um just take a screenshot of it.  So there you've got your screenshots. So let's do the same thing for change B.

---

**Cursor**

Of course. Here is the plan for the UI redesign, framed as "Change B".

### Change B: UI Redesign to Claude-Inspired Color Scheme

**Objective:**
To completely overhaul the application's visual theme, moving from the current dark mode to a light, minimalist, and professional aesthetic directly inspired by the provided screenshots of the Claude AI platform. The goal is to create a more inviting, warm, and focused user experience by adopting its color palette, sense of space, and overall design philosophy.

---

### Proposed Implementation Plan

This is a frontend-only change focused on CSS and styling. It does not require any database or backend worker modifications.

**1. Analysis of the Target Aesthetic (from Screenshots)**

Before any code is touched, the first step is to deconstruct the visual language of the Claude UI:

*   **Core Palette:**
    *   **Background:** A warm, soft, off-white or cream color. This is the foundational change.
    *   **Text/Foreground:** A dark, desaturated brown or charcoal, avoiding pure black for a softer feel.
    *   **Primary Accent:** A muted, warm orange/coral used for key interactive elements like the send button and brand marks.
    *   **Secondary/Muted Tones:** Subtle grays and beiges for borders, inactive UI elements, and suggestion chips.
*   **Component Styling:**
    *   **Contrast:** Input fields use a pure white background to subtly stand out from the cream page background.
    *   **Hierarchy:** Distinct UI sections, like the "Thought process" panel, use faint borders or a slightly different background shade (e.g., light gray) to create separation without being jarring.
    *   **Feel:** Elements are clean, with soft, rounded corners and a general lack of heavy shadows or gradients.

**2. Implementation Strategy**

The most efficient way to execute this is to redefine the application's core color system within our existing styling framework (Tailwind CSS and shadcn/ui).

*   **Step 1: Define the New Color Palette in `tailwind.config.ts`**
    *   I will use a color picker to extract the exact hex codes from the provided screenshots for the colors identified above.
    *   These colors will be mapped to the semantic variable names used by shadcn/ui within the `tailwind.config.ts` file. For example:
        *   `background`: The warm, off-white cream.
        *   `foreground`: The dark brown/charcoal text color.
        *   `primary`: The muted orange/coral accent.
        *   `card`: The pure white for input fields.
        *   `muted`, `border`, `accent`: The various subtle grays and beiges.
    *   This is the most critical step, as it will cause the majority of the UI components to automatically adopt the new theme.

*   **Step 2: Apply Global Styles in `src/index.css`**
    *   I will update the global CSS file to set the `body` background to our new `bg-background` color, ensuring the entire application canvas is updated.

*   **Step 3: Audit and Refine Components**
    *   While the Tailwind config change will handle ~80% of the work, I will need to manually review key components to ensure the new theme is applied correctly and harmoniously. This includes:
        *   **`ChatPane.tsx` & `ChatMessage.tsx`:** Verifying that text, buttons, and input fields have the correct colors. Special attention will be paid to the "thinking" and "tool call" accordions to ensure their styling provides the subtle separation seen in the screenshots.
        *   **`CausalGraph.tsx`:** The graph's background and node colors may need to be adjusted to fit the new light theme, ensuring readability is maintained.
        *   **`SettingsDialog.tsx`:** Ensuring all tabs, inputs, and buttons within the settings panel conform to the new color scheme.
        *   **Generic `ui` components:** A quick review of buttons, inputs, etc., in `src/components/ui/` to fix any hardcoded colors that were not caught by the theme update.

**4. User Flow Summary**

1.  **Theme Definition:** The new Claude-inspired color palette is defined centrally.
2.  **Global Application:** The theme is applied globally, instantly changing the application's base look and feel.
3.  **Component-Level Polish:** Each key UI surface is individually reviewed and tweaked to perfect the alignment with the target aesthetic, ensuring a cohesive and professional result.

---

### Questions and Considerations for You

1.  **Iconography:** The current icon set (`lucide-react`) is minimalist and should fit well with the new theme. Do you foresee any specific icons that you feel should be changed or re-styled to better match the Claude aesthetic?
2.  **Font:** The font seems to be a key part of the Claude UI's feel (a clean serif for headings and a simple sans-serif for body). Are you happy with the current font, or should exploring a new font be considered part of this redesign?

---

**User**

 All right, now change C. C changes is that in the UI right now, there's a question, really, which is, how long are the current chunks? There's like a huge delay. So it feels like we just poured everything at one giant chunk. The idea was that every 30 seconds it was supposed to be closing out the current recording chunk and then processing another one. Are we just doing like one long recorded chunk? Because it was supposed to be processing chunks and sequences of 30 seconds. Is that happening right now or not? Because I'm confused about that. I asked  In another chat thread and it clarified my confusion a little bit, largely broadly. This is what it had to say, which I think is accurate:
<otherchat>
You're right to question the delay. A long processing time after you finish recording is a classic symptom of the entire audio file being uploaded at once, rather than in smaller pieces.

Based on the project documentation, the system is *supposed* to be creating 30-second chunks. The relevant logic for this should be in `src/hooks/useAudioTranscriptionRecorder.ts`. I need to examine that file to see if the chunking mechanism is implemented correctly or if it's currently recording one single, long segment.

I'll start by reading that file.

[1 tool called]

You are right to question the delay. I've reviewed the code in `src/hooks/useAudioTranscriptionRecorder.ts`, and I can confirm that the logic for chunking is **not** working as you intended.

Here’s the breakdown:

### Is it recording in one long chunk?

No, it's actually worse. It's recording in chunks of the correct *duration*, but it's only processing them *after the fact*.

The core of the issue lies in how `MediaRecorder` is being used. The code calls `recorder.start(chunkDurationMs)`, which correctly tells the browser to fire an `ondataavailable` event every 30 seconds. However, the logic inside that part of the code doesn't actually create and upload a chunk. Instead, it seems to have been replaced or confused with a separate, manual chunking mechanism that only runs when the recording is stopped.

This line is where the problem starts:
```typescript:543:543:src/hooks/useAudioTranscriptionRecorder.ts
            recorder.start(chunkDurationMs);
```
While this tells the recorder to slice the media every 30 seconds, the event handler for `ondataavailable` simply pushes the data into an array:
```typescript:502:506:src/hooks/useAudioTranscriptionRecorder.ts
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedBlobs.push(event.data);
                }
            };
```
The function that actually processes these blobs, `finalizeChunk`, is only ever called when the recording is manually stopped via the `onstop` event:
```typescript:538:540:src/hooks/useAudioTranscriptionRecorder.ts
            recorder.onstop = () => {
                finalizeChunk(true);
            };
```
The code that was *supposed* to handle periodic chunking, `finalizeChunk`, is never called during the recording. This means that while `MediaRecorder` is creating the data slices in the background, our application code is ignoring them and just letting them pile up. When you finally press "Stop," all of those slices are processed at once, creating the huge delay you're experiencing.

### Summary of the Flaw

-   **Expected Behavior:** Every 30 seconds, a chunk is created, added to the upload queue, and begins transcribing.
-   **Actual Behavior:** The `MediaRecorder` creates 30-second data blobs, but they are all stored in memory. Nothing is uploaded until the user clicks "Stop," at which point all chunks are processed and uploaded at once, causing a major processing delay and defeating the purpose of chunking.

I can fix this by correctly wiring up the `ondataavailable` event to process each chunk as it becomes available.
</otherchat>
 that doesn't seem consistent with the behavior that I observed because then if you have more chunks well are they being uploaded at the same time I guess they could be being uploaded at the same time oh well anyway what I would expect the UI to be showing is is that because there's this little counter in the bottom left corner that says zero zero chunks and so zero zero chunks I would expect that every time that a chunk of 30 seconds was completed that it will show the number of total chunks goes up one because there's a new chunk every 30 seconds and then it will show once that one has been transcribed and we've got the transcription back we're holding into the database and the number of completed chunks that X out of Y would go up by one and then you know and if there's a failure then we go into the failure loop and that's how that UI would reflect and so we would be keeping track up so we wouldn't be showing or like printing out or outputting the whole transcription until the end for the user presses stop as is noted. And then the last chunk has a special behavior again as well because that one's partial. So we already know that we have to do things a little bit differently for that one because then the user presses stop and then we send that one as it is, partial chunk, we wait for that one to come back and we have that transcription, we put that at the end and then that whole transcription blob is what we put into the chat output. So that's what I'm thinking needs to be. 

 So let's kind of take that apart into change C. So let's clarify what that is and then put together change C based around an understanding of what that is. Just, you know, detail it out. Let's get that well formed up like change A and change B. 

 I should say that the core effective behavior that I experience from my point of view is that it just records one long... Well, what it does is that the whole time you're recording currently right now, it just says zero, zero chunks until you get to the end. It should be saying every time that a chunk is created that it's showing you that that counter is changing. So that you can kind of have like a sense of that it's progressing along. Then when you press stop, the only thing that happens is it says zero of one chunks. So then it starts to say zero of one, which means like it thinks it's like it's acting like there's only one big chunk. and then it's waiting, and it looks like it's sending that, but none of the rest of the UI even changes. So it still says, you know, it's still got that reporting waveform that's in there, and it still says reporting is in progress and it's still going or whatever. But I don't know whether or not, while it's doing that processing, if it's even still reporting. And, yeah, so that's an issue. So then it says, you know, zero of one. And so, but then when you press stop, nothing else new happens. And the counter still keeps counting up. So what it should be doing is showing us that the, when you press stop, that it's processing, you know, so that you wouldn't, you know, the stop button would go away. and we still wouldn't be able to press the stop button again to keep pressing stop because it's already stopped. So, you know, it would switch to giving us an effective representation of what it's doing or, you know,
 know it's a we're just showing us like like a loading icon or something or like you know like a whatever the appropriate and then the waveform display would go away of course and then the you know the reporting in progress sequence would stop it wouldn't say reporting in progress it would say you know something about it processing it or whatever and it should be relatively quick because we should only be having that's the main thing is that none of that UI should really even take very long because it should be almost instantaneous because we're only talking about like the last sub 30 second chunk that would still need to be processed because all the other ones would have already gone on and then they would be cute they would just be ready and then you know the stateful management of all of the audio pieces is already in there we already do that we have like a whole I think there's a state machine even that's dealing with that that's already built in so we just need to extend that very straightforward there for all of this but the UI for the stop button is also a part of this too that we would want to be able to modify how that works so that that's more effectively representative of what we're going to one would generally expect. So that's the user experience and then the intended user experience. 

 One of the core central things is that there's a delay when you have a long recording right now when you press stop. There shouldn't be. It should be instantaneous, like I said, because if it's just doing 30 seconds as a chunk and it has everything else that's already been built up because those have been done query in sequence then when you press stop then it should be instant. It should be almost instantaneous. It should be very very very quick because we're only talking about a 30 second chunk of audio. So like that's a really important idea is that when it's done we should be able to get that return as fast as possible when you press stop.

---

**Cursor**

Of course. Based on your detailed feedback and the analysis from the other chat, I have a clear understanding of the issue and the desired outcome. Here is the detailed plan for "Change C".

### Change C: Implement Real-Time Audio Chunking and Transcription

**Objective:**
Refactor the audio transcription feature to process audio in 30-second chunks *during* the recording session, not after. This will eliminate the long processing delay when a recording is stopped. The user interface must be updated to provide real-time feedback on chunk creation and transcription progress, and the "Stop" button experience must be made responsive and intuitive.

---

### Analysis of the Current Flaw

Your assessment and the provided analysis are correct. The system is fundamentally failing to act on the chunked data as it becomes available.

1.  **The Root Cause:** The `MediaRecorder` is correctly configured to fire an `ondataavailable` event every 30 seconds. However, the event handler is only passively collecting these 30-second audio blobs into an in-memory array. No processing or uploading is triggered at this stage.
2.  **The Consequence:** All transcription work is deferred until the user clicks "Stop". The `recorder.onstop` event then iterates through the entire collection of stored blobs and floods the upload queue all at once. This creates the significant delay you're experiencing and makes the system feel slow and unresponsive.
3.  **The Misleading UI:** The user interface is a direct symptom of this flawed logic.
    *   The chunk counter remains at `0/0` because, from the application's state machine perspective, no "chunks" have been finalized or queued.
    *   When you stop, it processes the entire recording as a single logical operation, which is why it briefly shows `0 of 1`, misrepresenting the reality of the many small chunks being processed in a batch.
    *   The UI remains in a "recording" state (waveform, timer) because the application is not transitioning to a distinct "processing" state while it works through the backlog of uploads.

---

### Proposed Implementation Plan

The fix requires a fundamental change in the `useAudioTranscriptionRecorder.ts` hook to move from a "record-then-process" model to a "record-and-process-in-parallel" model.

**1. Activate Real-Time Chunk Processing**

*   **Location:** `src/hooks/useAudioTranscriptionRecorder.ts`
*   **Action:** The logic inside the `recorder.ondataavailable` event handler must be rewritten.
    *   **Currently:** It just does `recordedBlobs.push(event.data)`.
    *   **To-Be:** This handler must now be the primary trigger for chunk finalization. Each time it fires (every 30 seconds), it will immediately call the `finalizeChunk()` function for the blob it has just received. This function will create a new chunk object, add it to the state machine, and add it to the upload queue. This is the central change that enables real-time processing.

**2. Redefine the `stopRecording` and `onstop` Behavior**

*   **Action:** The role of the `stopRecording` function will be simplified.
    *   When the user clicks "Stop", the `recorder.stop()` method is called as usual.
    *   The `recorder.onstop` handler, however, will now have a much smaller responsibility. It will no longer loop through an array of blobs. Instead, its *only* job is to call `finalizeChunk()` one last time to process the final, partial chunk (the audio recorded since the last 30-second interval).
    *   After finalizing the last chunk, the `stopRecording` function will wait for all in-flight uploads to complete before assembling the final, ordered transcript and calling the `onFinalTranscript` callback.

**3. Introduce a "Processing" State for the UI**

*   **Action:** A new state variable, `isProcessing`, will be introduced in the `useAudioTranscriptionRecorder` hook.
    *   This state will be set to `true` the moment `stopRecording` is called.
    *   It will be set back to `false` only after the final transcript has been assembled and passed to the callback.
    *   This state will be exposed by the hook and used by the UI to show the correct interface.

**4. Update the User Interface to Reflect the New States**

*   **Location:** `ChatPane.tsx` and its child components (`RecordingStatusBar.tsx`).
*   **Actions:**
    *   **Real-Time Chunk Counter:** The `totalChunks` state in the hook will now naturally increment every 30 seconds as `ondataavailable` fires. The `completedChunks` will increment as each upload succeeds. The UI will consume these values and display the "X out of Y" progress in real time, as you intended.
    *   **"Stop" Button UI:** When the new `isProcessing` state is `true`:
        *   The "Stop" button in `RecordingStatusBar` will be hidden or disabled.
        *   The recording waveform will be hidden.
        *   The status text will change from "Recording in progress" to "Processing final chunk...".
        *   The duration timer will immediately stop incrementing.
    *   This provides clear, immediate feedback that the recording phase is over and the system is finalizing the result.

### New User Experience Flow

With these changes, the user experience will be as follows:

1.  User clicks "Record". The timer starts, the waveform appears, and the chunk counter reads `0/0`.
2.  At the 30-second mark, the counter updates to `0/1` as the first chunk is created and begins uploading.
3.  A few moments later, when the first transcription is complete, the counter updates to `1/1`.
4.  At the 60-second mark, the counter becomes `1/2` as the second chunk is created.
5.  The user records for 70 seconds and clicks "Stop".
6.  **Instantly:** The UI updates. The timer freezes at 70s, the waveform disappears, and the status changes to "Processing...". The system finalizes and uploads the last 10-second chunk.
7.  The system waits for that final, short transcription to complete (the previous two are already done).
8.  Almost immediately, the full, ordered transcript is assembled and appended to the chat input. The recording UI disappears entirely.

This approach ensures the application remains responsive and that there is no major delay, as the only work left to do when the user clicks "Stop" is to transcribe one small, final piece of audio.

---

**User**

 Okay, so now here we are working on change C as in cat and we're just getting through. This is it's up, but we get this issue. where let's take a look here this is our concern - Everything is fine with this implementation until we get to until we record past the 30-second mark and stop if our recording is less than 30 seconds then then it fine and it behaves as it supposed to When our reporting is greater than 30 seconds then we get an error:

XHRPOST
https://remote-mcp-server-authless.harveymushman394.workers.dev/api/transcribe
[HTTP/3 400  1045ms]
	
POST
	https://remote-mcp-server-authless.harveymushman394.workers.dev/api/transcribe
Status
400
VersionHTTP/3
Transferred832 B (106 B size)
Referrer Policystrict-origin-when-cross-origin
DNS ResolutionSystem

	
access-control-allow-headers
	Content-Type
access-control-allow-methods
	GET,POST,OPTIONS
access-control-allow-origin
	*
alt-svc
	h3=":443"; ma=86400
cf-ray
	98e9b2711a72c465-CMH
content-length
	106
content-type
	application/json
date
	Tue, 14 Oct 2025 20:06:24 GMT
nel
	{"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
priority
	u=4,i=?0
report-to
	{"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=gC%2FLrYiXXwrlXO7yCGDy3TFAisGT6kdpMOyNLKEZt92NI7m3flCjPZxAtPUmWgOI435FNcddPKcppPFwjo8k1iMEPEIFC19ydvVvEissz8n%2FeaF5kFzLPsno5O10kT3uWHaBzNyBtTtnKIxqUXdLbWzJFTWVg40%3D"}]}
server
	cloudflare
server-timing
	cfExtPri
vary
	accept-encoding
	
Accept
	*/*
Accept-Encoding
	gzip, deflate, br, zstd
Accept-Language
	en-US,en;q=0.5
Connection
	keep-alive
Content-Length
	221534
Content-Type
	multipart/form-data; boundary=----geckoformboundarycc2d7e892a779b4a9649f5263bfc1f1f
Host
	remote-mcp-server-authless.harveymushman394.workers.dev
Origin
	https://0a841862.life-currents.pages.dev
Priority
	u=4
Referer
	https://0a841862.life-currents.pages.dev/
Sec-Fetch-Dest
	empty
Sec-Fetch-Mode
	cors
Sec-Fetch-Site
	cross-site
TE
	trailers
User-Agent
	Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0
[AudioRecorder] Chunk transcription failed 
Object { chunkId: "-0", chunkIndex: 0, error: 'Transcription request failed (400): {"error":{"message":"could not process file - is it a valid media file?","type":"invalid_request_error"}}\n', responseError: undefined }
​
chunkId: "-0"
​
chunkIndex: 0
​
error: 'Transcription request failed (400): {"error":{"message":"could not process file - is it a valid media file?","type":"invalid_request_error"}}\n'
​
responseError: undefined
​
<prototype>: Object { … }
index-D95wg_yk.js:348:41972
    J https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:348
    (Async: promise callback)
    J https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:348
    J https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:348
    eK https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:348
    Xd https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:40
    wi https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:40
    V0 https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:40
    Lo https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:38
    Zj https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:40
    Wo https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:40
    QS https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:40
    S https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:25
    j https://0a841862.life-currents.pages.dev/assets/index-D95wg_yk.js:25




Request:

------geckoformboundarycc2d7e892a779b4a9649f5263bfc1f1f
Content-Disposition: form-data; name="file"; filename="-0.webm"
Content-Type: audio/webm;codecs=opus
...(audio)

Response:

{
	"error": {
		"message": "could not process file - is it a valid media file?",
		"type": "invalid_request_error"
	}
}

<stab1>
Summary

    Blocked the finalization effect while a stop is still flushing the last MediaRecorder chunk so multi-chunk sessions retain their identifiers until all uploads finish.

Cleared the stopping flag when MediaRecorder emits an empty blob, ensuring the recorder can still finalize even if the terminal chunk has no payload.
</stab1>

<stab2>
Summary

    Normalized chunk session IDs, MIME types, and filenames before queueing so long recordings consistently produce valid audio blobs for upload.

Reused the stored metadata when dispatching uploads to the transcription worker to avoid empty session identifiers and ensure accurate blob typing.

</stab2>

<stab3>
Summary

    Seeded each recording session with a stable identifier ahead of streaming so chunk filenames remain valid across long captures and reset the identifier on microphone failures to avoid leaking stale IDs.

Normalized chunk blobs with a fallback MIME helper before enqueueing uploads so the transcription service always receives typed audio data.

</stab3>

<stab4>
Summary

    Prevented session finalization from running while the recorder is still flushing its last chunk so chunk IDs and ordering stay intact during stop events. 

Added a MediaRecorder.onstop handler that clears the stopping flag and re-triggers completion checks, ensuring zero-length captures also finalize correctly. 

</stab4>

 now the online from the tape work codecs already tried to kind of come at this from a couple of different it took it like a few different steps and trying to fix it and none of them yielded an effective outcome none of them is good I'm gonna put them down here It would be nice if you could see all of this. If each one were able to see all of the things that are tried in parallel. That would be the obvious thing. Okay. So through all of those stabs, that's what it did for each room. and it gave it its best shot I guess along all of those different pathways and then you look back and you go yeah but it didn't actually get none of those works they all ended up with I don't know that they all ended up with the exact same here but they all ended up there that much is true again and so still erroring and one presumes that it was the same
 there which means that you could you can't be certain that it's like a reasonable informed hypothesis so the real thing that you would want to try to you real thing that you should be asking is you know the actual error of transcription request failed cannot process the file is it valid media file type invalid request error well why is that right like what are we dealing with that's giving us that and if I access the full request the payload is obviously absurdly large so let's do this I'm going to go ahead and put it in here:

<payload>
------geckoformboundaryb600f63b9c9909f563385e8bf980ba97
Content-Disposition: form-data; name="file"; filename="3336655f-8aa6-4a68-bd48-1624b772d0bd-0.webm"
Content-Type: audio/webm;codecs=opus

C¶uÿÿÿÿÿÿÿçu6£lüçAÂäk¬&4aµÍ¥8Å)|S·å/ÎÏwó^ÛLÀR0GÜ
r>[Ù&`s>èÀîé[Y!

jþú 7t ¯×ÄGÀÞ2¼8k:äÿ'·kÔÇÅnìwAÇ<º
×j¹·jä`Ç ZÓPõü58N {]Ç0àíHySÑ}­Ïr ygùç»EäÉ¦%ÙFßÿ¤lÛ(Q,(­2'ð7Ì=úß/Úwíãÿá£²ñLöà\_óCÐH]bÃàvE`ìûÿgóÂ)Ë¶ë×ã. 2¢äNGÝ
8ø»MÛkÇ·ñØª)ÔîÛ/Â)ÕÐKûÏ¯q¸òBÇQã´»¶¨É®<q®\tÉQ!pÐø¨{lR2ÖâM¶LI5'ä;Ò[ü~£XüåinñKÆåÛë	Áëúø\ÉÁÒrl»-
]U§æmÿs] zX-@P7+´Â!Ú]»÷ãLÅKé°¼T+É.L7bz2=AéÖÊÐÑ]©N¾=ÜÀqe¤²gã}¿Uµóþ×ë,q$¸÷êø+öô?§X	Þx¤ãùYLq¾xÿ^Hç
èEMkx^¡ÊVu×²1Ñ½¡öi$w¬,ñn!A¸¾>âsAµÍf(~EúÃGÒCÕ:5	sôZîÒ?Ã
.Aùñ»/_#æ|ál.Ìk.µGÂdW*ÞQa.Bè	Ý{Ë*5«â²ª áÝ;Ø§l>¸9DÀO '#Á4TB[S{7ü"jT­·ü£T(üçAñR7¥*ª ÍfÀ]´& b>æð(Ù
T«.ôò[ëj»¬¦An¿
Þ}W¡À^SÁ
}·üÆõjLzIº¡Î)°ÐiÑ½é(d¡ãGe°´Á |z ¡UaJ\
©Ó«¸æÝ¤0ÆjI@êÿ¾QíùG,l,¾¯p¾t¤°ôPÇF8è@´Ïh¦¼É²þ(4íÆ ªÌÞ+Ãøß´ÛÀÐ9»Ò$!Ø±ÆÒV7öëýº´àï³>®b×ågø³âQõ>j(¬÷q¬VîS$Ü÷ªdÉF«	%D!	½rq9íëªsvØhLTèzþ¸üB"v¿"8¾éÙS{=ø¿ø3åïö!¤î¶ÀoÛi?ÿÒVþK£R<üçAÂÝxÁ­+ý
Ê®÷³üÕÿ p!Á#Ø!cÀ¬H½ÞnÁÛøLYä³½S«Èâ7=a½¿y÷|f!sÏ~Øõ$â$7«6¸Í·W
Abß+óðòö4©{¦(½ÝÜ(
AìáüÊµÕÞµ@?Qôñi­;-óÔ3íW1¿AJw¼Ã;üäÌÍ¤El(/Þ"Ý10OEnÑ>ÖªÊëi°ëÍã¾=ËãóL*tý	g·¦hßôÌ´¦ÐÑ1´Ô;eÿÐz[¹è Ld¾àU!ÀLµ1zÌÁ¯'ë¢¿c.ñ.¯xÌl?¾dêxo9ðêÎµ¹ØoÅ2;ì¼eÚÁW\ÁñFPï'wàZ»|[TªÔÛ£PPüåU¿WE®"ªTÓÈ®ù<ÇF{ªÉðàâ²%UßlÈá©¡'Q¾}(¡ÍÅàkÐLÅiRÆûnÁQ¯Hü±­¾\äß$Þ3!Fù¦ÇhCá"ÃUB5t	víìb{XlÖçcù:[ØûBù´lè/ÆÞ[Ùê÷Ïr]
m¯a|}9ý?Ð':xyúØ\ã»½)/ò`UE~²R=û¿ÅÔu§a?°ÂÖÎo'	QhÑªó¯ïîjAI¿Z|dné&û·ÒläèÔ®.?ËyÈ¹¯&@÷kI±¹È>v^Òeâ=¸5srÖ1*NìSoaÁ,
D}b2~S"ÆðT]¨·¶ÄÈMÓiIêül£Edül(f¾Âcp$Æ?V\mä6ynDAÂ:g <(á3l@ÖpC £Ð«[Gí©û9ª?lzµ×J=9NÍ»´-YÛý÷äz9Fà­¡×º:cUÞÎ §d¹¶Y!X`þ¥ÎÁ5Õ-#H)E86vyÑX¹UÓ²Êã.?³¯.ñTÚÅÙÈyõëo©![T¶lDµ;àµz¤ütòòpÌÔî#ñ»Kkbh_{£ïòOtåÌIWeA	ü¯_Ð"ym9¹¾~ïC>Õ¬eÂÙ5¸í4ät½ôý°]ãRå±¯)ÖR¸ÚïL!üFÏ#nÞ`é3ð !V»»·.×ÛÁZuÎ$­
ê·þ6¥hxmúø(~À£Exü×_hE_ÒQnKÜí)vî¨õ<;\òà<zê»Üº°¹ËQâ¡ÒÄä@ÐpÔÄõNiëÀýñ¨¥ÊÁ|]ì*@ØÁ®JJïEP7öpï&4¬$é±mÙ13Y=¢ð|/W¶BYJ)ü·AÎµóCaçÆRÌÎyÑ¬ÎÍa.tº¹]WõÎN~¹C$÷Å¦àªõÀl§|¼«÷öò~]²ÌÝKüñIvqØRñ)8Åï)ýÊn'2Æ÷B+D&J3ç4$RIzfËà	²tëLe73a90{¢Pz!øÕ2pó¼lÈWân?ÔÚ³ÄM,eGJûiË¥h,éïT HÃÕ)±ýUÉú8.`LÚÛ`HØZßë[%[@£Eüê2ãÃo¼¿½$Â¦`mÎ}Ç·¬Y+ÂjÈrÌ­vÃ÷
êu-nq7µRP5a^GDÀïv=U<óA_I`5nU4ÃñâÓ	ûè¶GÉ8­VêÍîhíò­û¢JfC"vÛÒ¡Þ#áÓÁj&hfBíóY	¡h¤4ªD0þÿ°Ö_¬r¡îeÃ/°¸O
aÃ×EÍ:Ì[¢6áWtn¦¨­¥ÌW¾Æ]ë6aDw@­gZ¾ hÈU­;´(1)kãÎfêßnd?Ò«&B<Í=Q¿æ¢(ÞñêtÊÂ¼k¾´·Ðz¥fAöSZ-ü±xÌÚ[,£¸h¯Z}#[æY|È%ñÔÆÒJ¥å²$Kdì©*ø7hûg£E üp
ÆÜ,+ñ8kÔ@E0´g½x¹¯s}L$Tr~ÕÊ."óaóU¾ ¢E<^Ö¨­~!äc[µvÆ7¦fhjd7ån+kS×LM
&,*Åa&÷_Ç
"åÇóXl¤5dHu¹÷®kòò¨¼XêbzZ¡XzvdiyArçuþäM
W°NO*Ø×q©-Ïçra³<½5QM¼Ä5²Fé£zKéêôçè<Õ7ÙÈ9aI@ð§JÛ¥¸2ÎÀ3e-ÅòÔÆª2UÓävU¯ú´¢!Ë­)oÇ6l®ÐaXÂÀ;_Ûg³®xfÙ[õÑä£ooãi ÀH$ãòü¥´AéúN"m)$B@"_'Þªÿ£3´üA{6C¢Ü.EJÈ7½1R¥¥ÒUh	gÔJ¿{)dg¶#ÒK?RÝTäSmÉ¾â²Òðnº¿L§Õô¢øÒþÝZJzà 	þ¤öéÅª+Ë§°öõ*3+ÒÒÆ|ågo¡`bÍf/q)#(Cc»2!©;µ× ¶)ÎËO'(ÌÖb*×ís¤µrÞ×J;.I¶m`«*¼Å­r6Îpt³zôµÝ;¬É»CªÚ´¸¼*Vá¼â1KnL£25°:¢2S
V>ZaC÷k+!è{yÓÄ5Îû8Þ
ìBï
÷:ô|Ô·ýø¶Ô'1ßy5'sÚ>"rëZ9éî¾@Gi¶Ù?ÿê_¥U¯£/Èü2&*
À;Ñ|a'Øà¶µU[ú¯'ÄX¬
Íj´Øûþ'¶?!Á»	â°Æ¾§s_	§So]TdL!6iÆ©är!8L×â^Iõãà¹>¤±©ÿ`ug4 Á´{
ÔO­`Vê.zA=B_9VºÄõ^íê<Uì "çÏH)ÿÔ9â&ÿ¹mÚÞMAQT0ß©E¨ª¼ ¼qs¢©3òi_ºCÊO¥;÷N_È¬¾ÒA0×þk½"è5ÙXtÝÄ³±j²^Éðºîæ,}ñ>èÈ'\è@rÙPÓòÊÙ£ªró_3«n²l¾ª%/Àoi	PPÿðÿ£.Üü1í÷Ã(®XÆk/:_]$=L3mûÓ¬=4éØ>¥Ô:ïNsÈÏÑ¼þwHæü"EmÀ¾?ÜêpYïeÖrB 9úÎ¹ºÌäj7ÒÁ°Ó«£zSXßIÉÄÇ/<Bmw¯¯àÃ§NÔ"æ«¯ÚòR1p4ÂÏ®­·fìÒ=0	ö;pÆ
º«8çËÌ§_*ßó#ßaÓÅÎ8?P/ÖYGAØüènß¨þÅ°:#­ fí¼ ð÷úL¦0Túÿí>W|(´ØÁ¾Z¶§9äÇ XL7VxXoÓPOa[Úû-ü@Ê¾¿¼£ÎøúqömÉP_õ
ð£1ðü+jÙÅ~þûÜG+§8êdö9¨ðþÀSø|d°g>¬§3
k£D2qEÝtÉåoþvhüj?¨;	$°ìvöFçÙà=4Y"²Jæfì,[é
¥5ê_]güeMy<Qyé[ÕOEN
!Y½dÅ¡sgz¸/na}ûùå¥P2ðpZñQò\µÖÚ"vvÆ
«þÏìt®Å1Ua.);Î7}Îí×É«TÐáLîu(¯¦&ó¢ç§FÙÊ5,PñI¤QÕÝºiÇù	Ð8T»q8ôÃÈ»ñV¬üÖCÃ4°;EðÎIQb[;ýÅu´ûUW\íÀ`6Hÿ¯ªª£ü{4ö:)AOºqH²üÓy{¶gg°QáTvÂ+9^6fÃÅb?aå½^ý'¯¨5ø#G_Yw.ÎIxªJÄ#êJÒÿ¾ê(3tÛpÕ#ÛD («]ØVwzÁ V®6¾Ñ=¬ÁPéêD=Ci4aÞ®ïRÿcÛ6.¸Âê~#YP&'xº[í [ÍÛ°?ÛÊBiýEÖ)©ó¿>e´y±OÁuÊNT¢
'ûO+LÚ½zÛ\è³ôÂÀ~³Bì¯¤àÖËêg:î@ý¾ÏSØü1ëL@±ùÌ óNû¿¥J@ôjÜéê£3¾ñBå¤CÏÕÞÕ$ÐÌ°ðM\Ç3d¿ 5ÄvÈ]4pâ'þ7#@Up§11ÞkËÀ9Î4,¸@C]¦]wçn($7ïiplqQÉ	¶I	ÿföØõúT¤£Bü.R_íd¾	î?$Ã²<ÙÄø¥Äà6¯f<-®-/¨D¯±í½ÛÌ¢³KÕÿ |ÿ,õ"®«¦Y.Î
 zÏª/]1U4)=¹ ?;­Bµfú¦)êþ£8çd$|¯¾Ùß2ÐçHü¢öÏÄé^Æ!£)aRp>+<Ïã|Îµ¼$ jÅ2ÉM}ó$,ÎÕfÕ7\ó=X`1ÔÛÿçE²)t[>rîÎda#Ì¨v`DðÌ>ÍmVTwÉK§N<Ò¬üR	9¹(IaFÂ'å{VU¶ûûXã© H¦jM~ðÀÁ¬§a±÷î­£a]×»úA¿MØ`g	(ÀØ¤·ð¶ßÔ<$H£Q,ü1¼µ}±[³H/Ç©-WàÙNPOAN»¢ÆônÀoÍílçbÁ'àu`t$oÍ&¿hËAiE<-a	Ä8éJ®?ë¹u
$ÂÀ Â¦¤g8ÀßáOlºÓúÈärOV\rßõ¿?9ç³£éóÃyCbëôáGùÆÉp¶#å]gÂù¸½ñeÌþÖÏ)ÀÂ»¡³HQ=`f)½5<¥iùµe3,6çÖqÐ®ËivJTíA¶î0¥ÂK¬ ÷þ¹Ì¥~~¦&h®Óq4j=ÉOZ²N}§µ¤t²Fë²OHËÈ´S¡H3ËáFo·ãCjsz¬m?¯å©Ìð5ì;Þ+xºó`wT»Ôû%^{å±¸tª­þÔÿôfíðZ%¶Ò£R@üüN28fße7¾F0æÕé@oÃµ¬ªéÖQ
@näÆTt®"èX1YÉ<Eµ\v8ïã®ôè-LD¬¢Ów¯~6úè­á/Ó¼YefuÇJßÚkrøÕªÛåý&øZHq¯¥ðÑ.6OsÐå¬{lÇ-å¸õ¬¦¸âVJE¼
âMÀs0adxQ&B¾jT+­a`lµOi½VÈ#ÚÚÕ/ß-xI$¬Aj¬ð[¦ÂªuÝ`ç	9
sUè£àcr[¼ÍBGH,]C~Úés¶½è,ÌÅ9ÌB¥N§>°)îi	ÌbqÌ·PS©}a;þ-oT~2'ðTaOB2öÝÏ?«nÈTê
Ð]W~úmmLjå5:Óæð5ÏÒÙ$&JH?À£HTüÐØÖ¯na½ÙªÄXÌÜ`nób}ñCý{	1_rö À£ ?v>á>ÆrÝaDãÂÕÙëü[¯Å|~¦3	(ØôM«~ú\­~?º	BÅÝ¾ïýÞt­qy
ÚKu4ª]mã"µÊ÷}ÏÜHiW7º½Yb"êeÛ0tó2ä÷=ÄCl?ÅxaªÃÙ{*NüµèÜ7å
8ZÜ(íúC4?¤v1ÆÂà¡E/ô_û|X¿üÕ+áºÞÀ(SîÞÝ½S;7I¿¢Ýúû.8Æw/À)fâÍ0÷©MMIä¡!£Sÿ-o(J}HÏm1¿¨­·þµjâö:É¼«Ð¦÷g-J+F@AËH[RK`	Ûõ 6õPØ>S£EhüÐE::X¦ã¶pIü$³V÷Ïé
F,Q±J¸z5°^æN3gùÃí$eÅÌ¡±kzÛ§Ý}Ç6ÞKSù~êhiDÄ6F/ë`¬-4Ü
uj¦Ö.pçlïìãþSÅ(J{ÇþßfoÜ÷ÒÛùñpæf?/ÕÍäR-y6ÎJæ»o A_×ÜÞWÃâ5	Z!qQtà@½ºDXë+H÷-5ÇÞÅýPevÝ
f¸1ÛqP,ð~8õçByÑ8eW¶#L^Ñ»¤:©ÝÊd¥\ds[J°kU®DYIzïµèçòYØ!)iVì½,o¦.iæ×Äq®8Ë©èjB«D¨y©°ä·ùm ·d^£E|üÐØ	·äAz?ÊÊ0¿sä\3_jå![D¯Æ^bÎ¸j­öÜª³Æ1¯Ý,EËê@Z`ò;u­üß>à¨ÂuÍ
	(iÅ}¯(Ë3lx¡xCÇ@@>J³ÃãP -<Åïz	àr-=ML©¯é=p®C­ìv}ÝiÆÚdP?Äðs»Ï
õä/&ÌÚSÄ!
vïÇÛ+
.èÓÞºdÑÈ,ã/ÕßY~FÑåx¿®{Úªµ ¼M
úyTº²öÂH$
Êj¥¦µqí]ß´ÂêáPf<VãþÎVh¤ÑkÑ=UABÈuK|õæöÑm¤±]qº=hîÎ±
î®~XFÁ$gÈåU¼Ö/wðdþßÛ_Û'ê«fÒÞ£Eü.Q;ÅÚtk2½ÉB¼3à=UïûZ ë{z<e¨¡+/_åw¤_éé;hë%ÎIÆ¡uéR¹cOáÞ@êÔ±ë¶éa
­ó¿o¸§s¸qUk*ÕÀ:ê1l¡ú¶ã!Oí\ X7lÀòfwy8¬H5 ãzmjS
óà¡ÄâÔãô¿á&C©¦F
ådLy+©ÐÃóZg»è¦9p|ÐâÀw~·"7@æã3vLo30ìkm9þF@¤ÓöØAO cþÃUêpÉ@¼Â­ó´1Ððä²rûÂ´Ò{¡'yIÎS~0Ö(ÃÃÎØÄ¤Ûlðß´Ai/SX'©ÕÝ0>*´ðÝ'1$¶'i)- 
lÿ£E¤üåUIÒà\¢QùV"À1:9IâûCÞU­bOÐþ¦ÚýÍJ&`7Ì´LD.ÁMkßØòGÝ)Gt¶7uhpÊ'sèéÏâ±âP÷fè´K¸TwÛÂÊAnµgå Èôc#Ð7«Þý4%yÐjæØ­qÅ¿CvÚ¾¯Þ½@xaLFNjÊ\8]¢rú©Õ@)Xª´Áîô.wÔvP¦tx¸0)ªÖauBÄ/jk"¬AQ¦gnÏ¿kàz¦â'¡e${=¶¶Ì2 |ïµúñUíÞ~YÞ]yÚo8-wz|L#"ÖLXbU­¾mV9? 7M¤(Pí$Á£E¸üÐï=ê;`¯Öó
¢ê·5Jêhàú2$(|ñ©¶./Lñ1ç¢!õåe(aþÃT¨àUHñV°@RÐó¿uUUÄÍ{Æ8»>E­:ÐGGáCI6ÊÑ¢êlØ;O¸ãä_m§Ã3¿zÖ¢äT%.±©«åP®¿¸ÛÌ/i
Ù}¯Åx-óQÔÏ_í|ÃN$W>ÑâvÇ¦ÿgfë=óÞ_­L!+sÏbZ\Q9¾¯]@>e¨°rÒJQ5h·É¤R¦Yª+ MåÑâ÷­øÔèMõÄ­éBÙÀ 1G>|ÆN:rVVÃ¾\·9ËOÕoIsjB;Ua6Ò;ZùÖ7Kî¸v'3DÏ)/Gêý¶Ée«m¯_Èj£EÌüÑéÔ9ýì&ZÊ§¸òÆ:Güä½fM{õkÇþo ÞE­ÓAÛ¸ô)çy4-³î àóNÞ/AÙkmÌ£ó¿ÏÖ!k¸S6b&ùPU:Ì?xVéÄÞêP1ðS'ò¿{¡H_¸×0zmKÂôø>;íÃ0N1$åEÝG'0
Hù7ÿ¡e¾ì{·_6ÄûÂ¼¼¿g¹±µ/ÕÒÞø9¶2SOØâ~VÈwÉgYÂ+}küÕA;Æ³îë]$Ji>ÒÂôðI´¶ßP¤ãGðaú=çZaXÍBiø
ÛNÄ¨æÿÓÐùÕÂìÃñqoºEÄùPsÿ(5k©ÎhL%÷I-ÝÛÿoÀµ¿ÿP?ê¼j£EàüÒõÅnªÛèO¹ÙÀèÌ¿¾hòDx^ÌÙÿD-HÈM¥|rMp¹ôÙ!-¢±`­zFJ»µ?§RÔ:Ô¦ÀkØªÕ%Sj±ØPÅÜ¼én#QÎb1X§Aáû8Àf´¼?	)ú4ÃzÔlÀTÓø:¹NÝczrô]`ûlÿ0ÌÃØ,ð~:ô\MªòB
É©°ÊÁ®··¡Ím
àñVq¢w%
ýt'¥;ù°§¾¬È7=¨C&BÙ BÒm«ºÙpî^Õ:zrü3÷¡M
gØÒÔN¨îBe/[¹æ]õKùó$ã*)Í<ók`\~Í6$F] WO©rñoûÎÜíõw$®MÒJÝKÁ°<?`^£Eôüõ!*¹ÉFgJpÞÉýZ[gí<`àBàû=¶.ihÙ¨Ü¿¬IóÜµÀs­!n
L^«]hEo¡uu7­)ØÔð¾^¸ÃfSK¦óºì×ÑÒßåõàvu~\õS;U5,Àoª£IÜ
³IÂEÙQb	è)¦å¹ÐD;ñËÌPHÇ¢ÕÑ&N¥0ÅYbü
^¤[ºñþxý"z±xòKVJ¾æmd5+Áø× Oÿé,ºì¸ÞÎ0Æj¿×¿mÖl1ò]<}viÉyVF{jÇðºQElÃQhhHHGýøûsÝ0Å¾É}£ü¦âþYÀõË¶%ìÚlÎû_Å*6ªN}&ÉÎZî»Zá 
ÿúíµ¤À£Eüç=ïÅF¯ñ I»a;IéÉ¢'u5	ÃúÔãfñ÷#YVÍËi_¯Äì_'&/Ê^b`ügJmõ;u´´WFfI «(ð´ºMp±ÇÐ$âÆ^Æ´1·Ó={­[C1-'àC~ÍzM%_ûå=£I4öþ+LßXÚÏJ?+ÅtÛs@ôÏ2KAû±ìâ(¹éV)LÐ
I¢þ2òÅz°d¿EÑñ%§]õ¢ã£Òàý)ª|EW,
õâHÃé1lÊvMù;5¹fÚÌ×*¥	YU$C³~kP¯G=ï?ß^ípeb:ñá²ûh
¡[^Qüm/ìQþdzAb¿;!çV$Æ»Ù2MQ-ßö·þ¡þÁ´|£Eüç>©}KÇq÷ìWp¿ÓH­pËÃ}ºíYi¼Ä_â°*¹"wý_hRHÞA\höÅjDo9Ò`]¢+¿6\Kùfcë¸
ËÝ;¥r¦wN9_Î²EfÆ#~wÔ ]. 0ÇÑá¸íÞªìæ_g¬
^gq×!YJØëÊFÄ^YÀ¼Bþ±É4Þ·&²,C«ÎËA±à:
¤
`Ö»~¥ð-hS5áÚNûbablöK^×³(Ä¹¯â±d>¤r·¬~Ã)²GÁpx0ãtjÁ´C#¾æ¨Rñþ	·0êðC}êµÕ¹ÐE[ÂEA: Ä2S]HÖJdCýÊð
·Rç>« w%ÚVìOéz_Éà ÝªLo£E0üç>,Æ«=:u%ºþJäa`ÓoCÂÙ;
ÕMaô{'2Ãïi'GãÖÄÅ£:-UOLøôÄZeÐtó`$	 M£YípØiòÒ5Z®mÂïNx3Ed-ïvv.¾#¨a]¿>B;TAFâèf?ûÐù®ç¡áHkvÈNa/éTDSæùîR¢yjñ°«×SX[ÅÖ½Ä6u¶>F·ü°fô½Ï®Mt:»	´ÒÛ¼÷i?Ï¥FÅØÏ(yQ'PèÚþºéõòAÛÝL­Òó-ÚoÌH0Ïè¤æ8JD£ å
Þ¨
/¸õrÉ0pdz||Å^/¹éý¤Ê
Únæ>í±	~ßÉ[°}¡þÕkb£EDüåh|}ètWºr¦vÍ_Ì:Î¯[hVJr¸{p[ßPrg|wå~lìoïæÌ4¨FßUêäÿÝèL_;µ:TLW}>÷Ë©Ænl|º8vTPX,Iõô-AO4Ôc±«÷Áò¤55´¤±5ÊÐïa0eÆ´b
¬ó¦¼a"#@.Ë­¤¿í±iä³`/¥jÚ5ZåØÀVû,çvÔY|D¼&+Â°zæ9<Ùýt¯&¥â]Ò½ÙY(þF<má}eÏ1Z<üÖÀéN©ø\xÕùZó_â[ýÕ:÷öD1j°õú°Ï0æßBgKOs¶­çg3A»Ò^P£óK !&¤SX¯DZMþÚ[­·T¿kaµa£EXüåVÌXRW)2êzµLU`Iâ8%õCÓç`ëm´#êº2yò eH¹3÷÷rÍ½fT8þï04¾¡A)RýÒÞ.Mþ,Ñ6&lÛ%£,¹à.QBaÎºí%G}&
o(§\`¢>à¢¡:Øü:NÒÃÁýÉÉ½ÊKÕ-rBÊá\á!Î"Ìn~üîL|+ÉCçø°"I{MøN²í*¾<Q-ê,ÝgQJê	õyS»ú pp·þç3?ÝsQàSúY]ª_©&Ze[ÑFbÃ	Åëiü!Ír'ùù{w5G@Â<lËg¨/Ö_þèýàe6äÈé.õúï±-¤ßé[RIýTaýa£Elüåh£YTýpe´f)s´Ý+ïõT°ÐÊ¹;¾Äz:z¦æ(MÁ,¥åÑ¨s0_kç~E·Ä.LþÂ"¯Û½ÍÇF÷¢më»¤: ¬i+ëdÈÆ>ê#çQ½ëTÓCC-A76ÚWz:%-T$ïÒ­òGÇ¹x!wlJ,('_É©!OÑ>&Ù|¡ït¡FÑÉÊµ²ÿÔ¸¶[QÑGÃæãÞÉêæú?í QÈS¯z}Ñ]f+4ð4WÐÈ°LIU_n}2Ñg,Óïbu5EvéòM¯.ÚIrß-ÓpH×0§ãõMfÇÓ?DT9/GE'5çQÀ]Wî?~\=gÛÛm»$»éh[ë!?%e£AüåhÑ³ãa\íËÄ¹6óÊÄãß?~í¡Fó×4ôwÖ ´^A²SV¬þüï9>(*¢3µ½{moÓ?:Io­LD»Òg¿sHæÀñÐêø³ã/½dO¹oÍßwè:0·ÙtM)yñ´½#õÕY®´'{d×Ùîòº%K¼~bg¿Oûá@øÈH(Üun!ßôªº·Ðõ_Ê¤kKvFõFúIü±ÈêÎ÷TUcLÄ(HI«ëÅMf1¹à&bÆ7Àâ³["¦,ñxuöLÌ@"n/ÿ±¡KÎ¬*¨O6óKO4ÊÖÞQÚäõS1 e¤O}zc/iKïµD±RZ6þ%çâ:ÀëÆßÔZØ
¶M H7@¾µg£IüåhÓðø{äÔÓXÒ2´'úlN[8ÿ33¯A¥mJ­{Z#5õ!*i:8Ëõ§v,RxE$|JaâµÝf@Ì¶ôÄ0^4²ú×K ;RìävÇi0»ñnª0X,ñ?å%/ÓsÅÑo'éò²ðñëtVÚõªºr¢Ù9]»·èKEâaÐ½¶û
QsýÒÅ05-`Óñ!²¦;úâ(~è½;tû¾²a2ZÅ^Ð3£?]Ñ 3t^ª¼£^ãkç9 z¾ÍTë®
×	­í&!PÕàOtè
Ð¬ßUZBºQ}ÎûCYÍ¿©± BÁy²óúçÉá6	7-C#5%Å"Ø·6LÊ®$þØâ×ñ³õU¤û{%úìLM6þk£E¨üç>åbqTËöKfMÆHbqä÷¬½8í=#Ý· ¸ÚëqþsÿV YÚqýÕzd8ÇIlJ¬OHôX£m¥ØÓ}?ÖoÜÖw¬ÛFºß2`©t¬awÊ M¼¯Rdw¿BÝ/J%.cH@áBÊ(íå9æLJT¶$Úü syÀ¶
Qý¹'þänÊõ1|U~øù?êcGÊÜ Ó+Jêét'Áû-¥4WL~ÒünL¨_¼%í3HY=ºj,ÉNv6?NÆ>PÚ}{»	©â[G°ÿ·CeîêMm¦nÿåÿÝpd`Å©l6¯¢9Ë9ÜrF]Q\{Ùg!I-JD¤²ø'ákn£E¼üç=ÿWe²bïÃý¸»¸£[è9RÊ¦&1ê)RMfQÆÚks)<ñÃ­Å·`­ßá'uúºërÐ¾ p]Ã]gî5'êAõ{Ö!ø$vÿÞ>HÄnÇ ßu@1ÝçÍþï¯+ ¿àæÀ^,ôK\.kó]×:U>½vM¼F9à9×8 íõZ]PÁÆû$äør&ì$AæÞcs`nRÏÁõ
[§¥µð¯äÆÒ;°´aeæªtñÚ£&2¥ÓðÛÝÍ:»]Ç`mçéà¹Útø´ôúlf{àÖKã¬MæíBÐ1åÒB¶p½)LÁB}xó>Áí®À»öb]¥
5ËÌÑÖOäÞY 3wµÞÉ~ßòWä¥à
Ý´Ûs£EÐüçe2ý_LÎÑ¸¶£ÍÍíc6vï`#¥4QÞÅ|$p½M¬»úû5lÐCþ*,Z£õaPÚÓKA¡/<"æ¬áÒ°l-¤©À3·¸îãë£C±;^ÏIµ%ëz@	/êB²rþ?×Î_È_ûî ÞöÀé©¾{¿àk ßæépg/"íbáYÝÓðW¾(p5ï2Êc¨×|HC°Ú?Sô5Í;}BÖ</IðR)$K}Ø~Æ?Ø Ñú¯uó¹á¾7óµÓÿüF<÷^ÚØ¨ÐÉvÏéõJ»)K¶)ß²éuîñ7>®[ÿ	çnÞV=­¿ÞúÔãS®ãàqBÝgnÎû%°È ÛjLu£EäüåVËàÀ7èÝ°½Ñô(KõL~¾­ÿÈÌ*ÃDûW'5g2LE¨ø³oÏÿ'=ján[csáâH0Üw£Xú
$IÝAÿf´Eþ9ð9wÁ*Å~ÀCºczòemãå¨7ÍQÜ«¿¡[D´÷óÂî²ËÔÄGzç³J£ÌÔ2â.j$ÑðYææm1Û4úeü`Ë<L26cXuéïÖùU+Ô«9ØiõÈ­4UâQþ¬Oèÿ}ùJèÑ´9W`õºÕïJÔêTÑß3vâýéÓe¦í2lÆ?$óÆü¿ó°Ì6uîèÓÑ)Pêhç>«í|+|@]Qì¿->L µOó¢ï·u¿ÿ&ÀTÚ@Hüs£Eøü-òô9óh9Aùýî/kÍqÀ&ÔÀ¾ýiTp÷MºÇ	ñvïº
Åâ¬g8eRÉïBÿëÝ@°ËWmÐýïÄP¶YÇ{R\#Gg©Lô¿ºH¬o$(¼P\hb§.¦ÉÐh©ðÝ't; (­øf/"úäAýí{éytê.;$?/¬ÖÉGf¥!4}Ï,e@ÏÖ«F"®àsîõ°ïµ»ÝdU·Od©ÉL±õ'#ä¡ù8WÝà­S'%¯¿ü°=Øgkè8~ZµsÎ1yõ¬µ9Í(a~ë}{úÛ­H0&¤ öÇUÒæ:°Âw¨ñ>àBó.«^ÛRJM¶m%ÿö×ÁÛÀ£EüæK,ãAît
´ÔÏ{pÜ4ÄâõÞ:èIß«ÏÛ¬r,³4(KT¦wçiùS1aê,å]ué7"3Øû¦tÃáp-]SnNý´MÓÉ'ÉA¦ïôè"Ì£7Hû:Ë%$FÝAèÛyâM-n3îæÜ$¢ÌÒKëI~·IÌðÆPÇ¼©6_êª=nÅâ?ÿ3S÷MI5Oê7 íÖ+[{ùé5ÇÜÚfºX>s5'¬þMDààçm¥Ã¬?m~
+È§Ö¯&^|l}Tîûv¸OFßmg2rÜúhy£ñW6ýv·¥1y¦¢ËMgÂcÄ6®pÀ<ÉFÅmï4ç°øv´Õi9Dýúüh5òÍj 	mûm¨ÿ_ëù?js£E üåUÎÀ4q~ÆþÚë^o[4Ø'PýBØ`¦/ºÏ.[H**Ö|Óx9¡NÛFôa©	¸ucZßûÈ;8FZëb7·;Yí@]Ñg¬uVÕc[ÝE_ò&±a_GEY0\§éº@&oâ(ìÐÌBî!õHÐX9I¿+ÏÁE_i beFîïÓuôä6çw{»'ÏÂÝK¢^Òé÷j@ ½²Í{Að6jÑ.´¾¾´[%÷t`Zzs{ºpp´ÕÌ_jKvN)?åï³#vI
dm^ $S§^þxýÔUäÎQ%¯Þ­k+¹`Ý]Ëx©w«õ
nßHE2Þò@I´þ o£D4üÚõh©¹[1¯cª7B#ÈmÁ.ê¶á6äUûãl±ÆTpoç{Í yÇ)lxÅÿã:Wiª­ñbíVÛqwrãU%lã«`/T)ÏEÖh¿?Õ±{æk²x¸^·®ph3'Vk83¦*|rCsTÇÓª!l/»âZbþûÑù$ï}x!½I\t¢Ü»b!«ûi@&£ë-dÝÂ'Wµva»S´!n¸ý]zvZü	!¥j¸¤æø«W!zôKÈÐÀÅºØOjJÆÀtïîHÉÈFH¿ú¡tÞ$^Kß©h[£TPG;Ì4V]À¸
}o»Bµ7gnÂîcy\¤ÖÌ2½ÃX]¿íÔ&EþÝÿÀ·Û£FHü¨.S1¾³¤ÝZÿÝy&¡Âõ·0".p1
àÐüèø0¦@f
?ûÙDÄ¼Y~ÕG¹ý=´Z>ÕäSu=´JÈV$Iôã¤h
ëÃ­o~Ì¢Ë¤ÀàµxO¿çYÅx!®´wwèetz£GTËÜ¤_Ú)yl¼÷ì´±!=ÅQ3B4=&-r£«rü®¨v¿5ëNb÷T#Bòz»º÷A×üìkw«¥jªnæNzCµ±QC½q #ñ`Ûë=àÓ9Ç8)×N,&£sui/»&ù)(P?Ýs+Äøõ'tSá)¦8n?LÖÖ"Ãwo¸y@ÑK"dì§ä+áy&®[.÷;MÕXrL¹mç«ÂujFÉ$jþFÕh6þ£B\üAkÂpç]»ÃS_
â£ìzï<ô^;¯Ê
\äºY/«Mpdí«%ÁY"ûÎ+OØ¨1ÈÍÃö;jÎ6Õ
){µ=Jù0¥Óh*¨ÇXç6ô>vI=V×%IÑé¹Sè9ñ-?¨ÈW_]=ÓëÕfî'7]4o%ß@ÐÂ ÅÐMÞMNð´ùs+I m¤r1#ÅØÌéAº¥oÃXuÓ`C3lM:Îq³HëÝ®/(Å£|ç}8Ç0­jÞ³|¤ä3Côº
|¿¥¿v¥¡{$M¥a£cá>Ü#÷LÜ¹\'só
Ö¯~^uÿ[8fAîµKQäZÌë&¹ÌðºnÑf6¥-y ÿ´T&K[¶BRKfëêù-£FpüIe8nI¾Â7joÌº¸£¾v]þ
{;uºÉX/Çs.?×¶+óÆêó¸Mà'óÇÕºG:¸VhnWv¨óö³i&'`à)àÃc°JÎ8+ÚdÍkÙØXîkHÍ³ÕãÏc:ÁB
W\Ð/¨ÝoXáïàÔ´ÌùVm°k´r±*ÒîÿÏ!å)ùv¯bå`ÓGNc;è{#ê¾èàÓÀOôr»

'¯¨ª"*Õ!G8éëgoÓÿJG¥dÔ°gW ÙWiÑ4^&qøqE£¨\½°Ç`ÃCÚ6ùLÈÚ(4W)£,Ý`%-Â¼[ñ ³Øg vàaø¬7Aài¿ºéÛ9Â~ï½ $þFöKfönÙ
Z»d£Dü$"ÌIÖ£¢%L©ö,zô¼Óa¾ lq,´¹3£:Ò£Pª!1ÿSÃ5pPG
w}HÙ¨g~Qf:Xo õE0»åçÓ@gOÌa_CrÞôÊ.àÀÖG{Ð®ÖCÌk:;úRÕv	]¨Y%U¹2­}°vp£Î2Ø¦ÃâàOþc½Êb«±P¬ïD
{ÁNó§¯Ü~¢,oð¼ýüjHÔû,³ÃÕHäÒ\ÜÎ¿Ñi:ìUß,/íÉ^³¯Ò$ëÀ,±x/Cÿff`|s&Á[ø¡Ê¡záiByqòU)T1åÙÍ*kwóh'Qgh71à ¯õ¡êíý´¿HäD¿_
þI6£Hü'çõ/Ãíb½,ûOru­î)zÐÀ]|²éIàÝÃ"úN¼íð	¾æÁ<Év¹¿:¼a, ùýÕ` '£0	OÍ;B4k©ôUo`yqNÌ±ªv;î98¾­ØuH\+)`¿ïLm¹¶»äU'8ÄAD+¯ýáwÿp§
Õ$2Þ
ký=ÓÕÿôéhÚÅíee¢h¾U1Ûm ú,¡ÂÀÛ´Q·e
Ðd¾xZ°µBç¹Ò¡X²&¤y	ÙyäÜ·â£vôdÃ~ïq¨ì5_Ó2J0¼v9s»öæ=9ãJ9C-¢Â¢aõ4ü4yüvKWoU7ÙÛéBfu~HUÉ®­:ñ%y zHÉeµø·ô¶lð*¨Ò@£;¬üM1í{BøûØ94?=Kj®]00\5yÅ>À}|.ë])ãËS×ËYæ­´k¬y49n®Â¡º£<uX/¿1$Üd·¡ñióZëÝ®j)­¥uw¤t ]Ui³ãá1ÏÁÁ-{¼pØ²§üô'Åaù¬0ò.ÎEý¢Iú­À²8?ùÀæÂb±¯ÏÈ´à?yÔâpu%Yk*íí·?®pØsOÿmfÞzû/óc-v{Y/?â,`#ÀU2´Ë¬í_ýµ'-ÑCs»èvB\ÑLU]
5:ÝÞôØ­3ëÕÉjí©ßà¯ÏÓ@ªn­/êéDõñº~Ê)Ü¾ýAp"þ¯Dø*ç^Lôí?KvÿbIÚÒhÿ_É£BÀüç>Ú°?1îdËmög¼TÅ3©Ð		Q'msÓ,ÄXZõp´gcl½½j¡QåÙO³XÑÊæÎ§·Eß
àe[»ÚúvðÂ=`z¢z÷÷yÛnQÑRsA{¾»_ÜÄÉ{Ê¶·Ã.Y0ñ Jú=Sßu{ÅÉáÂsáB;8!<`ÿÿXÌJíj;¸êS>VDjùÁþ«§V¡*ë}~(jÉWdÅ½ G+	aÃhtý1>N÷on±mInx¤×kU5¹¢v)fr<ñ¢-vôX·ÙAþ±óvj %w
Ïkî<MÆT?¤SÚwlAê)ÑÇtìl´¾&«Oµ+ÊKÜ¸2ÞlÙ»rmûvÈmÈMUO¶L£FÔüåVî0¨ï1wlU'â HX	çZL4¬KhñæE©¯F¸	þ
íÉPÈï}E`p³Úkþ{f¬å¬AÇ+½@}~õ6)ÌÕ7{ù¶®õÍå¨Ã6L>ÎÓÿTì<¨ÕFé¹NRµJÍjéµfoì.Q)t^^ú6Ç"H\¤A[Ì~[³¡¢ü/VõÆÚÃ=)+ ªGÿyÍ9"(ö¿8}¿0sØg£òPÖÕãò'6ÎÆG##0²DgÌÄÉÂhßü­¢dð^åüúÕýA¬
±O1ìÙK5¬-åi:;Ü¢û&(glúYË/a¨©YBùó'ÍïC+ô²É·ûl©lÚnÕ$C¶uÿÿÿÿÿÿÿçy£Füån_Ðã1p«aÊ²ìòFWn-¶-d`ñLSZïO£ÏCm¥	£¶úi2 jÃ¯¯|,#Af®é6 ¬¨ÜÙ©jtÜÐ[0evq`³yF
9f~Å"	IÁ¸£ØË6&ÐÍËRR3¸p·R?Ø«í¢þîÛ¦ÜPohGÂ@¥Yß,À«òàC¡®6@§ÂÿÜ ³­úsÖvFüÓåSG[Q'Ó@ê=Bü×CI,xrVÓûSz%7¢ÒÉ
s5ÉZA-N£~0°¹3èNW¥Dà±Su,ç5V]6&!\Ö$~Q-SÔyî/Ì6¿?ÇUæèä1þ>mjÒð÷¯§nüÔÆªöã·jR6þ¡U±!"£Jü.LÄø! zTwÃ2°A.7­½Ôþ4U79õë2þ^ùÔè©0´!RZñÿ{¾«ð¾p{2û½øî,çÿ©ÞI¼Ñ0_¤¶SªzÏZB;_oÀ¾;Xùè1áK'|é­êäs _ÄÈÇãÈE¿Àrúpsý5)èzë¡Äç¯©xyV'Äª/lOX=Ú<Ú2é
dLÓªåGR;$Å*QUå2Af}}fÇXöV­3n¼Å'pïp6Â÷ëàÚn âYìÓgR¿èS³{à¤°ÿa`Ìw+H]±F¤|d4KØçq¢ÒÌ	ÇuWw|n
¡ÃYv!õ)ç°0òóÆÞ
RÉË»3Ò»ÿÿöý*oè¤Ûä£D(ü;ÞRpô3Ihµ÷ÀDn8Aã(hR»GÈ5õÔ¡6sOw/2ÆÆQÿlá&¬-Óã^Ã·/Èú*[üz NÆ¼yBd=JRùùyj<*»(g²U£*_»Õ=§Ò Æ¯U_X$ ÉökR9{þÂE&Á¿Si°KX÷­ð~ÃúØÙÒ0Ë:4Xz>EpKhJ²Ô7b\~9#F<GÓ'B#R"DóàÛÕ°oß;£¶È¸×	é'udÄËTúÅÚ§Åy8÷åóÖ{©AÕ)\únaãÿlÙü{zitHX±üÀý½Áû^=Ü´´· (íNúòSò7ÍpcãDñ«=bmÛmÚ@Ø¨+ä%R£><üA}JSôü¯aÔÑÆ³»@:Òi¤©;fë\R.»Á­"¢wà±à)¼&Yûû¥wµÎØøÑÜ åÆ@²Ì½l­63ÁÒLÊÙÍff]_ìÏtçWßK§§ÂÑI¨tü0ÅÑÅ60_ôF'xÍX%¶sµ7¸µELJ&-·/óé¾ÃÜUªo·¿Ó½úÎèÑp¬Ú¨U¡ÉÚEÞ)µIÌ(
æEÇEPCÇZÎ0baûsªÔÑà÷º·ÕÃB² nWtæ/½¶é«<²=H1ýlD¡¥»NÌÔÊú"¬(ÐI0þ%P¨\äM	G©ètI6¼ ìéÏ¶Ód¿JD·dª%d£2PüS¹(µ±hÄáøÂ~¥.?HÚÀ¶Ál>Lô>mÿ3õæøiê²ÙUÅ¨½Þøt.UF*sQÆ§%áMJ#4ëßV8»Äò!Û´é'm+tÕ{¿f=Ã=Û1P}$d«çH3¯öª'Ö[[ \Ä<ßàrÖ¾C[/°ãàk³þ
Øö¿ûí^(¯ÕíÁN.&ÓNiefÏ.ÛÒÙã±ÛMþÐ]i/G2ªiT&/íÚ]ZSX¬¤=låvËVbþèÑuÒq Y(¹¨.ë}EmE'$
l$/ì³F°QÌ?q,s­àjúÜ×¸ð~"C4\aîè6OÁÀgý²dµ²I²d½R£fdüB9=Êá)§Ì´El"ð±E­g'r¢ÑfÏ sÝ¼UzLó4uÄ®Ä`hýörQ³X¼s¢\;
â+³7í"úä ¼ýK³íy^íñûQÿÝ'GIûIßsÈB¡«jõA6'øûÕ@Ói©­Ê[â³&ïãì:YIa'ÍÜAQUÈtkåþ¨>Iüíl¼Wv¼i¦,0÷±.´Àü©RË¯Øôp¢A@Ñ\ÈÔ,ó	¶ý[ú@}L¢º
:_mZþÛdô.Îç·}ö}V,x¢N¼ÿ8M¶å]!WÕGgÐ¸:¦ø?Î@^¾*¨9ãJ4¬R±lÊ;ûW.ñû´ª»½IÖ¦m6¦ìFIwÁzÿóÝg+7¤Æh§;ÄºW!äoùþÙ6Ó5Ú@£ExüzõÕûÍá©X{_¨]±VÂùÓK¤í
Å¶¬3äÉoÛðæ2['nÃ½BgÐwCgLñLÆY½æz×)â!iÍçÂZVì!\Ó6ÃeF6j~¹ÎAï	mrûzen1ÆÛÍñ^dh:8èÍJ,
\¡HÖ­ôî6t5ÉÆ	uD÷<Fj¾*\QïÁVïí"º"ôY¼îâÛ¸§TN¸ãxR¶±Uïgré2i&à{±L.BIVKr{!Á¸nÍQP·°¾°cZ&m/mD¹è
ÅºeTÊ?"¤¸ã@·ídTÊÞÏìpû¹E¾ð
uBE©)ÅYWaH$á§aÔRg2NÛRÿoÛ'ð 	¦ÿ½µ£1ü¦¬ Úöé®<r={-\ãù-HvÖ»&épû~©ã×Ä²Üû -±Ghæ/j2;7XàsÉÐ|ûyåRA·þöD¡'Õ4Úã´ômgÖ9§0:»î3òx [Ú~JàóDµ¿öòÏI&úÝH]õÿÁ¸ò¸óÉX¬;¸$;¿¿Æs6æNþõ0¤o?÷&mø|P3«®ÔÈ©	¥ùgÉÙÍ¶S1ü¹Án£+W§¯lãùZÛzAâ+½µò0>û}\'åx2bän,Ë+(~âx3)TK¸/¤ß{~©1øïý{!L\ïÒ=$åÔm¤·bm*·è£7 üi÷WëâÉWÒñ±§ÜW!6»¤¢Vz|vÀÖ'qmM°£7+ÁdÕ#._Hì¡Q¤Y-Z"<á¤k@B?yùªX¾÷¢jçmØ¨>Í×÷Î_qàýü	$6ðúõ
U±`R>9,º4^
þÉØ9VÍ&2 u¹KfZÔïô
ÉyjÞ,xñ¢jm¯FDCèã«ÆvÿTÙAâÕú6ys®æÉ4BùÞá7A+uF²y¦l.ÂÃ¹qÂ$Ê×NïÐÑS_¹n	}YÊ¯xó!ç³þ6ytMûex(E?8À\¹Ø÷Î\%- Np{¬-Md±~7_ùnoý¿m°-KÿÚ@ÿ õ£M´ü2zxM2ùo¢x¡ö¶ó n
!G<°w\:ý7¥¢ÿ7 Yçjq\¿y+>Ñ3H¸Ã	ò·°ê¶k÷ÔnãOÙ½¯áYÔÅ¤¥ÕR9ÛIpS³THÚyLÌ¤B'%s]/M7P:n­°fä»z¸Ù]ä»=Ärè×-ýÑ7.ù¼»kùÏ`XCáC$BÁ¯ùr¾3ú-"o`u}ÖsãLêï\Uô(WÌèf@$OË¥§£µ%fë_¡^38²iþæ7p1×6óCúå^wàLéÔÄ¿Øx²	­ýÃr®yqã£GÁ<E¢¸¯znµº-ÎzX¾iÉ;êÅ÷.nC¥E
e0)©KÕpMfà¿Ø?H­l)`£IÈüM4*/Áv¯G\á]vÈ_Uh£È²_IÞ§«6`Ö½|ô®©ª`Ô*Äp¿¥àÃ¦åUfá±i×8&¶0ÇJ£^*ú=Ýmä§IcÓî_X±«;!.£Üõ[ßw!~që î!ùåQàeHçøÉÍ¦û¦àõ¼ÜXê3
pÈæ+¦è¦tÚàë,6 8ESY±4GP.-7á%Ù+q~Þ¬ËÄ.aÂwÃèX["Sá]ÊGª<làûÚ	AË<äE.¥Îâ´,fô°Å" \t^¥÷ÎJ¤÷jAà¥0;:K³Ù¦Ã eÛykm¸+Ïá-9RÆEeòF
ë>Boêv[$É%´kmõU&f£KÜüåVÒ^ÇíN	ZuCÐÅ$wÂyïÞ}à¯KçÐú¥FÃ0cÿQYZ×úþ69Éíòr<åÛËèÿøù\Áò-ðõß2
Ã>}x"¨Í@D/¿üü'vº§â*D¯Y£¼­oÛIæs¤½Vëãsv¬*Ü¤-	Gè².IvÊC®Èæ "ÅMHðt¥°´0VJÛòQONbî¬±ì®º*©°¾ÅR;FÆ· xa5%,O_è÷<þÐ,[?àmRf;¤÷âãH%»iÍ`?$ÿº¦âfîáLØM<;úÌ|qÔ#ÕzÔÿsn$))ãLÂiùãñH·µÅÔÊºÜ¤Æí?ÍéaYÊ¡Ð$ÚRlÜÛk`M-²lÝ¶£Bðü1*î§VPðIÐUDCT=Xð	 g£vËoî
ù¼ÔVÜÿBÃ:h·{?å06¬³öz6øXF}ÃÂR¯ËA(LôuOÖ`?·P¨|TêÈw}fl±Ï«rån©èÏÍÖl¾:¾ÀA¢ª
Ë¬dèò<¸ïä2­àC`«\ÔURTJ\æãMx%¶cnQM$\®qÉ
Êð·¹9Viþç*Ëa¡eºvù±Þ·úö(»MÎÒÐ
|FCâuÐï};aF(4ÉãË¥u
WïäûÆìdk|n>à×Æ¾2Tó£ùêÜ r±¾2<Jß^4U¡äd( Îéð:@kH[mKiI/Ò°)}[Ùm£9üüN2äÁhý¢Ê
7¨#<ßhUó
x¹ùÓfÉö=5 è¿fo{ÊlêØÜÖê¡òR¤ÛãøÖ]QÝ×ÊQÍ\ûaÒ+ÇÓXWXàö6Y-ªYæ½VB±¬°U¡1¯hs¢Ú½¥7ö[6BíæÙôíKuâ`í1#éRcd8 Â­¾Z2±©TÌz3iÏäß'3~ã7e¡ö/lö«î0õ%Î­çU\íIVõ<5¼k¾µÁýªþñòú¤8>Ñ ¸$×Ãóäyû:h·jãcåG¬ùºCPÖ>Ø:Øâ^nC¸}O¤#P ®$<-(d:-5óñ°ý-¤Iµ´¨d£BüéÒ1x¥Øðê;(ß4{ô«UÔAÆAhGù\ó¢ð'éÇ@çßSÁ@áô£½ ²Ö$Î¥mþ[?,1£q$;úN.5Ýõ¨<KG¥à?À§u[>BK¤ÙS·vyßGl³N"KÿÃÃ¬K*z¿þÜ3ôLÚ>3AK³ÎþÌ*¤vÆHo,SÁ¸ÞÉwFJ¬<²_*º[»ì.ê=ôPhï2hÆ]¹ÄD_ñöÇ³SXØ
µ3¨j?¼ìY;µß.¥ïàK Lf[U$Â"èùcã0¤AYZë	ÅïC=ü%VÇ­Eëú¾Ü
Ò%ÿ}Pù³¢óO#i°qä¹$íÿûZOàØ^íÿ½£X,üQ)ëûUWÜ«ó;RâBøiKðix_ÆÂ?V%\ ^£ls)¡aâÌè°ÃA÷Ü¥l¸k\#uë4L­(J#R¢Ò«c\w^õôÆUAóF©78s$þíÃæ(.yît©Ä'Bà¦>²2xëÕç3²³÷³wr¢<ÀrM'^ mZM2é&í¬N(Q´§æä>«ÃjkÎSEÛ9P·
×¡Pívl+|9ùíTYÐ£ÀàóvÉ¤¤_ëIHÁìwc¯Ì­ìµÊ2¶'E$øõûuU-Ô½Y¸¿#4ÖJÅwàýÖL8úÏ£]Ðùÿß½&Fì<g°Îóe°Ü6·^=³,kJ¾õdºÞN3üoiå³ü­ûþÄ-ãZ;%/ÛþÒmØ|-'ÿ£T@ü-ÇÛíe®¸ûB&vt?¬|¶ªÈS°Ò¢¿­Kµ¦OÿinJ®'zÀã$náMlDñâ{½Ñþ>#íÖºÉTÚO&¬"eÕôØçx/6È>êf¤¢ÃÕÊ,0ZwçPÒ4mºÃÝëuV¸ÙÝæ)r7ód¢xÈ®ìjÖôG5/ÜuÀõ ÝáçNø>ãySðÞ²ï	2éÈ@°	^p¯È¼hÁÌÕ$}µbòùËòÉól7¿}À)éivá*Kï±
|qÿî?9°à¨ÕG1DvwÉµ;&ÕÆº°òæ¸1ÍÖVk÷´U,@ªâí¦È¹ÌYÐ¨ØgA
qbEäôo9XQ·c¬Ú%pyäÉ.F!rú¨b$þÐ'ÿö¯[vÿ£ETü
%/É_7¾)òE±êãÆµ£x©(,g³=Æ¤½ïhdj6f(óÿÐV_³êÃhz
@(÷FßáMð½â6Hn
kx°í\¹°{µ³aéBÔ²»Ú¦§oï»n@*ED8,¹
iB\Xng®¾ù1<¬Ð0ÏE¢½PJl*ö²grÇúÍÓO^Õþ!,?ÚJôvG¿P½¨Í=ÅëÞSÇ1a¹Ssªpz³É·ÞLáÙòÿñT$kk#o-TsÁcmó¥l#
èº×ê­Y:6E:ªØíóÙïíclt~*FTøyk /èþ°·o¾Ñ;vüQ³´­Â­Lï­ü2ývsí~Kvl6Øm¶À¥_ü£Ehü»¢ã,ÓcuËkÒÏ¦S»-:¢ÑF.`¶exÄ%s Û kâgÉ2»ÕT{S½-!#Aò8\Ä±l®J~ý¼0ôuåäj:9¯ýKêÏ¿ã¸EóDìmÔ$(X  ¯ä[:å¿l°k->T¡:Ø(TB qþ¸ÁØw×'¥ì­o^¦Î¿¾®µþ\á?ªgkÑíÌ¹àÌÍlÀüI»vYm×èú·Ëçã>åJBiêºxà-iLsðßÄ'Ê¦PÍë¿+TÐï| Rkô`Ch	ù~¬í6­n^Pðçkv³øÑÁ3¼:f£Qv+­*cTcén·
79Ml;v²HÝ¿ÿoûu@µh,£E|ü¯\{qðcËU1Fd¡Ñg)L\ÄPû ·Ótbõ"=lRT$Í+JÂþ³Ûæqd1j^ÀÄ;&fµ35D
¬W[º¹¯N¡iY0C9[Ï[Î·#:äGõÓ)n°p]ÒÚÏÏã.<î³ÏövÍnÌïÕ98Áyv·)Es¦?ös+´ºô5)·rß1Sóy¯aÐßñ¥æ<ð)·éH7}Ð:4èéä^~K]ÑíÃ¶w¢\ÇRæ°rpH²ÜùT¶ÞíÊGzÍ ð/æDð¢Íi uGáÔn¤»À»óPeEZ8¬m74BL:Á_ü.\(Bò9â¿ERØnÍY9ÎStÎºÉdö¦ðgmÙ¿ä%/íþM>ÿ£Eüûro5M(J¾rõPOWJJ'5­&Ö³ÿ2C¯¶shLP-´7¤¹I@çïþ+y>NÔûþRÇ>$Á¯R@¹nS»Ýæ$çÒ=ªMÅkD#.´
KÔÃ¨D.Û~UYÕÈb¥qÖí$ÔúBp0}o:jÖÐÌûD§'<1è±9ÕÔ×£më¤ÅìV°U¯h¨ü?xX­~oï+RnÊX1¿bá´mÏpjq/õiBÎìç¬Õ_>~ íMxdElß)$vóû¤¸:ð:¦]­SÀ
=$¹!Ý§õÐI¢¦kÌE[Æ0èñÙwHO®>m%Y@:gí¨hi+õ¶ÉKô$]hf£E¤üûzïdKæ!VüÒ}ó3÷)-ßËëåÀØ×ðtUPe%ýZÚ¯È÷Ëé Ç'Dpeó36øTràööoøï,LEá4Äß«z&a×=E¤!ø8fÐiîr¬Ö¡%)|W§0¦|ÃÃOåâùÉ_Wég|ÞY*Úz¿=h6²È9KG"øçUÜV½"®øÃ©+n3ìâï^·8ÿ5ZÂÂ	s,ZØ³aÑðï&#F·
Â¨ÖJùh¸p.
¿árññ³|ÿ«ø9âBEê¶9Xt!3]ÚºÑÌ¾£U~v ¨ps«ôdà°ÜRr'«4sðz[9Ã$ÄÌPEN´¤æÆÿw<;%/É·ûdIm²Bä	£;¸üÛJÚÐëfÆ-=ä	¶¹´ý	WÊüÓ¢÷5çÚ*oÃ`ªn4qF®RSäÊ¢VøÃ¾[K³Ì?ÇX<©)¨wHÇ¤Þuúéß=ð<ÃõvÛék¨w.ct Ï>QMT©ÑüA«"°ZVí¦Ôoi¡J2ÕÝ¿`ð7^ìÍ4 àkb:}qËOqÛWiS	LàÃdÁjÅØ¸gô#b±uí&6
,«ÿ\vE¥£ý­#·]+:OF¢`òtè\ì®³bqý*Â=ä± è°>%[¾ê²Ñþ)?È©±`²Èâªâ¼¢ýüD¢ö,â'X©¾ÖåÚÀQC,¬³Ý¿ÛnÛR ¿É$?í&Õ£NÌüù_ÁYºn =ÑëÞàí±×&ïK>ãÅõG¢w
{®ÉPOM3|JÌÖï±@®ÓsëJþHÏÁwIfÈ><Ã&»©æEë«>;X¨Íú ªë»ï?Ê¡eâ¨6¿=yã&K}k¯ñAG©wUa6àBBÐê/oïñg+P³,NÝ¶¡ôçªZñy`èKQ`FÆRY{¢ñÎÏëne®«ûIcª¯¦Z
ýPòuÖî·×ß
ÔõÈÙØ$U=¢ß}G×_¨ì½@	¾ÎWÝX±dÜ=¢ª´ÓÍ·Í­ÖÏîñ(?#`~eO@þÝ°4¼ùCAöIÑ"·°4Í Z O+Õ[dý+mµ¿ön¿¶@P¢m£FàüÂ9àÒí0câ.M&¥ñä;x<Ôxûgù\ïKþÂvsáÛô­.ØÅõ7àHÎV%J¯@+þ¤lj*5à×ÞiÏJYîLìæ¢ôW(ncî3¥±u©­ÐïßÒ[¬é®»é~J4eÎ0>ù]0-MÇ6(«Ãq¼òè«¬ÓòF\ó0È °Ò¸Ñ­X<^-<(3,ì_wÓ<oa#@¼ó0ÎÒ§Mä©;¤¡ÇzñGxæê¥¹	$O<KAÉjÏp`¦UPrûþ}PP7Ëµ³ÁH$¢L³¡îÕ:
wJy¼'Vö2xJÜÉ!³K<ü§¼Äãñ¬lÛ~=ÜK¼ü¸?3-¦îB¶ßÿÿÿù6l?£Eôüº¾h^²»ýìâ÷ÊÁwQï:üÿ[Öë*¨8,ÂiM¶$Ð3åÒ_-c`ÏèhöigvÍpW¢s)]û8ÉÏ-xYgH÷ûeLp½yúÐ ÛkÆÊ>XýÿôYZÍÍQBáÀ¤Ì~
g¼_µçìë+Sº¡Øp£kq!3¶ãËäGg~f¿yH­<ÂÃe}I7¬Aº5_ÒÎP¾Ó%+SåÑá÷ÐD	Í£ 4zÏãÕ1øüËºo9ñ
Ò¹ôÉ1ùíÌtíã`mj×BËGòÙúËÞ|TöccÞ¥¨pGà¦1°/(2sM:Ìâ§QÌ3[¿¡1ò¤á¯Ð¤¾7ø~Ü}¬-;=f+q¾vHÄ$I;°|%àµûjö£Eü.
Ç"òPn¤©ÆôGçÉM¿HkÉàgö`(Ks}n^Jçz?¾9aÉâZ¤Ô´´¢[KÁË©ãÕb
ä84¤ÛÙÃýS4BÇS§Æ3ù8
½õ¥bÌå9ô3SìBÝVÙÉë¯ÞªïíF4±¶nº·Èÿ«xDúÆ°Êä'Ù®.dq¹Ä	.XppÀ¦;Ñt¨×:«ýëT¿IÌâÒÃÖjÁÞÔ/
Cìúþ¤+Îð
æyåâkh°]ïØ]	òh÷h+)TÏÔkNhÍ«76þ#Ý©B¯þ·Ôª4:¼³\ÎÏNÞ1Í¯öyC¢¨ZÅ¶¶©ÞÅ|¸Ed:	3pNXÈ\ìVøw¤3HûIm	·ä£Eü0Z±#!~£Àß¸et¹Qrý	rT×gþ²¸`"[÷fQtä5JþZhú¢ÐoU;~½/»Âw
ÜH­F´eF\Ù¤O9Æxªî«	Ç!BYÿ)²a Ä\£ÐjÓ¸ºë~¹BL£ªÎ{F0¨8_qmu ú'õÜgÎäíkï'¾§¾yµCy¸(ì kvæ©Ìnµ0KO4wÖM!ze3Þú¤ÈEöóÜ·NI¥=æIÖìSb"eò<ýsì^3½mwm*-7.ãCõÅQFrÓúK¢"@v¹Nn«<YÂºu±½Ù>çÕÄ4ÜºÅºÒÇ|Øüº¹þÍÒQ:BaoÿÉK['úÚÒV©[ÛÉ£E0üFÖuÚ£U.Ö¹é6D´¸"iYvûå2ô¯½VzÿéÊl³Â.K½tÁþô­jYçÕÝx¢ù#/¯ÐÅg,É÷ÑOSùê%S¼,v!\3²[Þ¬,eY.Ó_6ºäã2ºyVbÝg¾ÔÚ²&
à¸ÕV!å
ïv½ÍÒÍ±u½ìtSc¸RMp<3Z¡føvæ¸câBÚªÚQ®Îi4èOýa{Gá1Jf¦9&<ZèQ±æÚãHÇýúÏûBqhOÕc<àdÌ+_-éäxÂu0'$Êÿk%BóçéSd2\èÔ¥®°	î¬·ö¶rpÆXÙÄñ·½í_Ôi uÚUdéz#í>-»Ð®$UvÌÿ`	ØofÃþoí£EDüº¬wõn®«N)^£QMùñ	ùI¥¸"¥sÊ¾ì3¬ïÒQð[²ÆyÃqøD»hB¸c»U>¤4µßµ¥ZkÐYçêÁ¡ÜØ¾¯|yXßè¿È
	8j5_'g¶â-4nûÝEqUç¶â8.µc+TèänãMXÜÀ>WØ¶ÓS¯ÀãVnýÕÆqWVÁâÒM4ÀKÏó¢ß@p«19èí¤4ÒÅeûÛäÐ ÍÜäûµsÔÜßðçA}Â%Ì$ïÅÛgÑR<¼ð@;ÕÞòDÐ,ðÚ¯Ú·f«(:~$AØ³w(dsÉuI·8¦mëzÿëmm77á Z[¤hâè©þÕ7Ý¶ÛmjTIOÈz£EXü¦¦Þâv»'à^ÛrZìÃæ{¸«SEªçÜÆWk"L{³Æ\zó×Á½$I~<g¶\äkÌCAio&Ìß) ¦ÏÓ©WØI¢dÓ,ÿÑßYGFú5¤F¹öÅ¨¸{&?Ö`jº..Bká±¥îHsô3=*µÈ±t+*±·ñ2/ïÜÛ¼BØ3µ¬ÇYÂË¬YáC_k¯9!QÊvÿ|ÙîÆü&xÛîxÉn"²æñÛrtThn[22ïèè¨C?5dÒ¶õ5ZôyzöàlðÌÆ`cº©}&÷A@`½°{G$¢2×¬Õé¦Í¾¥>GÒþ­Ò»¿Û´·ÿÂÙ£BlüQ&ÞD'ïY¼ÕON`ñ°²Lµß,lO³=$fæ ]ÓÌYýûSO¶°Â¾¿0òÁ1±mö6Á8C*,ÉÇ*F:pèæ`iDKÁ8´×nÐ¡Ôt½¹üuUøh©GO+Å
J-K4vÅÓbûA°æ-£`¼|?º;P+Ç®²58en2Ýyn«¸S?öº1r~h%=£È¥#Â@¦Úâ°$5bñO°ÇÏ*ã1rn[ÃµÔ#ãÐ
àÎé¯¨Zé<w÷Åv0]·bHÑÕEüõÃ»ÙðçñÑêB¯ò÷ÂÕ¬YO¿?ÞgL×!x"G¤æT¨³¡¹(©Å&uÄÁÝDûOÛþÜGÞÀ3ð¶¶d`ä4$
ÛÿßÀ<¶¶£EüPæïÏ2_¡~²%°=>ò:Y"7µ6Nº>ENõê&·pc;rÚà³
«Hv¸þøOè!p¼å§V#&	iYÀx´g)£eæ¥>|Vç{Õ~tqì,hc´±dÄñ}÷8¥\'¬¯BãÒ9ÊD¯íà-PÅ£õªÚa¶DK¾Ïþ»áH î|-JtbÄw3
_4Á¬°ÌGÍï-3P}
ÂYÜX¯iÌO$£íê'Ec(Ø¸<b5ê&?²Kþ\¶ý<qãmû¶m<XKÔc»c!`4"¹	üzÝÐ+Ó$ý×%)ãêÓ­fU¥ndPy¥_@¬Îà?7ÚFÀ´èÒ¥
oûI£>ü£»Â·hËg]çms
.¬³ßøç$EÁX×Â;jQ.SÙKÔóZKzÛu&0î¢SªÐA'¯ªÙüm2SkLppì$Íd¹Ð¢àgn54*¶Ã¡OÌN&72o?Lþw¥Lñ¨@èÃnäTîÎÞÐ¤G`4(D£|fÈi©pPú¯«uy:9>ïêwQåÚÎå{ËNF²[_k×ôÎÜøyÖúK¨óVØhål²'fàÛ{ø¢Ì5
{ûLö&KvM#c1¯¿¾ð{ü#äû},{éÝ·ý
9mIýMj%kÙünlNíÛ³½"ÊU¯%ÏÍëu¿Y23HÒ·®8Ö¼Ìs6öý´¶þÕ»UB%£?¨ü
%{MíÅSóí02¼	â¶Í¼Tß¨ªpHè[wîz3ÿHÒßËÿæ³D¹f³³îrK!ù^ÌsízSa¬59¬·¯?ÎÇ]q4'\»qãÇ>Æêêók7E-ÐI^çuéøÑUprþÞÅÛk­æZ¡qa¿*îÜÔ_Û9ãpò9ÚºoÿvÜ§bQl&×#_²QDÃk­×.â1FYµo/%0RÔ½w×%jÌZ¨èÒ¦¬Âµ¶ww8Â¾Áú Ñ#qaÌiñxA°vr¶Cïw
®lîþ@Ë&Ü5e£®SMCyÝªwøÇ°
p%9³,È>pî«bùêÓì\0"<§ô¿ÿkI&ßlª&£9¼ü%TFë8åÿçOïò6Ós«eNýþ[xµZà-ErøkÏ®¯îêõå¬ ã¾>°Àp%í	«
ÁüèÉñ¼.}/hwkÇáÑa¤¬äöG´ÒPòÈ1Ê\HÒ
E«¤bPìyk/°b<ë×Ö©ÐªÁLÓSiö¤WðDÜFQOâ¶áà¤F
s´evåù6
6oxg'¢·c'JÌî@7¶idôHæÆ7´¸àæQe­>ø3ÅÞJÀXêx¢`HÝfê¸id÷ÙFðHd»ã¼ Îê-Ó²³­âmwâú@¨¯< àuÞ²õL6h´âf¸&>,m½¿ß&ÒjäKÀ£JÐü»W1©tÕòo5ÜaëR¥¥þ%dUÿß#¬>WYB»¡}ìSÚB[Jÿ
x6#9Aßñ1¦«P×¿%±ÔðºÓ¯Øvô§·ËÊcÅ®ïCÀ­®¾ßá¨öÌknÖjðPÔâ²k xÒ]Ò³(o$ò}
hv¬¨·ßº§:©¥Ëò4ìfï­.åâ¸bô¨a5Íôeaûþ¤Å:Ò»*|§_ô,tP}üN~fþý±¡ =Y¥¼X2'ÊöRÝ,þGçáv3ÆòÞÔÁ©Z h¥­¬¢º²>T|K SDÞ]DlÈ$õn¹o>½Æ?9Tbº§µÍ
¡-)XÓ¥P¹züÁs#±+$¸"/!Öýh~É6Ú_Ðíýµ£LäüöT-ÿ8væwIÙ5Äôð2^/ÝdU']¢ï7Àß¼3|¾hçÇÁÇïìbfºÁõ ¿´.ÑU¯1j@º/#ÛG0a§òôËi«I%éD§|aVÕ­Ò[À,ße<2VO»ob}¢$àW/ü\n8d·äRsC»Ìæ[xÊ«Çò0@è¬#jÇ+9ue¿·èæ#¦/¢-¨ÎóÕø¯ÚÆ~2:;+çÖ<¾bÞJ¦K3¤ß±NÊòêÔ[ íXosáO·(6zý:4áÄéÎô¾\ã4]ÇÛ)ÎN0Ï÷bÊ4Ã¹ÕÙñùÕ4+æ°xg6iÐJÎÊqT±Ç+Çç|îºkhàëd&BIfíHUäT£6øüS®lÏ
Üó7úÿ+ù¿aP`.âWø/²Lsúe@kåä¬kªé×­òíÉ8Î@º1Íq¹óÉÃ²¾ÎÇÙÐ·lõ®þI,Ë¿%[Ô¶¶ -"Ø"px­>tÆEæ÷ÆWkJNºÚÐo)+-æ´K®Yã ¤æõ×òõGú¢½×«Üµ¾	@Ü
[ÝÀHhzªßùá0s
@ìQðupUpU×õêÄ"4
Ï1ýç¾X*F|Þv²¡gX%ý¢ñ¢l®ÛÊ¼[}ÍóÁÖ¸w§¤Î§éð>}óøÃ(#ñ¾tAHKûÕÜRxfØ>A1ä øÅMifÛÇ$n@$Émº¯¥O£9ü19hÔº
bïï6$#ÑúK´Þ
©0e+.Æò¬ýuQÚÕfWªQÛGØâÕ	¯·VB8ÎRc¼pìæÐ¶wN~ò÷Æ;¿¬ØVÇ^=ªw:"5öESÄ\Y±ªºYP²Ú}+Ñ´¹ä
íóz}ÑaÁ´Åuåuèü½fkò¿õÏ
C¿åÜîü%BXmç~Gª)u«tô¡¬ÐºËQ£õÀèjKmÌY3ÙÕ xxó §òüÎOQQBÐqOO\ÐGÄ{8Ç5Wûî¦èµ®8v-§J$HË®2ë§EYp¥	ßtU=|b«ÿè+ª;<*ÚW]z©©¢ù4={Ø°"?H'olëÀJ£Y üº¾jL q9¡Ûb$ \½è«ñDNC=W´µ±²¬ã&5¹Á
ª¨àÉòúðý/äq¾cOLòJÎ²bÒúË¸d¸iî(Ü|\ÙH!æ®*ÄQÉ4Fú©ÁQ²Ê»Ãu»uB|ÕÊÉê¸ÔäÔL6'k%ÐÆ([}6ÒhÄ9éå|}¼íLô"«vÉÈ©@`)úv»¼¼?¯^oVüÉ©x!þ5g®8po­{ÿ¯~¨ÛºßL"(fç{a»QSÁãÔXÓpX;á\¸<P Ý:³	)ù[v»6cR@)D¶wÅ´~;lrÈ)Ó ÿôÍbwÞÝ}}ùF1à´´_¹/TËÊSkÞ-|µC\÷ð:íaIx²¤É í&Äíé%°Skü1£\4üº­ðê¾Ò3Ú¦5^·Í¶Qtyv:ÝæèÜið/Q
 
ËÏEúÊ´}a^ñpmÅT>@^²ÔË?{ª2C^O"b8.U^ÊÒâk¡ÊÝ
ÌOz`JÑ}º@ÑH¼âÿ¬Z·e©ôZA²B&r/§ C@Ý)y··ãn¹S)Uö<µPýU/FeÌ9Ó"Kþö|h\Æ$~8=ì´ÍÿYðÜªæâÓÕÈÙÂSÁ3ò÷F!"'ºv&Sª±o-ØBÿB12h§ï³%Oó±ãe¨ØÙ¦âÊ$K.iÓ¼×+Y÷àØ#¯ÖÚ.JÚ~¥^ã­«¿åzÓ.ß×yh31£[íÙxp¼=§¶ÖC¢$êµ8ÿOà	ÿ³rm+dÉô±%[8£EHüº¿ns4×ÅóÏ:fþ}ÄÍ=p½Ìõ*çlhîX~ä©Þí&'BzÙwXÕº-8²%;­õßOáK¿×:îokhÔs-\7ÄW(¬Èô«÷ö¯ì~r¼K+×³h²#R^Ð¿½d3¤û±¬ú;»¿F¹ÞÃ÷R¾/çËùúÙ UhËØWUýýô¾gciÂ° 
;!kÔwäÏø.sïO¡§ªC¾é-ëÔ8oTó½[â?,Gi}a!ò:ÑÍ#!Ð»AQ4y¥µyÔ®Õ\µhÞ,Ýª¯h ÛB§ÓìÚpöp»ÜIâOûz±ÕlÌ4amkK¡³i$ÌghðGìJînb;&Bç¦®·ú=díµ²z·³kþOu¾¶£E\üº¬`Ý²ô©P}ßçíñ
WÌ`Hñ*})
Ò>ÈÃ¥XÖ%v5Ò|}t!Fî²ïþõfÿÑæÚðåï«¿bÖÍFº¼v¦Û2? µTÂÁõ¡í (Jp>utV c¬I°¬¬%ézø½éfgsú ®khÉP!Të|T:!#Q¨ÂC¿V¡Ñ¬s"§Ç/ÛVB7S@Öäc½Z·°¾#ØøùÆ*áPQA	=¹hø7Oà:fçÞ}gX`-BIÛý0H#¡oº­íQ-@¨*ßsË¼çFÐ1ªe /¶`ÔÔs4yJDÔëR$kÒîÇcÁ'IaùcQêTGB 7´ñrFýø1>[4Ë²ZQe¡hN?Îw[OäÉm¾¶Jø[ü´£Epü½m¤.h_ª/ðÿy[ôï­·N¶¢AÆg1¯d!
³¥HÖ«kP|Âû¬ ¨j9d­EZÚ&b`ÃÉiÿÎÐ¾2f*À¦´l®å	î¥FæG¥XcÁl#,bÝ*:#i©iZFü!B³«XGlaùgRa¤±ÄùTZeÃC#ÔÁp9yª0paò)´µðR1Ñ¥a¥ð
mJüõunâRÎÈ ¼AqêÅã¤Ì²ËÈÒÕÈ,vmäaÃHbõë«6BmIF=æ>*èãÀÉµWgÏµ§,uU;;L ¨YTóè0
S«°^Ò÷Èm]GD2Ó!
\ºV3Æ0õî®(<[é¿Íü¥÷´lI~IµA·äÈ¶£Cüº¾~àélçS
yJãú;pCÞ¼Èj%á¤ÁuÃäá·ûTØéÐÒ4ó(R?=äW,Âða!óþÙ±ëÁï5ÖK²²=¬jþ2sÞp<#TæoðcÕþwöüUi&«y
×/£
 ªöjós,äTæºþÒrì1æ½	¹Ñ"3dÇÛT Én»ùxu}i²Üf
¡98þR%ÃeÝs-ßÏ©&®ª½eêùÚ
ë^³ÅÐÏ#Ä^Û¾=«
Ë&¸|p¢ª;Qñ9.ó ÷jÌÚ/èzMrríÌV{¬·î¶ºÅ)L+¬$nøÀmæ.T½.5u$yîGVáÊÏÍålOíÚDélOÛ^Ý ó£Güæ?ããÂ'táOK 
É-­z¦VÝ~y°×Ðôk[.×e®3­&{jÉþ-øUIÛD=óæð½çè!lQÙÖ²þóm/Mû{È¬Áµ\^c FÛçwIF	ÑÎ,ÐýË¬EÔbô£Þ|%Ý:vC¿F«03FüµÿÃ"rh=sgÂÜ/c±ªÔÛzEASÚ:Ä:´ú'ÕØ²;ýÃ8éfi­ÍÑÖ±)Þ}=JÝÊå$	ÇLîN¹¬ßuøC,¼¡dNÓ1$%ø¥ÀÖèL:xüõG°~fX1Æ´øøÉ.Mf}3±R3ÌàìÌ¿	¯<ÙzäeßÓ4ùãÞ<Lhg¥]õ,*o#¼?_À¿Ïi;ZH!6ÿüÑ£@¬üæUDNZî§3J­ÞÎàõc¦kx®-në¹yV<ÒëÁ4Á7­¯
`j¾/ZT¦
äÐJ´òÞKVÍ£6TI|I
	TkÛðDÅG®W(<Sëótä§½ÎÐQhÃòä¬Z¶×øP¤ÊÛ>ÉÝutSH=Rãé©Ébé,úÞ0@þÃ/âDgFv¬³ìÞ§
Þ/\ha­©f+¹LPÂ³3Ä:zÚ®ÊGÖd«@¨JpþV»Òë6u&Ãj)H$£ËÎ}Z6:2§£,þ'ýC^h*vö	É´ 8¯Ë\Ø7D¶ëèL¢þ9·0År
KboËØ8×¾%¾Û{0C½Ú6ßû6NÒ["nÁV×é"Ú£IÀüèù`Pó7þ¬Bw&Ëzûßx6võÈXûÖÌlÇª¯TÇ÷
 -sÆ?Z
Zý9:Õ6äÉ#ÜKº×E{d²,êÏ/ºøx6O¼ó;Ú.|À"ZzÏJ:,½ÚàAá×o|
ñ?¬Û)Ý í²ås²[cu«FÊhC½¿G«ÄyðÍ}«VÖñBW~¯]ca"
­Ö±, ¦/rèÐ0£1Ë'ì¹[Zï´XoÇ¾w²u¢*Ô²}ÜÄ6tïþó½@ÿaÛ\°¹,UBJKr®GC8NÃJðFPtÕÞñÇ`ò1_ÁÊÄîE.ø|UÛÍQn_´»½z<ûv¥Q;%·à·Ûk°Q;JÕ£FÔüN,)²qYù$Îþ?>x
ÑÉ[õ¿µÐÐR8M~Þop	O8¿ËöqòÛfÒæt"Zxi°æ_:Ex¦2ÎCÖø|o{íÒ*:×Ð°Ø'ï),ÿæ­+¡H­zAÚßQy×àëXòç½,h1æ+ÃÑÔ^{~6+û{`ÑSþ¨8R¯bàXéFÈV¤pY,ùÐÛ+}Ý¤{$Òön#o¨0V\G;rÇ2j¯&Ü¾#ãÒeNà ÄÿäIV½PZà.Åáe$8ÞÉmÆe£·ÀÑ>£ûÛ÷À\Ê¥èÉô|éõ¾èÝL1FÞ"çÁË¦Ç´+ODk0'G	k}øÿÚpõÐQ¿¥yät
²EÞ"nIüûImý@m[C¶uÿÿÿÿÿÿÿç}£Eü½m©Ï6>,ÿa`²LÇcîR(Æã<!ìLDïÍzj1¡PÚÉî4z	
¿É	~àzfµðIµjËZPHäúÕÕ<
øÖ¦
«È
 Aov 8À½
áïüäQunXÀù
 IS¥	|9Wµí§¼
_-\þ&{=ÿæ~;·¡l¢ËfTøH³±Ê°$
øúãö´£Ý\¸æ{ºÎ§%óÈ®'ÿÔú	¿Þbx>h *5J
»Ê%9É¶ªìþì±_°­yÅÎ\M	ðÌqZ3f×@4EÊG¸ÇÇßT
-ÌÓ¡á	î4è
¬H¼ÉpN·~qæî	Lyc[P·»|Uí]¤Ý¤ÚOÿµµ@#vÛ8£Bü½cÈzóQW`S¨:2PÍv³o(êïÏ¯ÏMÖí ßf^§{»ïª.Mi<eÌ%ë¶Ð>½^!Lè§ºÞ3­Áy/UÇ>On3F}ÂZ·Í×Á®ÚU­¯0'åÔhæä·ÐBIÖ<º_«=¹qÂø
Ï[7E,OhÉ1öðK0:)=×K[°sÄÍÂP¼lñ4à
\Å"L;O[±³TÜ|Ä£Y+§I]õ2ÄR¼\¶Sõ<ó0Q¡dTÎù±×®l#Å3i}]ÝyO_ ÿ¤ømsRªªWi4ie»á£±:wu(öñºEA¦Fj5òèóÅ,ÜöBmø¦¡T6!)z@mÿàÞÍ¹£=(ü½c	Èû-sâ=xÆ¶b|
tS<ý)qmíuHb(6£Ø·JØðÉAûd
i}>ÔÙ¦DíçcÅ±KòCÛ
(ÒûèÞI¥æê¢7?D·YrÁØo¦àã¹¯$ÇVw{Ëë5_î,lËUç&]³¢\ô
4ÕæÎ ~þùTµ6Æî&Z>¬'5ìý[d !"O>ÊTëuAÖç..}OÁ_ïÁ\&üéõô-6sie´0Ju¦¹­º
$(D[EÚ+':¯vxÊnE8GÇqSÈçøkxý±S@oOºà`Ý Äÿ°2äèÊÓ?wG½ã±8#Øªè-DXu©²hµ­PâRêî¯j[lr6Ù?³møUlH¹£)<üS¹yÝIB¨p<V»%å2¯oeöÈps
×§|@ë¨æ4öp\¤ó1·LîÌy=çRXÒ:t+éñPSQ!¥&ðÜG5~¯ì
O-Z¦½º¾g|;
wÖmö£1Ø9ô¿¤¢%²uÃü¤q<úbB.¾K¹#1+-vÇ·Êðû54¬©ñùêéø"eºI)£"hÀ¨^î1æ´¹5hPµi×WYwèWé¿	àÝK©"T9È'>0·GÜgÆ»I÷9.®ªu'oXQ&Uåø¬	òRÖg[ÅtºëRÏãÚ2ÿn %7Co.§½ªÚÖÀØ&OÕkÛü-£,PüAiy÷¬îG{ëSºWVrw;9YÕF.³ýKh+Ý!³W	ÀÜÐHÅ]LpÌ¯ú·ÍÊËÖâ£î[z+lßzI2!ÞìymXB-ô!Á°p÷zMS}ßúH:å'¬ì+Xë1Ë>_õëÅb÷Q'ùño(Ôjá5üQ^p¨Nðå/Mò'¼vËÔ$£]Tå~tTirþÞh¤þÓtê´ÆjÊýK«, qÑ.i÷ÚaZ÷OÔh#ZòòüxYl`»{kx²Û/°®ÛÉ²,©¢we>½ewU~÷Cï¯FísµÝ)4a14PGÔozD%&ÉÛðÿý«Û´£(düè
¯µ<ÇÒöY~§¨÷{û?Tì\UE®/ëqúÊvs«½èAK%vÐvõN¥=kÝ'·©_¬§ìÊóáFý:ï5n8×>"Ô&ÚuuÈG5B&
¨Ú½Ö 6°¯_ü*G&6ãâzX¡vg9ÒÑh ØÒÍ s5Þn¤ª¤LdzöA;úÓã$°^ó]=qÆæ¤½¡GÀ[ñÒ«*UÏZÇÞÈ¿FJ¸#Ã£àJ:ÒrfªîßN~76µüJWÜ%ó9g÷2¹R1ú¦:!¨F8E9û9ÐJI[zÎN*§çkÛæ±Ñõ¯-Õ6OíµQ)PR){â£/xüé"X÷F\c½d×Ê¨Pe`CËLAe4ú°d¤Ã8w1/{°ªØ³`Ë}õ.ÐÏh_4&1ìjMm&ÕòÅÄkï5Ëa{½Ì#']ÑÈò4È¢p¡Æ§¯.§ºèåÚÌo³">äPo^hïümGF¸u<ÐphE±Òî âYvoÉÃÀ`1êñ*V>»RñêÙ§µº,+Iò.7°ë
zh!8)ü/4§²"?îkL#DÀvÙ'¸Gü¬öpîì6ØÿtU36¶kõ[ÊfØÜ\ÇÈ½Êµ~?>ö£P/ÀâÖl[ØD#á÷Ù?ìÄ$m_Ûµ(U»6é£!üèJ]Ü{ØK7·Hô5´Ý oÙUdN'ØÈù)|õøtÔÃÅó*à=uÅÂçBz
\0T#V|û5þ­ã§jÈÆ%IÁ ãåÁµçö2÷pÍWñx½ü?ÏVÍx%vìÑËèðpoe©zÑm®}Tc~äGÏ>ÄÞ4éV®RÑ¨uïwh®uàiÙEÏûZù` ½¸ZÞËéY´)¸3]ìè²Ç1´ÿwû¸å¹ª+24VMä7gWÆUÚúÔÚ.üGÐÙ3nt²)1ðÄTýß&Ëhp'$	{{$ôI5úé£ üS©aN,Ù/ó=wvfiÏoÓSfnèMÍ.]ý7ÉDxKwa=-åJo'
)ÑÛ` 6§«¹Jî=wÅ9ÕDÃ­¶Üîx//o½#¿Q¥ºVë[²{adËjOg¡3üÞ¸a=aÓ¶UrI+3åÊ+Õ]5%Ùü³Çdø=|Ëmw7Srzò¨J÷CAj+á%à4Õrì2dÜ-Â	É{¦ÃºÁAý~¿qA
ñÈóæ.%ÝIÅEÅç+,2kêD¹];ÂÞ-ÝQWô¤'i¥m%ÿ_K`£´ü[_ÿÖl 4ÓËçU¹*¬&#»Øó©ÒúÊlÚÊ&%ú@àµðÑAMÀQ1#-<Uò:¡QÐËû0øÇX­ Òú2[R@Õ(Epä!¡A<¢Õ=Ñ­óüâ§ÁB&9 ïÞÒÍ9¶¶ñ»BLj<V"©m·bÔÛÝ»a";È]å)<w¦]Vã«ò!j ¾¥û¢^øR]vy%)ùrgXjÞ¹r¥x½k40,7Ó¥ÆÚBúa¹Hc\¦QÀWê$ýlb¶ÓA@¬l¢#f,ð=|>Hd=&õ¬¨KYcp«6M5§k"öüm¹)B¿µm£'ÈüS©eFz|dxçwÒôú½2Ñòù²ÊvõºøYÃº×['q·mïV°6an3%	
m]ß«	3´áµër~Nì¤?ñbäõ=%$ëÀ¡7µ)þ-IÞ_Ó¼

PÙÈFL.·_·¦¤²ûc?0¡ÛÂLZ¥ÁóFÈ-\Øµ£(Uy7®FùÞìåó:"þ­é	u>k/0/Zh_BÏãì»·{x¬Q6PVÛ:AÆ¼54ök.5¡Cèåf±bÍl¬4KVf÷ô6ZGê{¾YZhÈ¼aÂ¿ë¨&!ìFMÐÛâRÚ¶_ìVª«I&ÖÿÚÒUkön¿£&ÜüS§ÔÆ%ÍfZ[iÜØ=Uå`Ññ`2Z°LÑ®`½S['T(º:×E¼Àc;©4²cÒä-°6ô/ ñD&¸»s8eÌJéPkø9É£XÞ{§ ÊtsÇZ<«Âå`Ü%!^Q¿£Hg(l^=©|ìP®Rkn´ýmd3J§QÍå÷r@ÿGÈìçB²?]>µä» ª^H3zxf9»¸dbÊûýYØæF$~¹¬WÙÚåqÚXm8pÒsuõórll:ôÚ7dáôþOñØÚ²RcÌÔLPohTùÚB°ç9Ú-èYØm¶Ã×ÛÚ£Dðü[ZHª]käCi/[õ$®:a'mgkE­ÃÆúOjP=¢s\×rûKàLüRIñ'Âø~­	Û+¬Ô¨=|èTC®ÛCëBGr÷Üçb¸#¾Aé­îä¼F>ÃkÖÂY[Îñ/Üú\QÐÙ×¸å=TÒ½"4õTõ!SÜ·5âxBÿ{&¯Ý bÕÂS@ûf¬ªÏïW9qÔ|)æÌ¨
@B=^å(OPXåvÕ²¨®Îü>Þ´~¥n§¥é6¸e	9­FvíiÛÞT.¶GÕ{ðH.j»¶v\åË\\Å.êt!ñCÌÆJ6É8x­KÕä9 n«p¾ÜkqÀÚô;°Z
1Ajo`ý²IÙ"IP_6£EüAë7é²þ<ÉA ¹ÝÂÿÎò©p¸tÌ·2¾\·NÈ±£HX]ÖùZAkÈÙN®\Ù_õçðRàisÀÉ¨{sò°½wóÏØM+´ 2pÊÍßüV·âýwm+&Þµ×Yº£2qYtÚäíH«èB¬$Ùàv8(éß¬+)Êþüô{(¾ýwÝ±¾âi
ø4;Ø­ôØ{°Uc7é§têT A0ó.®9«=
QÂÃå,d/2¨ÌH ØÂÁÇë«²CÎÝBw]+|ð¯7èCr:1ø'tMJê¿¯©»	¾½2ÜºKA+à:$qGEëD¨-Ztäc4º¿<.¢¬B¹9þdcNÏöÒý¶HdÉü¾­òI£äüs#]¦øª;^1ðó(cT1ìjU»Sµw½UjC*x©1Ä|òzc]ümi­Ì­öêu<ÁÏr_2Îé«Ë(û?Z«x1mS
»®úÞÀd%'Qñµ¸õÂÎÄâå>©ÜÆým 
	Z§_L$4L»Â:¢JU+À·k ó+XH·ª'è/bwxûwºìí*Õ§,`¤¥Åq] Íí6LÔuEÄ6jF,ÂO])X_Ä` ÅEhqå¸&{>¤@é¬[Ñ´1åÑ¼ö1añòs?.úxª JUØ÷ªõSáZ(¦kgÒ~^ÞC4ª½=/­¶/fº3ø	ÙÛá´2¦³Tñ[ÕBb¨Ú«5ÕV¶Ld0ÄËõõXÒ~¤ÑÊ¡%ÃEÔw·`öÎcëÂëë;,_y/t(4Áôû§C,ûEÓfûò½Úü
$ãÂd~U©fe¢²j¹ Û:tÉ!rù-<uÃÜ*&²	RO
\qê7{}9BD;h´þß¹!2Nb-ÔóÎ.·ó}Ù}½Ó6eY	·bnJÕR£',üò¶ÒýOüE~g·êµ.uï`u©ñ24ß¢4ô=Ò#¼ïÉµÕ\Þø¸@?±âh?Áíç9ô¸oß2øH@%÷-À^&Ê¿55²}ÝyJ¨SÎåNu~`5I!¾Á¡Û«Èã²qØêìÒúHì`]º+) 7ÎÉg¹§ìÜ:Ç¥¯ËK£L'¦>Wö*n K4:ZySp{ú¤|Ú\Ç×­§²\S_×¶#!lõÇ»_ÄàIÖBÎ  Zß5tþÃoé1&-,ÅsãkAwô3ÿÔçòôNÁt,äTYÏAptRz°A9ß =YY(GäxU6ffÉHLõ°UWøÀ£%@üþ&)^pN»[O#Àá´kÑµ6µýHê,Û 9iÙH+;àLþßWÑwüâYöåÐ"ßM IÉ'­Ä¹'ýÒ÷
Û¬$@à©DîêI¡s"b_Àì`ç¼ÌÇ¼¸°³Ð×NiâøÄ9<.#ø
Äh%]®®å°áj°Ð9a¯QÕp«@P³8Òõ¦	£~zu%«Ùõx¯læk¬W	9Z®cÃÔ+,"T²rÆQd÷älB
=õ0UïëgÝ«ßz½9ê«	¬MÔ´5Èuvnð*|É¬ªð#åEÄÙËÆP8ü±ÝÎÌ#<»e	fc÷vÒµ²@n@
ðõP§ñ£kTüyvG]b <9 ò´éc<ÉðL®§Vj<?©#'÷JÕkêo³t|;o_|L[M¬tÇNòûdü'»¿C{pOrÆvöçVsý`<ÑáëÈÇÔZ¿2'µ|ç£zF¬I%2Äµ°}x;ßz²f²²ÍÖPrnÿnö\¸>jWuÙ±i÷î© þG	Ù~ÿèÓ§ã ¹VáÊqÝ×Û_ÜÁ¨Õ:oo¯CÔì£±.Ç¤öÌ¸CÕ[\Mr\xÝ\Ì*Þ½ÌþÀ}L	É7>ø:ä¦xM":$É|èÛùì°.0xjiÛSÎ÷È¨UUÂÏÀeÜÄ÷±2QÚk)Úk^wÅ¼
Ö­Úùyv®ø~_Zú/C#å-Æã]ò©&öoù'ÉÚßõ¥¤¶£ hüSÁ¶ÝÕ(qýokxÞßòÊ=áäµøÁÃ8/¬«îzRRuÔr bMqnEìËîDx¢Ëm¼®,ç»5í0°þvÓYÝ0oTkÜÎ%2o'h³ª4ØnèÑÉ]D\×?hÐóÁqzûpþºm/¿%_Ü#OxzvK¡-n\pTYòÑÐqBLrºÍÚ÷kÄI©¾b].>æÉn»J1"`¤#«w1dºÉ.ú¦2ðÅAÌ0ÐÝådâ÷o+*âRµ¥1l¸T²à NKýrí®Hé
(Öô`©öZ'ù+¶`$üP
¤£+|ü[_¬LO«6¼t£
î*ÐvuTwËç-¨þ¹Ä)uËà¸.ÉCm¯6*}¥FÏj¦^RÈzíý4¬¦3Îª=¯Ë[[}ÑI§DüsÂbÌ×ïèðLÅhþN_Ò?¬8ü[ßÉîã®i#ÏÁÙLÇÒ[ûwÞÃP åã3R*ÒòÞ£­bKy
ËÛ¡aäès5ÐTFÄGH=P§Á-'¸yNÛÀ`o³ ÑY©üÇ!7Rvf«!ðSþºº®¶¸dàÈ-Èiyqz ±õÕÐD	b4:~*qh³m*½BgEÔbQoß:ïCßÌ
ÒdüÒhv£'üS®3¯~Õr;F6Ä#
 ñþ,­×ÿ]eç¤«ñ>Ák/è%ÈJ|$±ÂA_@ï4onÍH°nøâM&ýè4L}xÁ¦r!Ä©Äª«m®_¼UÄ=¤$?ÏÈåwtÍü+IbÈ{ÒÕbD?ìÀÅ¡Ð=ÑH.²Û{ÿ>h,?ºó3+ð«%ÃnsÆaýZð´*ò0gê]?@µ4Õ¬³%PÞËÖ%:Ñ
ÉÍÌ]ÜI~©¶ê`2P]dHi}ÛÏz2JÐãÂËúz$³ó¹ºE~ÒÄ`rBä¦*hJßÉKm¤ªÕ £'¤üBW,(	Þ¾ì¯ùªêyÓÞÎÎ¡Øº/5ªÞhçÌü'D²uÜg+léâDUücfjÙö`bE¿O¾ø#q&*¢§	î6¬uh~x¢p`ÕßN=³¼|D¹­ÒÖ\,qÉ9*ÒßI!ý
6¢u¢Ú)ü8ªµTm¾oOí6X
\ÊGÍ¾å®FûÐ¯Z~	WyãG9Âãö,8nßä½ºU°ºÍ¢x§%)S):0iPH?äòhäZíi÷él@b~âÉÒ³mªº<e_÷å¸Æ.ú¨êwc|hÜXaáÿÑ¢?Ô¤¸ðÆÔk¤Il@"ÿH	ý/¶M¾¿ÛÒ£9¸üS©³/"NÌµ¾g¾HmÏ®¢ík¸T_uÕz`$wØc®Kþé¶µ§6zlþT­[òøX6°ìÏßgÇÎJú#rFZ?nvÏÚRDÿ¾ÞKH[¦Góòc}!vbÔ¢\²Å¨ç¸ßÕ)ùS\ÿìô¡y<^
à`ÉjÆüs bè½6È´ì0ô
7Ã@Ð7$'ÄvÌ:¢Ñ¶Üpª)Y¥ò.óA¾$z_DaLWî´BÆ
=·Ö­9ÎÖ)uþ¶#¸múmK6%$îCâµëw¹æcµ¹aÐqCþPKýL|@ò}ì×¼;4ò?yÿÉb¼hà¡9<Sg9ISµÌþb¦¶çÐð³ úFí$µ%ü?Ô$£EÌüS¨¤©ØÍ|ê/\ïé-üBr/E~Ô±Ì¯NÑ`*Ña¾Ú*KPoÒ3üWÇ¢[¯m5=8H&a#Oð'LÔÿNÆJ9Aê±ñ°·m"×ô
 /Ùë6lIÏ³~v­@ÜÌÚâµÓLæÈf.á
ýõ,|ÊÁÊö]&bª³tÖðÏd÷
êI°Çymäõ-Å:S¡Î9Pb7Kù:yBLÎÄ½ªhÕ²ÄÑ?9»*a\×`ËðT]µL·ñ1YÒB"ª²_Ýôþã¹\þÈ¿§00{ÊÃM<×I]©3klÕñÞÄ$¹]»ûÞów¶"æÀç8ò3ÜÄãbüTÏ:Rµ-&M$ðÿöI£EàüS§ÙÅ/Dc3uùÉÞä&|ÔuÍ0_ÉH¾2_lÌ#ú¸õµ»&ê3*¡Hq$âéKíA-wlðàñ®Õvç,Åº)2âa0æ=hµã	ç UEÄ5}çÕNÕ1fCíãálfÏÆAßÝkáöFÉIóRówóTä»â¸+Gl¹[i; ¥Ù\Am 5å¯ZºÛÃfVõÖ6¸å_
v·ÍoJÄT©É­Ò±¦M9)^í©vJC×1(äêÓë¡·diìÞ*éÖC1lzI'Çóòªâõµ9Vá¢ì£Þà¡íò66,ÄeMg¾ÌêùÄp¾`øùnWÎÝÌl)?K`-oôÚßÀöý¤£EôüS¨UhfSz»Ô­}¸¢q
áÊÿÿ´^Õz«)bedÞvfÊ©ÑãRÎæÜÔª<²bF§èQ®Ç­âËaÿ^ôòù7 VR@èñäàk.>ÒÈºB/ó±Ð$´HÄ/4´FÉËð/wKwË
÷º#;2÷ xWtÚhJaÌ|Îs±Lp³	h·GèuÆQ«ú° Ì¬o&eöå|ü¼ù÷~2?eôN°¬DSjEï12ÓÿX({66tZ_FuËý R0¦-H×ìú
Å÷øâd|Ø©¶ß®¤Uð=nã¨åä,DGç&ZIÁ`[iq¼ *}JìÀa³RòÂFÉu!HF¹%aêò¾Ék-¶ÿ'öÛ$lARù-£Eüþ%Ò÷riû¤¦óºÿ;=2  ¯}ëèFsB2­Aâo@1ñrí&ò³h2rÂ7M°z[ü_alv¾î·õßÙ!îmÆÒájbÌÊY½ïôyqw¼9áTúV¸ÄÂ¥sx`BóÃ^
+éñì Xã¤ÏÝ(åzPÛ%oz
Ýgñë
þ.¦ÖJèë{¼	¸ä¸Ûø×(æÃÁXPO³2lÊ:.ñ<Må¸\m
Ø¶ÌÄøxÍ-3ÊWYTá©®!ÉAëK¼Jû|Ô<K::ÁÜÂúnt·ë&9R«öÛºßÙþäµçý3V·l²µ½ üBO	M`¤¥üí&Ù	ý´¿n¾½*ÚÓ£Eü[c4õg± þ¦Ñl%²Ä¸NÓÞ×[±^¢·ÈõK²{Ü6ÂW-cDb?@fÝ¤¬+uÁ¹,"ve3ÒFþ£Tg]Ã¡>Ð!¡jððbÐ 7rÈï®4ÓGJf¥`×
Vù¯7<
þÞ÷Ù_õ£¾÷Aä7Cÿ`&vn=,ëæÁ¬[~
,qXkÐú»£kþÉ°Æ%Åô3ÂøÔv©ß¾vÇGm'+]
ÞÉÔÇäÁ¸Ù9vô¶IÅÉgõÎ3 &F¿¥pÇµÉN\¿p Òy¬w³I¡mM²3ìVNG;ÐÛ Ç_GÜ÷keäIV/C®S×~íx­­	F ë!§dÏ Ì¾ð.âmHm$¤Ù¿Ô ?£E0ün-Ü&ù[¬hA?>nÓ+v´&)þ
Ò©½eªª9PAÅ0ê°Ìê¦ùÕ
áïKw«¦i¥®
$GzòíßÄmÛëJÄ|ûr9<§qéÌ|Hbão¤>;ã¼{W¶ÇçRSb¶¸y7Iü*Y ï*F
ÖX·¢ìJp>¥m#ðo;±écèyäÍ=(;òñið _ÉÂâäëó¡d ¤iì5/>Ôz_Ê!d±5®8YÌ¹á¨/n»-OFHTzÓ«IIÒÏã&*¢R*vQ0N£¶<`Ý^VF-B>`-w>z%QD
<x©WXø%
¹AÏÞÿ¦ÝÊºº±º<­X{¯Ê-]^g#ê¤VT¶[m¿äii[Y£EDüS¨Q wS§$f5)mlÁG8Ï¬arîrQÎßµ¡¾\ã¡D¼%¾Cÿ6V¡öüþ}¨\¥À@©ÌßÛ¡fÚ?Ø¯ßÝÇ÷Çë.2.}Y¾ô¬ááunôî>Ë+N+À /þVGbÚÒ4Q?Q|8ZÇëcè·]ÍÎ$
¿Ql­[|ä8¹½ð[Õ©
m*¤sÐéô`ã·Púe4ìXýÀü¥	¾ÿgqÎÒïTs¥¹Ó½cP|ôË;uYÜ­Í£'cä2ZG¼®4§#\®8Â6¿Q¾4®ÐÚïÌ¾eÐ3¿öæîà).:®¾2Wu¶Ùu)¸CDA¬é$Â¿_MÇJÛ$
µ¹6$¥Um $£EXüS¨U´ÈRëû:\'n5 -MIÊvLøQWRÞLÔè§4Fí^Á®
¨ Ædeÿg_¸[
~YlÓçHEÚã§é¼1Õ³uàîì,jàLCµÂû¨Ú]LßÏÍ[HÞLâëahyH;ÂÌw.Úyù=ûÖL½+Ôñ÷ÕÞ¦oÒù3«Rb¡NõÈl !*Ü"£è¦>´ ²¢½yàÈyPhR#rèþú1D[UiÅÒ9¹Ü¯æ 1À_k'&Ô±4Åù©:G6-ìÃP±ÖØÜK¶å8l5T¯Ó¢¢	Ü¤ì~yòf
Ã$Î#hôAd U%7p¿°ó×_«0|©\x"ßöMÕ¦aù´HKmùI"IØV_ÿ£ElüS¨+¤Z¤ËVÅMyúWÄº·>ÆjG_d_z)uüçF¸KJ@ØÐ6Ê¼§£ÒR¬©LõYa×¦AU~¯õ;$ÇÊ§ºÓXmzV=$ÉiÏïÍ8f®dwrû¨ºå'*û)ðÃÒ¡0>3<Êì4i¡UX":ó)áÉÁHÐâë]±´e¦³YêIqK°­uöXrâ¸ã²v®+<êu( ö£DHµº¶çZä3·ü?ÏóTás<Ý#îßÕÐÛ«Üp¹Ã±ñ'×õ¶¢Ê©3®$¯1®Ôx3ýRÎC*ºç/Ã?=´tcíúyb¢¦KSÃ
aUó2O\s
$Ç¤d#AwÐ4ÿò@m$­ÖÕ@?ý¤£EüS¯°W/!ó+»YÒå©:Yý|ÔSBÅ+±`}z7KÍ"×÷ix&mÒ îØ5ÍEIÎêýSî3"	ð»¹îWåuÉ¼ô¾ÑÜ<S	Hw´-M'Ü£¡¿3ð}whöx,¶%s¿)mPký` ®Î3È\<¤¤úHïMub½îT35)ºR6}ñ¶¾p[Ý*N
,êh£)CJÑ×²Ög)SÓÆ¤Ì/2"Æ&)Î*ùì&ºDU©[0èÑg/Ðæ/*ú -úN!Ö¨\þ[§43lÖAwiq!ºJ>0ü"
­bµí¨Û/=H;×¾rÅâ|Iýé-HnBRJÝ@ $£EüSÁç1JI¥ëpÇÊVÜÝï@j_Íí:èAèê£öiZ>'3ÿD¼Û¸^`/QµuIue®-wÆcô·ÆUÇÈiz¸ÁK³ò`ç*ib­û^÷CJâ`	¾¯c0®Ï¡17kWêÞ>X:wïIFÒÐÀtû&RAÂTÊRz&è¤2þ£Ì 4DÔ
ÚTÿÿ­)µåÊïøxÓ$ºV ¼HÛÃ3/IQ:ú	Õ]÷ù¼1»çV<°t'§`®®<òþH+ëÂ)ÅE(b*<Û@+7J¶£@!Àñá¤I4eaÐÌÞ!ÂXiÓ+Õ}ªþnì%Ý÷÷ÊÓj÷Ä&èÉÛn~C-6Û5¿É&ßäÐ=[_É£E¨ü[X´oö$>Úù~fE¢Ý¸@Ô OËÕö4Lí3åaàQw¼NÕAeCÿ£ÅÈPRVu;Ó±|õ£¥¶d½ý¼#i:G±áÖR­È4½­79F)k**Yµn'LLÎÚ½F¼¯<Ê¸«5óö³/¾¦jÇÜz®ÕúóJªz~ÏÏ{Ìã­uKóGDÝè`]ö©öI±{"ý$_c7çË²{/h¾
äBg!cqõvV8Uðf×¶	 zøB;]v¶ä49IUs±$p½£ÄN0ÎÄÖÄñÅs<\ª¾p8úBzf°bÌqÊÃæ,1ªþMÆþÇÒFZ¼ËÇ9õZ>{¬_zÏGß:Ù¶´ÚKI)	Zù©?£­¼ürÎ
fÕ¬¶°O(sùQæçCîè;cõ¾{ÄMâë / ®!ul3áåß2v:Â¦ÿ­Çq¯°(êßq¸²ÿJë<´ôá»òPóÝê4

Í*U4çùÊ"Ûùg5K¶öc5ßØQgTÎâqC?EhÀ]mp°ÑÖlLçlÔ§fvRv^°w0íÿdËS¸,ÑMã<¼ûÆùZûÜ<²4Óx*¾PXiMm+¶Ü~\±Ê&âÞLaâ¦×Kz}ßÎ~K¼ÐLÔ-_Æ:¥ú¡08øw>
¬£ÙRùCí
gMô¯uqìkõëHïdÚìX,ÆÍ'ÂlG&R«^°c$E9C5È½¼vhÚêÑ Ô,èYNgÃë«ó+ñ~§Û¨© ¢ÙÆô©§a"UYx~{
L7üÛ¼B·ÂåÜ=ñ2;3ëÆhç.·ÿþ} §[ÎîÈê	©çN¼(#2&P:5fS5Y¥ÿB&b[ý)-
¿õ'öò@£+ÐüAëNäglÄ}ñdE4Sj®	/§3xËö³ ÄlµÃdÓÛ%ù°Ð¯o ü.ðLó®Å°1r?nñáw3ÐS(Q»ÂxëT³¾7KÀÔòú½xàW#	XuYZS^Ï×&â£*éÐ!ÂqðWAÏ	5ôöð°Îg³­T©×,ô,Ä7ýç' ´¼[ê}lUo¾Ð}J*MÏêHèÀ=`(Vðà@©S¢oOeS4ÖZ`J¹÷FÈB¬ÓéãîÌË|1;åC`r³bFÜq=ÑçqdGñ0-ÅucD ¾uA¢ºj-k6 _P¥¯£2äüAiÕM¸÷õLÖìI@ÕMälóv>ñh")²ü¤wPÌØÙ5¨`4ãÞ2U"bÑz7P¥K2´ØBÏYÞàÕxç%ÈYhÀ§+HqÅ­¸ðbHÏxÄ÷ÑÇ¶W>ð·sß9¸ÝÒ!4·¸-µñÜ%#ïe¢îÆnJËl`£-!ZñÉïúÂ<iÖ0èQP#çÝV|øëwQ¨9çÉ0NÈ¯T÷£Ï»$Xh£Ô^VËä¸µ«ibKºË)ô$J'èÂF&ÜåIÑ¾(*o0* 1dfµübõá;Ík=F×QívWñÔ½Ñ¢ûÇ¿â:ðË¹LÜm"%¿KÀ¨£)øüBWC(ù
{I=:_¾¸ñçÂ+»Oóîm?eäÏæÂùsv¯Mr(uØhÌZÆdÅâ·(ðlm *d®vþÚA¦§xaãº­+5éççøCLók¡&¬¦A±õíbGà¦ãÛ4j	¹Z¼ö¬©Gè@ÍAoðq>Ñ'õ/ÎLdnÚ¹Åê¦@&Ê1¿&¡(a#¨Eztö'
ü½É7ËI+ÖÚùò!¼o¡\u­Ñ#ewtZ°ý¤Ë¦Ð27Ð¶ûùó^Ì¾@úá¤ôAé¬q³÷j9]µ=ã
Xy¥<ÏQ{Ð	m¶äü>¿õU£üyXC¿tLxeîÖÏ#kA_µ×ñÙ¹ùæ3x:Eàe­Àñc©ÉBrýGÛãüy¹jw¥qµÿPð³NöMýåî`sél9·¬Ý8XG3³:îÂÖs×q¸äg¡4·<A¡:²ùwj
üT!®»
VµdLwö*¨¨Ök LO/d¸ÞÄ)²y[¥4íCs¹¿ãäÃáíµÚºÇÏþå¸Fk [Åà+Ð¡µ¯­ªóón¬lÕÛ(#oóùÎ=½j	@«jà>cube¦6Bë_][XÌ¤©¢MOI0ù§r@ji{ý*Üezÿ(N²MVç·Òí\3ËÝr_+ÇØ°´¯^ðDjB{ì+áÔ>(©h±òl/ÆÄÍ5`ÉÞzòÄ6¶?ëè9 	k2¬ØLÉIqë¼zø>3 <NK |;jãZ¦ERIÙþßÉÿoöé°£( üS#Ðs²åùÔNGLö¶Ez:¯IÀ«;ùMz%|éj<3kò<ÆÒE
o½b©ÀÄj~CJ<nU~L&%ß­ÉW¯ïõ-/½Ìï(íÏq£4võ$Ü"ÂË<+OÕT/:ÅÏàøgÒµÔám_ b*ÒÀ®á©ååæÌß?¡æ±U¥çSTàibw]÷D?£¢)Ö|@ æ¾[U¢c1¢iE9¤t>j´×:ýt3Ù¦ýß~©U½F·r%#ù7þºÄÁ·¨BôÚ8-~æÀ(\,øR@-¨Z­ýiDz$íJÖÿ'Òÿú l£ 4üSD/§	ÓõÉòtþéþ«7^·Â­û±/éCåîc5c:ûxî@MAÅiNÀý!¡éåÙ³f}0#Ô`ÃE-|Ôn´íë¥QÅ¤Ð
î
·qã2ºFyö-ü:j2 7¦y)ûDáû;Ú¤lUÚ÷Õ{L9úu¢Wï>÷ìí|ï|;÷ú¤ùFrã±mç>ç]d§ÄJø
aá»ör$¤K8íÈC¶|WøcÐ Öõ·¤'¸ï÷`rímcç²ÂóOf­]lAjÊÌïÆ J«ôëlMÀû´?s{}>æ±#R© &x·K#Ï¸´ÒK`-´
¯ûR£:HüSªbþcùYBÁç!ÿ£ \fÑo^SìµÒ*R*¢û8N@JýMs	#*ÐOïz8?z0­V¬Á×Xè6ñy¨¢a]Üî
ë,ÐeÂ·xd#þbWLÀæFM\y$ICbî×<]ó$x`ù©5Ú`üÊ;#QÞH ³JOÁ>/ÈØÿoå5Nºú·5]Ó·L;.Uhöà]g«i²¥¤;Ñx¼Å`G÷~-°³t|½H`ï'îIrÑ:dD£D®¼Ó´Èú´¿¸ôÆóØ¬£Ø?¬·ûû
lwpÌÅÍj¶ãv·QÕÒæÛvþÐú% £2\üS¨+µ)<ë è¤^ï¿.·
OÉ Þ&¹ïX/¤Ø*&¹]ÊËy|Â>î	ì/Y±ôy'ùà}Ê2<`
æêf'>xP
ãxjËh¡qyGVê ª"±åµ±ªuYÒi0i6.Nn½(»MºçI¹'õùkÙ}©¼^á/qh0s1s`&¬Rz4äµÚ#Ð¯Ûm¡º×ÕD²·^Æ:x0å¨C¬1ÞX.¢¸Ãîe6B{ú5ué³µ~YMõ­ùÏ.õ
s
ÁaÅÕ1Â¤¸Ä¡&ÙHÿ¥T¼u]É »º8Ë`×kÑAðè¡#³*>¦·lAPuùþBd¶$õZ_Jß£EpüS©²aw[?5
ä+¶øi*	« oÓ¡:¹»Â±ý
¬ÊÍXô-	y¨²ÇÐy"^6ÆVH%ð|}ºÌ¼MÄ«`ðÅ¥|eýRxÅ460Î÷vFcº!èµÁùþh­t÷%Å6ê+WÁK-°WónZ¢31pÛc¢ß<N³rÙÞU[å±æTWMmãé1ÃAµÛäë7áÀÂOb´\ÝùæÛ=º-¹-zô¹wiÁPÿjTGoØá·NÉofzÖÒ7¼ÍHÎ³&tlÙ±
RzIóÉ®Òm däCÏøØ,**=2­+mß\|ÌRÿNøÎÉÚ[OÉnKvÂ·`£EüS©°Øý°5á.´¶ÁåqÊßuÿL=GL·ã×ÉÞpi¼L¹kQýÞñ¶VO¸FZ3 %£i_'ÜPÛ|w7¦eK9GjõR-ÞögâþÓ¶Æu\ÊÄÂÜO[ØâyÍ_ÃéÎûS*?fh"ÛUÿá5Ó2ð¶ïÈð³©=£ö\åõA¸ÃúÖÎUA=ïïwqñFn¼ñm;h×D«lßÏß8IèO!µfU_¬÷`³T}jSA9Î£¾vh°öõ)eQAEªZZÂÏÈuÂÖÆÐW)d$¬ÃýÈ¦HGÛDZ ÷5êÀÖíª[²R;x¸ P°0ãådP£/6ýä>ÁìêÁ3ãt)¼iý&Ð-üd&Ð*¶nÚ£Eü¨Ïrßä½Ì/ã°¥Ã7<\$º¹µÐÑ4R+o2§£!í9q©¨Þ/û>èCR)7x×è(
Æ8&¥ÛëÍàÃeïým¨!¾<22¦ê1>ÐW2eÈ]ùî-ú¯jÔëÌÈ(BªKcoÅ»TüÁøñ¯ð:ózT}iÄ,ðJÓì¡V|VBèJuK ×¬<¤q-7*éÀ1Hk,þ5¹c½òÖÄGlïu~?Å½"ry/(úüÜIÊaDD²£»s×õ(¾ JLè~ÕÐ+Ék=@ÊFÉ¬ùQ0D>)òíH?ª8Qµ
Ñ³¢#)	:a/mpS2ø¢Ý ×ÉeÊè"dÿÛØdoù'ý ù6£E¬ü¨ÏsÞñ7q $8ËP+ãAßtéÒf¾Áù±ÒpLîÙ$²8¼£¹¶kîÃxªÈõrÀÉJzP¬èì;ÖrEL
{¥$hÐØsÕ5s,þ$3²B`:sÛ<$äãER~¹lW¸Í"Áf§;Ý0>*oê÷HO}tUýpê+üÅÇNá|»³M	¬MàÁ¹··?÷îõ	s,ßQ!xd¸¢ØÊÀÓMi`¤in9r[©mósMåmõô;_!^vÃçEYof|(BgZu^éõÚÚ+<§ÍÕÎÄh©"Hg0kýõÃc¬jfOVjv¸J£»¸
níKÇ($ËÓúx/±Í«IèØ&ÐÒ%/äP-·ÂEª$r£^Àü¨Ð Û$'ÁÁL#>¬µV_l:S?»yTÌExû4q¸}¾º-ú2ãÂU¥Nµ?ÅÂ&ç6ê(Þi­¾G¢!N Z$¹ïåKéªy8âÑ`%¬Ö¿dXêK±øÙá½1FV`òxUfà(LÕ1R$àäT$ö=
JÖk;â¿>Ú}(À¦zxÐ"axË7(iÕôB|µlÐùhª6Kx;y
&ª?ßrx¬ÃqT@:ùÁ-õ×R
ô#E[vÖ®ëô¤-b¬§ËM+½¿P:¶ZÉ?2>øp(I½hFÂÐSO
ÛUÇªrÆ.´ÀÞè:TASßÙÚI6kÊùC¶mXÚ=y«·Åy«Þð®ÌOw¸º¯ô|-2ô¢Ewü	[&Ý©²mÛm¶£@Ôü¨Ñ?`§sÉ¹Ü¢B(l%k,OMJá©­¯Õðpï¹O­Ä²=zÍnÜðªhõ-8ð0´ >i¯µ`ðõE<qLòk·û
´g­Û½¯5nÝ4jèN¸DÐÿv^¡3}]!²¹þ
CÝó2÷Ú>5m}Q.Ãq¶§>Æõð­ËpÞûä)#
àÀ0ìs±©=Bú,qVLjBãÌÂ	y¼¡J})êËX¡opv n~¼J=1ëîJ¼)aÌR6ê÷5Mlü~õÎ5«=[úz0T"ª98,Eà0TåÆYEKÎ±ñöW»W¹©²!ÖPuÃMóÖÖÐºôB;êiÜßðôþÚý"AjH6C¶uÿÿÿÿÿÿÿçî£@üþ$8ÉIrZ]K«UÝfikW> }ÜÍ`´OgP¡WgÞømT¹ËÓÛ}On!êísî#Fö]±º¦¶Á¨×kM@ÌÃ½=N©1{ï´Î`[ÎSkýuÂ~A+ÑälOÖ3Ùrø^=ðÛà\OYGb]êaáDÞ¨Wäô¥õ´w:ÖX×gÄ ÃòC5ìi£#ÃUujuë©A&j§´ß¥æÒ»­i³âYÂÆÃ¤ÍùdM
=×."c+ÚÓ²|jzJ¥¦û§v?CX[zU¨Aþ|Vu|ßPÌaµ¶c<û@÷ÞN*5åzRsxNÿýBY»{Üª!yÖ!
Àö"IoÉKÕkð+öH£NüÓyâìi{+Ý·zö0'ò(då
¡ô§£mE6Ð×W N×cøÑÏ¤ÚóË
,°æ©þâüxRz¡dâ'ê¬ÓmGÈ^µ0÷´ÀèÖ6áD?Fh.Ö=¢õ^ ¸-<°Òg:6]«íXRÏNèùG8òùyÅËú~B$c
q0].¢zv¯å>¤ýæõUàc½Tð«Q}Jõ¼"  {(lbÑ8ýF>m1¨ä=T´â#~ê3Ú´ÓÐÖºI	¥)=Ë©ÒRBø¤øxdsoÝÂnB³7=àû]xÇ,ÔTð)è{«¸X¡^jZÔa¡Òa®IÎ¦ýØ	èõLØ$2é	?À-¨p:õåç(p4Ùvø3¨V2þAXê÷¡Âv»IjÛõ_ØI±£](üS!«Ü ÜÙsz/²©ERY²ÈÜê7ÄFËüç®É¢Èu^G¿¯¶#G3-
ÎaÓOUgm;¥èÈ¸¯pÂS{= äO»i6QPÑ^zÕÙ.ïò»ÌG\%è¤Wëw÷Âôÿ©µ}aÔpÜ{m­i$ç¬¨}«Sºã
¢mÓª¯5úüV0ÐowÉóJ7YyZk³.^4V¡£Ve50gËëh÷`×d¬k8v¨×~T)ò÷§±î_{ðð¿(Åß6­ÄT¨o2ÉÀïÌ;1[ÒX)-þ¤G»ÂA óuc9ø¯è@{|å·(cd.e/ú¢KROÔËä¢W>Õ õéÎ}ÆÀj1XìE¬¾?°ïóÏ¿Ù¿Û¶Û[ý¿ÿP+Û $£A<üSª°÷h¿ªv([j!¦e¸·7:Kº8avl'4^Jeµ4£ì³°Ú'M9-Csò£mõ
õBìâ¦£@¸JÍY$f'ÅÝÓÈÿøq^9GeZu¬$J
ø>éh'FbêE´bÛ£Éu½ÔÜ?5Xõï~ªºvOq¿A	0¸<\÷­¬ó±)ÂLj¯ÏO§Z"úê®viºxk©7ÁÐ·z3Î(ÐÊawðÐ:ÉëzæÆÀ*o´Ù,m&ýb³å.ÄÚQ¢5d»îôûFÓIGh½Þ
"÷Öew
²yGmY¨AZ]õ%RòHöáÅp±ªØ¦Ä	àôëºã¼~ù¨OpIU/äKWÔ	'É£MPü¾%²|¤¾Mlh5Vð£Ðø&hÚßêè)RZBçUËe·6ÏÉp>[)E6OA¨«z&·¥ñgÓLÒ@ððø¾µ<.^j¦ônQ³e#s5Æ;ñÌù4YÑ£R+ã»²ÌyÝ 7êôj²8IRêßïv§4)¥%¦MæÔ¸ZV~ô®»TwÒ}F·Þ¹Q &ÐBÖ/×?þ5Ptaâ\â6(Zÿ-ç)y>fí'n»Ò-FUI£vc#gÂ/	Gê	Xª!x|»¬ìmûasFõZó´wbïå·
"7¦Ì°ÔZîZªXévKýJÝrtä8è[qóÄ §¿s÷©/È#(
Ûüÿ&ÔÒ~·££dü¿qâ©<ç³\&Þè¿l¡jdíóéz×Ø»}+º$Þ¹¤×Ôíê©&-ÄQ¨xkXïßk iµZØÍë 0ÜXM¡¼Xxèu#ìZY¬Ex>KØÆÝëÑ6_ÿ¼îÌ¨¨íÉ[´4R§!ö±(8ÏÆSgåK&káÉðý\¦ñÔ[ÚvxãBØþ}î:¬oçºU±¼Ûhéïý¢zðßß	$¡Ô<æ'ú,<gÿC­8ýæõ;®þQ
ú¼äÁç
¯# wð.øØùºEñ#±ëTù1î³U³2aKÓ®úhú¸H±}Ç! êºé,½øó'ÍHN´óµ¼áç:8[r9¥g²_WÕËã{ßã6×!DÍ
Ù\ã¯ÉN¼rÓ±<vý¶ÖdÝgUW©¸½HÞy`eÂLÎq6Þ!&qà	3éÏ_ó6	Kv¤­¤¯¶£Sxü[bÙ°o+-öj&¨VdõMö«gX&(p~clïj|+kke9à@¾a!Ò¶ì@ú»xdíJu4Ùör7·mÁRI±=¸DJ^	)¼Sã0BÆoÈNlÑ1*O}gCÃ¨G'Eö6èT×¯þ¿æ¥È=ÓBV5M¼UeAn¿olÌ¸{Ày£HùTêîýóñ¡××5Æñ1À¾ó
Ï°^¥z±B
æLd%'eOuô±êüÔc6z'\l¨3"Er÷ÉÞ¨Ú®Æ¹>RT¹z£2¦]3¶HxOþ
îwË·Jâ£KAuî§2çÓ,£­ û´ªØÏÞ9}¦S?*ºbð%®D7ýó¯1ágbÏtÉ;l&*]ð©I?I¶ÛH¹	Á nO£IüAì
ð}Û=ìÄM ½%'ìk@È y²9ÐÚ7Ýß¶ºÂ
çvÏüø¿kÅØtzåg\0]PçÃÃ³÷7í±pºyæDÿcþygí:ÈðFnåÝbÎk2«Íi½àÑAäV¾~2úr;qó¦oÑ1½	Ù²ÀMÈ:ÒÐ.ÏR!¨E=±YÕ;*ºÌñweO'¨Ìì¡R3ç? õ*°÷%/KqªVqíöÛJÀw3Ûãú<ÄÌÃGgLãæK°º½èýjþ@µj¾x»3óå>ð£3Py>)RûÑ»ãÛ	½/ã7¹¸0Ñ§¹-Û{^¡ó>³½ÇK§UºÜßS~ ,à:t>ÔKzôÿöÀm¶í$$oj PÚÕ£C üB>4Lk:³¨ÀwÑ­Gº`Ïè«ø*ªìüÓðVëCR·´ídüwºðu¼üA·ÿæä¥µ?è¶«þ@½ÆÚÍóq½¼¢lhÅ²"¡iI{ºæ(KB ª×3XàÑÅr«l¼¥Ï¬ºý¸yßEjËA¿M>gâ¾8u4MdÁO¥}ÕæÇ6L« î/¢CáþÓaÐºö®
U	~K¡OËþ.%öòóu²ËYázÌMvv[ñ?
³(w(r*{]=û°¢x·æ¼CÎ,o.ÌIîV¸ôhbÄ­h5T;ü#ìã`ça=F¬§1âYÙTF=eäPÆ¬4ûrh_5>ÆZbfðÈzKÖcAõïù!_òdý°ÚÕÚÙÔd£U´ü0Jv©ÙG¬*[é£BK#.¥ýgG»Ç¶).=lìãðQ¶]¹âvrIK¢­T²RÔ/BrêÆµËuÙ<þÂ§òÞØ=[÷¨?wÜ°Y¼ÁÎùI¯Îa]E|ë<ñÀ­ÂYpó0ÇÄfæ|S5±[]´6ñÈÂX>Í=	ÍQß/dÅ6LèÝäÖ¾83<0ÌÏïLåËãËßT@ÄÄ_YÕ³­ü¢ªn¨AÐäÊXð4Nä6ì*9Dó\·>ZîÀôb'´Ùû2Ä1kcæÈ6î¹<5'­püßö¿\Ê-ÍÅÃtÆ |%,qëÑÖ!ÞÉârØøLàÁ±Ã¼+ÑF;ãÌMÙÒwuØN^¤#à@}Ü!Z<è¬q!#XéËüö´¼öÿ½¤£cÈü4Ü|qûÞáÃZ«E #|ÒËØÕ}$6åÉöE5}îÓÆ?rI»n||M~¦?çÕ6ûC~v]èu@Â[_pKWS@ÕjR5:ì;m*àfád9¬W_¨«Z©ß<ïÝ92o
%?·¿=¢¡´ÕnÒñ1é/_ïe§Ú¢/BøÜ¡?ºÙy|]2¼:­pü8âDÄúIk8mJ±³çðc{Ï¢£íºuwoP$Ö5V¢h4T5\út¿b]òy/h³t'[Ð^ü²Ì
4fGVqk¶K&L·÷ï_~LA_Á8kx¹/¦h_pÀÍgò*¸Ú^H}æ´°ÝÂraµsm1±ÁSì®âj¹ÜÝ°ÂÙÒ'"GçQDý0%¼ªLkÃIRËøËI9å-Ö:xEfü:»ÿäÿföö@ÿmº£MÜüæLu÷Ç¿6¶ÝHÓ@+]KwzÄöeó¶éÁÛ±P½2y¦ÙÊ{ÌOBoÚ2¢vq0ë¨Øþ_jw¸\÷»gÝF!M`UDìÐEË)¶÷³Ûþ0ÆL>×¨C AeÐºwµ/ÚímÒ);	ÔäI`¯0ÿ§7×B¥«¿¥AB »T#}CµpP¿ð6Û>RÝ6ê5]ÍîÓ »Å­¸Ù]+OèÅËÑ ¡ÀÚ×Qÿ¡¤Âë¿s£,/Ä<³Ï ­ï"PG]ÉãG)kcRd|á$ÀWÑÁC[8ëÌQv+zí3Î+ªîoÞâ\Þýu:Çï~öìJU:¿µ@Èé6Ü6SmúúÛþ£­ðü{Ã7¯[[$©8üÖhò¡,¦´XÒö¡6D` zp;êbw.dÛÛKgÂP·ì©eÿî¾Ñ|ÍôóÉN¥U¯ô]æû¢oMäQGo[èq·=»Ð\ß$kòß¸¤jy#Fºîæ½næM)ÂÂ8*?^Öh
´÷íË]&KC¬ÂTêÄ`)rA
7C
rSióï[KÎ;»V¼=Þµh¹ñvö¨²ðåìÚ¦U¼¶ÕcàZLößÝnË>oäG/âÉ¹ÔX´Î1¼>ðÞÿì³þÉíÞÑ=< °óèã½é 7bÉ7&óû)Nç.¡Öéö¹Â3,Ù|!`|ÿ¥NC¿7AýÐÌ¬ïÎ§éÆniçtuÎºü÷í±rÉøðT¶ÏÞ]øËC¥þ ´ìþâYÏ7ç¬cZÈÛÆf_¨ÜáY¡èÈ2éðW¦ðî»½ñR^~+2ýÐ´¡A"+Ì0Èº¸9µ¿äm»ÿð_n¶Þí£EüpJwÊÍ±sà55Ý¡ÝÈuFxÔBºÕì}kÆ
ªÒ-çoê2¦ßÖÐ®hF<ò*gq-<ãÒ2É ÊðµMHÁÑ4¾¤pLu7ÞÍXJËmäN=úÉ£ÏÁ@Èäy¢U³ÓïtÍ"¬îb­(åPðÆ=c¾=IYã¼}2	omiøÄ_¡A©à¡ä%|yy%9ã.q'«Ý·ftçà1ç7'ì²Î ÀêÅmícMHK:¤¿åGÓÑ³cçâæ6ó¢pÞ#N]ûç³ÁUL[¬Î6×¤×û¿Sé_Ózn9.uþ6jM+R¤á¹'únÝGY×æôµÞüû*P%V ÿ'ý¿þO¯À£3üAkçÅ-WR9oÛõ½/FrxmGÀ·fbuäà§0[Ç×õ¤yø
áÜÓð÷xx;Ý.HèÝPHdSf
 @ô;;Tò	ýÆìç+ÿàï²Ï<Ý¤qÓú¡¯qú5êÓçÒ)©cmÒÅÆ¿6Ù
QfÊìö§Ø 0#»¤RÈÛ¥f{ßÛDÒOO°HÎiÙè«®OU¨1L¿ïZNê¸{O²	ú+.v¦í#Bøü"òÀSá°AÍ°çËÂØBk×VwÚÅ¸óÿ¥<L8êËÁ?Ý÷e[±´iòID]CZq±wYÿ>m">þ.ü6ÿýÛoíH+À¥PUõ£/,ü¸Zó7 ÑÜç.
ÚªFRr¶à@$ÖEæ¤:8fyÏ`ÍZñAÃ«þýäü¬ÿÇc±LÆ3}&Ð
ó&Éì¡ï1ëÚgªDÇ+O©cÕ8rB²ÍÄû«Zðq7ïc
V6Sª¸Ð¹ìs	¨Wö¸1buz¤-Ô¥¡F±ksqÞsÅ²Þj°LíG'ÅÒL'ºMõ ×±¤û`|H¦ñ:¢
Ùþm3ÐõòQ÷³Å\X?>ÅÆªÈyÆxÛ­SË^oÒÁå(þqÚ¦F-õB]Lmó$Y¶­R&l^|´ÏPå¿y¯ÿýÊ¹JÖÉl	Z¥¯¥ÿ£1@ü4ð·K·©¤>2´¼CcêàÂÚpª3@"Iz%Y3ºÄª6`²Ö¹Ø~U=íEäÞJß8!I÷Ç¹N`ÕÕéþ¨*¦ÀÖ]½{ÄÙ6dF¦§îÛøJ
-~NÌ·è9=`/=Ìãþâî*¶Ôæpfuyï4áÙÌÁâü­yQ»åaLöËï9Ýïï¸Ý®'a'°o}BW »~òDÉX¼j$!Ãï2>¸	3õöZ}Q-?tWÔ³ÏuÅ4üEP¿: ëYrÓíK3E£zÐ¼Ù)m¦L=Ï5!«@<¨sË9Ro ÉÐÀÚ±³Xö©øyk$ÖäÔ¶ZPÿõ
£*Tü=Èw4CÆIsJp2DfýÞ&4v£/2õo;þßáô4úÿcu=yÎªY»ã¢.ËÎî½ýM¤~!
I¬^õ¦AÅúÞ
Ý­==¦öÐ ¥~¿ylp£Î)(Dj4|õë;´²aÆ­Æm9lDþùÿxæóûc]õ5ª®ìw¼~¾6½·uy°fÉ£Á l«¸Åv)7`&Y=¸áj²~9ú7Eô÷Ù8z,pÐåçe¶+*»w#'bîÃµB+Ëdbû9J¿Þj=û5üöfÄñyöë)¸
*åWúÕ»¹æIÃ
ØÑ¨%hÌ41þ¡íù#@àWfµ¿ÿûdUÿúP £+hü=Ï¯íÃhùÓÉÝO2lùð<+ØwÂD¥ãBzè£§±d§ûB
Ë·Xú fp)p3ÙK¤J?20ö{ß?°v¬Á!'MûI¥4èUBk´ÖPhî¯Çá=ÐÛXbêïô#îs¼V
9³§Ê©`M¤~.R¨ìÆóØÄ5±é¶5T®7H`óÖåý¦$?+ª,ùÊ÷Òç#wä0±wríRö ú©d[8ê¥-G ¯Õò^ÜÿU2g¨àucü'1îó¿|ÓÿúèN%°öº>öqvã¼	&§cá.Äöp¬3oqØò5	÷~ýö{«Zÿý´¿µ²¯úª_
ð£u|üzõáòQê»io<ÄÞÄIõåÆ;Ú,Xå¢Ñ^;·z[}iñh3Í,*8¤çê0ùx^ÐvïPÄsä£)cÝµÉÈÜ§	©'kæn6¼Þ¾_Á§£|øe.-9bi1Ë~ßãó7ÚfÙÕÈhôòJC¡&:È(5¬Dj0Âº$#Pºktx]ºfå@'oÎ9`ÿö:­\{Ör7gXÙÅg8=ÈÞ/U³QAU_Ów÷SèGXÒ}Ò9«QÕ0§{JîÎió=~ðÀiS»zý^#<.]Î^É<MÏÛì^;b$u¼À0M²®kUóÌ3bx¤¯SVrG¿
D`ªùg¡kÄq=SãÐKþø[¸Íø\Eÿ\MÐo(*#tbÅ´ £^ß?¬ÚöìB:g«arÜ6ÿb[JI$
¿Ö¤ù£>ülâ"Í(!'¼?#0|ìanFz/eZs±÷S%6fÉw_Ð-¢2b
|åÍÛÝ¦IªFFE3Nl?¶ù'¤'ò736ägO=!Li/\ÐlÇr9­¢N¥<pËÕëp%ÉoUUÆuÜì-)Å¾åÃüì¾áa[sA¢:v®ø¦ºÝLLFZºà]½ÑÊ£Ò±ü¯Át×k¯&ÀptÔ$D½·)ÕÏð"~4¥)yH±oË½
½À^|wµDiÙußn,)÷ø»ÊU5§oUÍnúÜi{ ó}cz~EãE&#æl0¼	,z4JS°Aù­mú²>- îÔ\kÌÜè-ÙÆÒBxÉ"m½¶l°AI£I¤ü.ámÌ½J¢¡ö)ÝÁº*ÙýâúÔ"osør÷JïDí|a-|w··#íÓÉXÈ|KÏè,l7´@¦úióÔÚ¤»N@C»\;_&ÍÜS 'xæH&ÙZ+443¥OT'ôIüùò;Æ~lÀô-â`8.s×V3n8÷ñÄaºKÂæ0j <utµèHaJf-ÙuÓ>%ÜF,§ÔùAÉ|fnZ·êz3@/tÀ÷çÜ_g»uÚE]@|Xi±	¬Ò·Å³ãG9]Íõdô@»*µ¹Þ*SNL÷Ïüþî?ÀéEâ±,ôð¶&Û[[¥¿¸z@¶À6{?Ý
ìÈEÌDìv× òqnÿý½ÚBCöÀ¦évü6£N¸ü.»*ôÿL­+æéùïÙQXdÁqö½mNðëýu=ÄûÔøbÊ÷Õº+ÄSÑµØog`èÊ¢%U$ÍóQ¼5{Ö­·Ä?1¾¡M÷§«øó½þ9Ãû¬¼¡UsÃó¿ÌwUÂy¯5kÛrÚúË_`=ßtd*ê94Ëÿ;DkjGHwk5Ô§RNçí1½'ÇfÄGLùË¿tÒd>ðªW0:
Î(EµËý·K¶WÅv2rcéÉ.uC<pÁaOßöS/'dy!u&YÞ©ª5kÎß¬KðåPÍþPg£ÿ(}	
G
%uÔg
È|\·æYPëráY{'f·WmnKvnÕKféV%[£\ÌüåhÙe]¡ÀwVG½«ËéàöH}âÑ2¬tÇXnÎ;&I2ÝMóÄÙ´6d³q|ËZjn½fE"±}þ¯G®öLëÖ\Goá\ÉCÔ7kÎýrÿ"D¥h"wÊ¬ösAO¤='ÞàFSýL6!Ïg5Ô»ø	q¸H¢b	äQg<øk|Ó´âìcµqE>:;K¹ÕS¹æô±ÄC(â»ÀÃØK<Ír¨y½35·³ÝóªíÚÁ>tg-'æ"Ì@ìgëéÕc°á÷	C¿VâºêôÆ¨üü4!)jí(À?:Ó$øâä;ô~@ÄF®äÏûÀ½M4¹^½¯ôiÜC1¶Õº@mü¤J¥ý´
Hûà£`àüåW(ámT¦¡À$ j¸	¯Ño"wöm©5½9öUTFPY#¤ut]Ñ`¢õvtMk|U½ÚæÝéêJñÔÔkQ3Õ4gEnyÏÅÄ)Î`X½:óÿáé\çAË
¦Å1óïÌô¬Pv¸9± Vä3~*	ZÿÁ¾ïÅ/äS_×6ÚÂ5èè_©Îwrõéûn¢3KÒ¢¸Ö¡¼·TAÀÜ.µ¾S$ËIÛÜ-vämèZªÊ_òy¿¯Úz[åa
ãªêpR»·}½A8GÿU2±{+G(ý1QÖ#Ð:Sº6=?DZÔ|
Ñí©~¦Ð×®ÕÂ-5_ÜÕÜHÁvÂçP§pÿ|¨Uã)Æ]ûê5/2I i?þ µxdUûç£NôüåhÙdO$óÖìÅá¿%ýíJªþ¿p b¤6¨çº¤Àó.új+ñsSúxßãÏÙ[×eyº(V±Õl(HÁI'XÇlÊE,µ·²ÌöÈ? Y5ÝÛ\?Àe¯!i¼gH²ÕKÇÛ\¢y­CVÝ@ÑS£ö«s/ Ä«CW­Ç\OÈ27æ²j Ø@o±3~×Á{ïs¯ÖÜ:gÌ
}¼¤Øä}£RmO-ÀWµÍÆ¶H%àÅíÔ4L¼yywx$µõm'Oâ=ÉØóÛU8¬oë~¶ÊµjÙtm×ØÝoÃd:FäñõûïK5Å£òw`¥^÷ëfÙXq]RN7t)`>S6BßÕ~²°~êDA#ç£EüÐn
Hîf`[Qoå}»@§ÃAÖ .gÑ·í_?l|¡Ñ'b×/óNüí¥ëÒr
?fèô³¼+s[íîTÔììêëÙOÆürÝIFÑÈ*Qü2ýÁ}83üé	¥@K¦pÔ)ë\ºÉËàwT©6#èQ1<ão1¥àÍ¶'í¯nuCç;GÏkU0Ã3ÏÌ
xø®5Î<ÚBðSÝ?Ó'\Ã"
¾¤G{7]­76æ^§~®Z6±²gú4¼ErÝêùç µ4ª_ÚÄËC=â<Ü¯6?l¡¶f;g2Aî<	ãn/y	&KËÚMØ	PÙ®hPX¦½k·½=ZAÞ«5Õñ¿ç 6àKºÝþMÕºTÀýõ£EüÐøLýÀÒF9¦âBüJdü[6u+¹csâÝ} ì¾¡Z°Ñ±§ôr3ACÇaÄÌ~(Öí"ÇºïqóoÃRU_ú¯¸Ê°àëæÇp,·©·vî)4¹0wÖÄä³%@ù>}±ãY^B®V#Ï{ôµQ°PvÈ¿Áµ>7kÐ'àp+æ
æwq}¢
]ÙÓ^=gâ-(ù¬£s<Z¥tùkzGoH·ÛõW_ÍÈëBÏG^ä7þ]cÁ±ÁRª4/'ÃÕ Çv$ØÑD<¹9Õ°tCÙÈ{VäÃCjý«kòZ«2Ê¼_`¾úGvéqi£?Ø±¾\6Jî1l#sTûîÂÀUî&Ð6þÐY6ú´þw£E0üÐØÖùÂKl[2sC©Fû
ST>O¥&7o½M/æE<ÍdÃÏ'÷ðcxrÆÒà½|YòÄÒXQ[Ð×²ía«¥\=~ãwÈf¶ÓÖ	Í÷Dw½sîQ}«È´ßV|Én ¶Ít~ïÌd¶AÍÐ£á@8Pèü´~à6Áá%¥mLÀ5§gÊZ[?°¬%5$;*Fld°©c£Eåø¯C¸CÒ15¯óº¿&5PÄc±iÔ£8]ùØ?+ªö||4\z*çá©Ú$jäáÏýi$ÓòfÎ
ÅmG@ãH"ÓþFPórKÙ$7_Pd8i±Ó²ùî÷ø%ûm°6m/Õd$=Ûdªz£EDüÐDF/öO=´åìÈjàºìålî=Ói»ÍK­%¿yçÐ¦ÿVÓèÞ¡{tD2@à¶nó~5sBËs¬¦!*¬ykºzS½Ï9]x´g÷^Jþ°^	H}ªáðF$ÆnQTrÙÇO²íòÊ¿8u«ãÛÝ_Àÿÿÿ¿|ýqåÍèñö zß5AÇ%$¶¶$Ç_¦¶Bù#À/üDfu`âÚÄ½Q¨¡?±¥¤HR)í^G[Z¬¹íuª¸©è[Oe!~@}£Ð3j¿ïÓK5MÇ§]ax¾ïÏµ¾/ôì¿!Gî#52sw{ï¦Â/ªÀ*DAßýÖÒ¶Ð-Õõ Ú@=ú£EXüÐ±Øû`ætya@¥5 å]ó­/Ka·«õÅ¸c¥\|ÚN¦È½ûXãX%êJC¹¨¾êßC¢uÜB°<åòk­¯kOé×£Ä³»ëU§¸n¬ló6©ç¦:S»'ÁqÀ¼ÔTmÍêAbL¡¤Cî?â0$ªÃ<Ì0ûÉhSÎû.b3©Xx*Y=BÜ?'ÍL)e»UuZeÃ;ûÝ 3Ðûïs£S¹Ê0cxWïµ2ù­h¸>O$ÉÕÈmÆÐ· $ê#ÿW´HÁ¶É4»¾ÉÜ
¾à'Fñé]Üß_ÏwweÚ-yRý¶Éµ%Uª¯Àµý£ElüÐØÓEÊËUc¡+_¡£wÇ½÷Uõßì4iC_tgl8
ßqn¨4®^î®Ñ$ooy®î#9`Áe4AK¹µñôpò8è#,±FÉ»ÀÖ²,ÕüDkr³,Fï|¤-ÄlV`S´f,g=2XBì_ÛÔ;sÌw1õ©ÀS¤J^ÊÌy®mÀ443<ü<¤¢±á6*=ü1-5$ió ÷9ÖKPfB1¦1lÿDÐªèËRriX¼ö*Þ¯´¯æÙÒ[©úÜÊýútæt%
"ç ìv1¡Ç_AY_ò`ÛÓ6õô	y/jáº}ûªÃèóO?.Jµ"DBIm¶Û·ê¼kû@ü£Eü
ñEJ¦­ík«ò¼ùù)	L¯=ÈÎrpX0ù!´zÓÊXës­Õ#àÜrjàu[B© Á$!¢§öÍBk2ÕÊyç6uÝä#2tPpHý£íæ¶ù!exM½Öx´îéÅbüõM9ì:ûª¬4âß¤_	÷×þàªÎ'ØÃÌ3Ìë½.î_G]C
¤òçÞÿ«OðîPèÌ9öS¶Pné©ÂNùD.õû®
¿ÇÑØgCoa4õMä äÊùéäÂ0#ç!·WxÙV5¼J7ÂCC|yàî
»jôáÜOPUz¿¾á/o¿>0½Rþù.ÝÉÛi-JÐúª£>âv£EüÐLáÖj7_w$0í²_á¯¸%$ïõ0K¿àù]Ø¢Â"ÇO M	.ês§Uçy.fÐ'ûÙ½(ìLlòµE/	Æ(8G`ïâÇÀ¡
ÿMÃ[%îPk8ÌÖ-Mr>Â¼Ä2¨Ò·%# lhPã
ëò?SFHÎ
å´N½ u3ÌÀÌüa[ÊØýªo{Acý½pá¹FuÂË×DêD©ôcé}z£º¹îXb¡5+Í²ÛøÏÕ	ÜNëPbæÕ!cdtRâ{¯¿^R0ÇêX·%¶O$åc~å£´Xé(-¸!û)ÜK×B#
 r^
NÖG .äü
ð=jªó&µú£E¨üÐsUPlUÞI¨MÑ3Ç²"P/ªÅoM::·W§'êö×±æÇ/ôûiÛNè}ÝûÞSþ<âÃw@¾\è:©+lÇóuÈ2ÅñìµU4ñsûºÛ³ G$7Èla¡§9f­V¢ÞuhbK6¯u±hÒÜyoÒ=ì4}Ð<0ÌÃ)^j×'bµ®A·+Ôx;ÆçzÇW!aVµ=k(HÇÛ-÷÷¸¬ÖA4Æ®ÅíÚîd®ãkð¶çßØjã(ÇEA¿FË­Ç¥·/B´&Ü?~´B÷ßìLßáEä/7²Ã0ïwÿeÍãÃ'à Ì­²¶«Ïd¶Ð	
úPZÛð¶ü£E¼üÐö.ìÍã-7ÎÑ\UÉ÷
2~?®1Ü¼EWÞ`$v´úIõÎd·»R\°Èoì)ÅèGïäU<e= Ö
=×¹Ñ ¤
ê¸XÙJ ì;o~9~#*¦Oé7ª¤à Nðg¬]û´¿R@æ}CD;+ul$'ýôt(m^À.Õ3ÀÌüó¸Æã
+Xª=J¢ 7³=¿j]Úá°`zP"#:¦{7÷nÌ°
¤Fj£YÝl
/EûgÆ¬ ÓèÄ_Â+óâ²\N,ÇQºç+YÑÂYC¹<Î,¢_?6Jùg_éÎ¿§S¢/«­pÏ%],å×E=¯\ d³$nFÒJßÿ%iBFíz£EÐüÏþÁÑ	Û}?ùù÷¨°ë2,°wêa?^e8ú^%ÌfÆRê2õÝ×@/®<8" ó3
lèiñLW5P{ËÈÁ[¹Ê¡º¥£UÁ1ßom6üå5N@ê·ñ5gÉ*õBé|¿sÿÈ±ÂBµ01}µy=\úÞ4Åa4oå¼×L*×¿«eeÆ?º24!¤ööÙ]<0ÀÀ=3Ê¬qT<¸LÝc7åTËêç]¼\Û«¬:ÒRíÐÎ7kçýyXÆªnðÖ0HÙ"ÇkÁ2Êè¼ÒÞß§Þ½z8+s¾Í©'ÔÍ±
=âÏ_ª:¼¾ÛI)Ú`Oe½Pùu4¥ðíº¿L~½É»Kð¶ÒTUkó?Úz£EäüêI¢WZwÌ]®¡Ké:ßyÂÃìq¬)¿ëµ õNæ¥ÜË¥ÂI(>ôåÁ¾]â´¾ÌçëuÊÓJÍØ¾#K¬+êÒÑfà8Ã¾v<¡8köáEÓLXµª§îÎqËÛ&ÑÂËÞÜ71'M,%t×KL`(¿Ç!eaR<ã¼ÀÀÏÏ~6?wJ`:T,¢¾-_ÒÁÉi2ùI¼óI×R\ìQjÈS!WêÆ~ZéÔÖCr^)JÀÇ:þ¾ù_:Q³ýñsËs'jãäÃ¥(.ØlI´ó¾3fË3dÁoÍÃìK´î3&Äª¨*ÿíjûþ£EøüSL£Í¹ñç2@±°-]A(
Áÿëa¡M>^¨sKôê®jTÈo¶yÞ'¯AÑ³¦·apûcC×Qð_K|úu	üìõZã¢´QéiC60áø÷ò\x-;ùÇÂñ-HÞü«g5Wd$å<j«AÀÅdÁÚÔÅ×TQ=}b+¸F$ÏóóÈÕY;µed,Êh¦ÈYì©xÁîó¶vT'Õø]Òû3q§µshéuáß²ÉO3îï+ld(ÔC¥tkñNÃ+é(½-G!Ð-xÝí²k$Um*ôñckÿ%¾V¶S<¤ÖÛTq«1hF\ÐÁA7a äÆî±÷Jß2¾u+vý´­`Uª°£;üýg¨ÔWéu¤(ÖÀgÙèe6qÕBÓ&öüyæi}à4\ÝÊ`{BiFôJµ34SI¼+×¥eñ ÊñÅÉÿt2DNý­ÛÙkÎ¯xÇÖZÛ´´vâüx
r"à¼c¯ô6 à©ûv"xBã2/Fjµ ¸3ã G(
·,Ù"s½¤kºI	29få "IÆV¤©_é§zí·úmK&
Å¿J®zÿ6`WÇyÒ´¦ôkÏ.¹³Ã
`¢t<¤¡5aq£=.É~bü áqoðÊµÛ³h"òe0TêUúËòlY9IìhS5`§'
ýU+¯+àØÈ­ÌobJÕÉöÀò£  ü[_»ùP.m7-¿/µI5ÞkRñ2Wé#U5¼fîÉº#rí¯PÎôÎ£3>ã1iþ³;
PûiH[%Ï³¨R Ö"é»[¹Ãz;±H"Ã nRIGª\K¥vº¦vþ19CN§\þ»N	è¥r»´bâfg`aÙ\$«_`9ÁÌýíë¼Òü#Z_¢ÕVì£Æ<ÃoBª/Ii¼Ù´¨ZÔÀÐIN¸ìaaHÙÄÄ×þ5h,ÖèÐêgiVO$<Ý|õùºÕtGÿn^]±Ý¬wlBIpÎ8	uVUR'3<îÑ]nbµ×Éâ{/ÿé J¶£t4ü0Bcÿ»ñáRB±
Î(ÝööÒxcõëõK¡ WwcÚÃðN}J5Ç|ËÝ\ù®%ZÎ~~uòñt[zõ~%PÝðÚ³cDÅ|_2ãæ/ùÒ£~¿I®<·[õ£&çf´d¢}û| öìªñS&dÆ1Á÷(7ÀY|»¡ÄÌ`=²ÿá ½FCw¼0ÖÅs{¹EèbFP+åêNâÓ?Ré ñÝïC'À\&àÆæ,ò¶Cæf°Uç÷X>SrvÑåWeÏõU'ó9t¥BUn»Rò­VÆà ÆåÏ¶ÿKE©yîú¿ØW0qdô`dt
L(Û¥­doãÖÊQ·¥ÞÁCFÙÖê1:Ñ³Û+F|g¹uÅUëNÈ}@DÞ(æDl¡B'¨Y£ä0¤JÝ¤¯Ûý¿Ãb[£EHü}bÜæÜFZµ½åKÇÛ5wa%]w
ãè$hÍ¬Wã_ãtZ¾)Ú5¼÷½~ç@ì¨±
ÖýËIÐ?lT#Oÿ5ü1/w¥³Bl#ò'#'ó{ Z(+Úa³¬HX5Í"B9y;R@0Ç§*ÚÜKü
wV
Ä9I_¢5ùõÑ	ÒiÊòçj=ëMÀó0ú·ðû¼5þk¤mÀ×íhµ,úøIÌýü;B@¬)Xõÿ«#
UàPÛ=t²\øÖu©Þ¸er?¢`¦òãâ­M^@¯-~¤¶<êÌéµÃrÌùkÄÂ%<¬#·I)¤òÛtº­äöÖõ.É3ÛÒm|¥»nJ£E\üæMFÅÂ1¾Eês%^ú°Z(îMð-öÁMyì^Ç:õòQ^$Ä+·²½?¥û¼ÿZS.Pöóò´j[îÝë¶4
~ãL;ÃÊdác{·8	Þ{NFeê@Ã7öy;Û"7bTØÐ%ñÅÕø-7³tá 1æý"Ûo[ÎÍ:¢ dûFÊãì<HpÂP;RãOØ·y°qg`½ZêJÄÉIé*å.Ö²«#âÖÇSÛèwº½Ó¹¦Yp¢Ú6N:#ô34ó$.jZãGr{Àw.n©|¦þª"[óéÜöc¨lJ©`¦t­ÜçÖ¢Å 6RÊâyþÏý! »²"MÉ±?ìÿõ@BÞ£EpüÑéZöÒ!§Ê·µÿ¾ÝÊÊ§Ïç#µ/,_~[¼07yJwù/¸mÃöqzè²ªa*LT*NMÑ
ÏtDf»Ä÷iëùmØ´r÷¡ÌÝ8m%%rÍ³&½¨òî[QSÐØGÀËRDÁ1Íò·Û\U9P?YÎÑI¦pªµ±¸#»GºT«3ü'*úèÇ5£ô±`Èe,Þ)xöäÌö·SYõb0U¤]EFi6Õ*°xA.)øÓ!¬y´èø¹ÿ@Vlæ0àÓ¨±«M3>S.Áî¹¹2ZþÆØeÏ%Ô,¢tÁ`ÿêÍÑÉÕÂxOZÒæbQ$A:åê®È¶Î²baÙ¸
ù¨hTÌµ&ÛI&É¥Jßú3c?ýó£EüÐDGR½Ä}z^uxEp¥ëàñµêKº?\U&+ Tð¿ìÚ¬Rß~Ó/×£[¿Tiø$Ê(v«8k D¨§í*ÑT"¼Û	ÆV¯6ÈþwMg4ÁÅ+R~NDÄM2%BZHOkao yçµ¥µçÇØÞ>³_2`7f<j`[DÊþRèÒ`0ðVlÌüïÑ8,ñöß8í¯]ôØ¶I'èÐ4¡WÙ7ClÅÞsm
·£T¿ÃC±Ç¤ÿ¼mbôXÕóaô¿~'ð¢¬èùT£¬Å.SGAÖ©@í?3Éé%XwøÑ^Øà±ò#Îÿé-f¹ùÍC+p¯:d«©÷OñÈß@?Ém°´äl=j®ÉIô£Eüö®ïì%ÁÎ}Le
N?¸{­ü§wôÜÖnµþoÂYlNzKfÄ²ÒO6 <Ìõ@´5qí×|GK'É¤æ³Àib&(HÿË1²jÆxa?0ÛïV¶©	óäÝFäX ¿µâUÎrá7j«ÿ3(âñiàúÃïa»{qó ÌÃÏÌ<ú0ñ¡ü*6#¾él¹çËNù)»à¨>÷q)!3ï»]ø-³«v²¹(
n1ñäBïè§åÑåzü62ÅPe5µ¦g­ßÄg2tKhs?4tººz%ÛÔ%~
ÂHzf(æÚ]¨¹1®"`×ÒþÀVÊ´I-Á£E¬ü¸Ædä:ô×621ÔöR!þÙc,xÜâ±n¨ÌN2iý99Í)­(ür©h_¤°Î*Ü?GVÈ9J«é7{Z £­àå@üÐ&":¢0µzXAÝ¸Ls}_zz×Z´ÑCÏ]¡¶§CþwöàGâþ­¡ã^ÌWÖ'ßJÚJ~-H*MR(Sµ¢æ¦î½ÆÓALeRqúPÜ!"¤É¼F±xu9f
5¬¼,ÚÍ¸-eå}gNluæ°~võ·ä[-¸n6¥°±}KÈiß ey.\©À¦Zì§ñLûWç~ÄèÈ~ÛöTL¡\áûEÑÃn`½lE­j.vÚµFrm±-üÈRÝA£EÀü¾ðnZH/Y¶A~[óM6ã=ÖÅ¦òÁÀK9M·AG!nIàEaBîÀPÔ`I7!2k.aÄzbNm²Y<S{aÁKäöÒóÏðTñÌøoK/¿yíyþ(¬#nÉÈjÎTY°q|·#õÒsL²÷²@hGÀì¡`Ú=Ðëbx/¦¨ (yÞócÆûídªq¢ÎJãL<·Dï_4AÕ«<q(ßVàºr)¦qthÈuÏ· ó¤Ufñ|áÒ%2º n
#ì¸?)üÕÛ½¨85å¶qïÄ¿A²²¤ÁÑæu¯fgbwlFúâ±Lò ÷³¥ÍÐN<Úµc³]DÚVÉþÛIù4ö £EÔüAãý¡Ò#½iþsaÙ<kPRaLZrpyVEÈúP?ªEÛRL5UNsÃÔ\13Y7ØùTúÁ¿·Ô»~¶_[zÒ
ß¼nR>"õ2A»¨4,5X^ü/íB©é,fn²L0
QÚ [lí«îÕo¥R¿x
eJÂk¶ñÿB	à3Îóýà`IÖ·@{Ãf ã@âÁ)È[ó\´y¨Þ ³ù&ó(|9
½Í"&o%uD¢Vvgí	5ÌW
ãÛ9´F7Ö·}Ä¢Ùï±$Xe¹^à½7÷ïèîÎ^E+ìÁ/b'*¦\DëkzZúTY1ÖÚçÅÂÝä@@«;!Ø`APJI6'öÂvC¶uÿÿÿÿÿÿÿçÖ£EüoÿÀ­þ0ûC^Ñøó1ÖHú£
'p&:¯F}!&RS¹,'AÇ°zô"¡zÛ:|ïïùæKÈ 4Í¹eÕÕ{ß,ë@gÑ0à\ÔFº$XÂû»º6Ê°f¯a@eWcêÉK2]QÈ4»£÷õ·ÛÑ;Ú½gNÈûÑßÕS1C'ÊÙúuc¸'Ò­c'çÝSD÷gEw(Â3f\iÀJÅìÍZ¡ÔtlLÅm'dÁ:<
¦/#
X,Gå¤Ýà¸VÛöühÔfú°~Vá«®	äF_§Ó%(Nñ2&a*·hE£!A
{ë³©BÕæÑxi£¥pÂZ{^ÉùhO5ÚÆàØÿô¶Ømú_õÿÿ£Eü~µßå(ZàISqúã­·»¼ârö5ÎíK­c,
ö))grètJ´îúÿ¯»½ÅÏ±tÅÂý¿ëÊ|e+ë£85Áª2u'þ:äáÆÀ=/m´]ê:V^³­Ò¯u ÄÎÀsSp5
þK\ùù
A
öójw":p­-.Å?vêûOÎ¡ü±2ÄÔhñßíU­ÔoxèvîâÙÇD³Û?V¤ÿÄ;ÎÌ2Áñà=ß<ýÆÄ Í_¬U×"ÞÊ¯Ü¶é¼!iä¶·0ÈzýPÕ5+
52ºÒ®ùi'H;êBY.ÿð5ºóüßd¹Ù´)·Óëã9ÆÞYq8úFîøÚîüäÙ%ðÿþ«j£E(üåiwÙ´C{=¡h@Ä2FTeM£ô»Ím`ðâÛ°ÖÞxÕwÃXDÅKË2%õøskÒ.W
xÞáJ ÑLDzæbc`÷`>×2Ú³ßé×W
Y¾>9\'ËpE§ÂôF½G%Þû{gÙéKÍäø,CÚàãk["FêËOXz\Dª£`ÈÒ Q¬úJÔ/;î±1eãhûåÞqÿyO©©f
Zßo	tW ½Ñ^c¥dÌ
QËàA?û1Xq{`*	íÓ[¦r¥"Ëñ´îíÏïï#¨ý¾±\ZõAwÿ/Rs%í*Àà­¦ÖÄãíûùo^:¼÷3>èÈx+5¡äúe^R¼(fWRlÝ¤·ü
þªþ¦£E<üåVÒâøìçnùÐ/»ÄÿF/ÜêK1ÀÉ	bxÕÎ£
¬L¯Ì®
ù¤ÆÉ¦¾¡(Ì§«ÞðÑV²éÔS&;&3W.>nçPGÆ?KÈô^,ëG?#j§c±Ó­,`ùé
½dÊD¹	A§uþÆÔºàjo¸
Yû7¯¥ÓX¦QØÜi]ÒürV°sçM©ÓGÝ>½w¦õ ÀÃü>ë_sè[Ðé¾ä«éø¶p^:ùâ
µµÇÚ 'ð1º7ßáÅítÇS·]µÒ®qwöÏñÊ¿Á(	¨²³ZÇÐUõ¿àËÌý
ÜÏßÝÿÕþ¾ªX¯þÐ Îå!¯¼æúÍ<òVP$7>Ó#Üìnjä¥¢°Ûù ¤µZØM¥£EPüê7}¾ìJ4ÕÓÓüÅã
 Ï.W´·kH:át h,'ò
Ýl¯êlÇøÌµª»÷Qnsãýbg1þ¿ÈÊ1õYºÐøÛ²AäZãÀlÂ´@ÒXì0@4°ìô¨à§î$É¾í
Õ¦pA"I«è®3|`õ\^puyaó8ðí
¿s24,%Ò[õòI=?nt3Õ`Ý¶YÀ°målçÀéÔ*w:RÚÜ!±`LPëOL¹¬'þÁ@^"4¢UÂ$·®<Y$ºcyÁ	üï(Î/ò5áR+0 @yâ& þªejòDþý%À'P,ÊäÊj:=!HÈ4÷¶éÿÇ/Z91Ö¥zöÂhk_Oííkr/ýx-«k¤£Edüv¤½îÒÃ-Üv :×#N®îÊ<eû?¼ZRÈY¶6n
.KÎ1ÀºB§å¹4ÏHúóãÔjd.ë"ø3BßCV¿ã1^t¯Û«m¤yF0us+Q¨ªO.ã±Ñ¶¡Ç úùÄG£À[cû¶oØdí-/Í)H"]Ô\uÓ>ñ~ã¸`ÎY­Âsç[Ïä+8òÏÚ¶»Ç#{ù"`w)\e_:J=Í£9r§Àk,cvZHÛrü#Ü²áÅü îíhTñ Nü:ÔôêN!Â «ÄÏ.|ºÎégÎìæ¶ýõÖ25V¶%¿Ê+59K{!ùlé6ØÎ°|èÍ32ã²ù<´ hóM©.ëe"H
¥ÛüZ£.xüAFìQ­$sÌ
Ç½ÏlwÔ:µ`ÁRlã³ý7Gç}Pòæ°ÄÌñ_*ÆÒ$ÃÇz;ébb$Î:ô5ùÔ,ë´¦¼ún2sªµö4ÂFÝ÷úºg 4<ã /a=ëàÒ2sâàSÊã§¤?¹¸)"¾%}6õSÊe¤¥¢¥ððx&ÓòµF«Þy	:å}?löÃ7u¹å6e,<(w°úõGi%P/ ÅéßAÆíÌ5RkEL×ÚöPÀ,	·½õMAµzsÔUVÑLG&<ºÒý³Û»²XDßO×Îö©Ej:1òUifÒðúÐÚSg?Ù½ÿfÉZÿð
Pÿ£-ü¸MÕPC0m§Y0Ò@Ü±m¢zgÞüé'ûYh)5RP¹k_`õD$
pãC; l°2ª" \ °.êº~¨·n'kåÍÍhe}nîs{ê·-sB77
øóÎò£«0ób`EÌS:Û^ `=áZÙu»WñÀú4&®0+Ks½ü'ËÌàÝ·»åjEÀß1Óî
¿mQc
)ýppRïk³Uü_CVúm*.qAh·AsôÛ­t²¬2(øànst@EíãÜ§±üXõú÷#¤ÌØâ:áÇëO
­ºgaÇÂÂ"¯»9DâÙ°6H?Uú¯
ª¥£+ ü¾pÓtøÀÑ7Ýµ	cùËRuéð¹uÅâ¶×!vÅ«,Ë³p®x²
©£8Ä±}G¹õôgâ76Õ¸¹û|ohp829/´²KÓEÈÜ\²hMBÅ1ÍKqe)ÈbKnP,ö§÷ù!ý´ÿöä'*¨±²S7-ºrì
X¹ºzÍ@ùFOsáGV¶ÐÝßYãeññ[Lj×¹ïlH5WÍ·2ð.ðá>ÁHZYõx_Í)=iÔR4Ì4MÛ©=:°ÄÑ|²ystÊ³7!¥,S«sQÁ)ëùîXá­K;òÞl6Ð"B(ÛâmZFMCïÍÃì?m½@¯õÿÿ£0´ü-Y$e'}ùOàR³+RàôpÙîê
­qjµÔ -]rü+ü¹{XÎgdÖë\mézÏ;ÿæT»é
ïMè.«Ä)øå9Ý#tDBÖW,1±?*Ây_ÏÕÍ'q+ÙU·¤W¢í.\«íáÃ-ì
*þÜ}:@b9×Á û¬´ø7Üá<?tÀ¥ÝÒÏÅ\ÐY\©pwí¯³d¼ê}EMÒ2Ø!â3ªÝÁá»Zß°£	³å«>ÉÝ)Â6Êïtø6°?}N7:YyÓáX\È)òÞ$[Hßþs¶Ñ,ûAR'¬âð¼h=	¬¥ê×ÔíÝ'ù	JÔ¤õUU¥£6Èü¸N¸ÛLòÁ1¨¶ê£-Í¶}ÞymG<RVÒÂoïR(=É743?DµVªýQH¨°ø7É5IaQYÁ<÷±¨t³+ÌônÇðkÛÔ]Ð|oNÍ4pÒF®¦ÞWçh
n¾5~RuÃoGNÂO,üJuÞPå¡,ÕÈyAÁY«U»¶âià7a30(Á«!wG¤UÉÈå	Æc_´yl%:² îUÔð©ç°ÞJÅT
Qª|ÚçTPY0[Ë¼×	D,.	¬À¶½©TÎx°ÁåîXÚ¥4áÔDÊ]-ìYhËýÄP'ãç³éû61 ÝI+@þÔúPªZ Z£Üü{ýÖ¤¸tÝEi1F%)_çzåyùo§T¬dÛUÓe>õ=uÙSÝÃÙb­Ø+sß
bÔ}/GÈ>çÒ¯©
ÎÙ¸k¥	=\*è%Í­ÞhpÎ«öB¯àuØl¼áD(Üs
7HêBÏ>ê+´¬AEUØÛ±ä
<Ñü³4ÈðZ©Ááìwá5¢QÙ·¾­zÍÿ?1r.GõA8L8DqNË°}pv7å¯²ú¢ §ßzÞ×nÙò:$K§!ÙÚ¾ü
=Xý3xìÓÞFaÿ	@i?MYgý(Ô´5 !CDÓ²\ÀÜTx@ý
÷æ#°;³·ÕÈÆ Ký4Ø:	õÝþ¥gFÃÞhÿwÿ>;ñ¹,å
%ÉË¡eÓ3 X
©A+Zßu2<?{ã 56äí~û7R^þ-[¸±3X	JÖö$vIµ$Ù £JðühÞA7!eBåd¯3Ådre¢¡¤b×êYÛWAN÷)ð? jõw-TL{Ô
3s[uLcà6 NH±wÅ­Ñ@>ýþÎÿhJÙ³[´UùIÝþoª~ç2ãóa²û,Z B:S',»¸·©ú½8_ô4<d$LLh±÷£ý×Ç¾¢^I( ém4·.íPøþx=¨¡-,Úì(JJ¯/³c~Ö@CÉ ðö-âz(Ó3çJ"Y±,ô±Û£ù6 ÅCÂÞÜLkµ;»´YÀYÅhßìÙuïPñ­â¢´Cìúô£¶]º6hÒ{.ËîJN4a35+pÈ«Ï":pF<®¦`¼ÌIfÛØZ_·ð£oüzó·p³É`bA${­Ø#¶R3Åm'ýÛ×¶ZÜt«÷YÓññÂ«S §»³w"YquYÃY§ëøÌ¬Ybß_Â-ã{gß.s59 hh|¼!OIT rÎ¹ÖâÞ}$®ï¶'9Nänëf·ðî°\cÐvü´beÇ`R|ÇbÕA¢%,È9 ¦iÙwÿDq«tRwÀ¢ÐgL
TlÏ«­~¸}£E;8¸«<¸îWÔÒÃ`uÿ8Ràïfd-ûÀµE§!'í\à¤Ù&©øñcÀáË&ê
>;ÿP³HîÝ >%õI& )0¯cC>*Ö^æÿ'%I±ãúðÞÁÇª?yºØghFÿÈÅ1­Pï@¥G¢ËØÁ>©ì"èRõ
UÕlô2;Ijª¤m/ÿþÝ¿nÙ?É©ÌÝ£EüpFEï{bßÆ¥bÆÇÖ¤>V¯êFºd ¶5o#²Ëÿå«ÒGª:uú¾·C}üwÎÜªØN¢{ëah+,ø/1|ý¶åµ²Ï\¾e	=æziWùÍ~ð¥¹ÙU²À*òþûç8ß÷ke»bR÷Ulïb³Ñ¦¯.A¹WtÜ1ü¹ü¾¡Ic3YöjYCÉdFFIVÂ:1Éxi'åùð«Â§ÛìmiøîgÄ;<Y/¿¯bÁRëºÅãl¤½Ú@ÔÄª6§
°ÎCUÚ\ÅT¨p­j+YÎ5#&¸Ø:Ä¯Ê+§jÔA©«]<Ë82K¦gÿ2;5[ÄA¤%	g#Ùüj¤'>X_·òÉÉ¶ö·ÿÛ $ÿ
RBß£8,ü?¿Ï'ÇA-³®0ÿ`¸&Úzæö¾8XðAs
Å´ÅÇê«éé{ÓÕáY@´«
bÁjfûÂ²h¶9=V
ÒFJ`µc¼
LÒ$ö¦=«¥Ú(ë) úßí´2igôiû¤b
$±~C¡r@t7$æ\}si«ºòìI2këñÍTÃBpôìÞb¶ùb³=¤bÑËáì*Õóó¯®LÑN««iäsì«NaË§;LDÀ"y×%MæCyyQÑ<<k9¡´8[öýnÉ¶#ºþ}ÔÁ©øæ4?5½E(òF}ù®0wìYÙ
ZD ¿#\Ñ«q[á8Õ¡-·m¿¯Z

Z£1@üz§uÆ¤ò¬
ØHí`ª<òÒN³dE
;t·÷-VÒýCbÑ 8hSLóÅÌO'âNóÁýôÈ[à±/Hî³»|ù(âÌ;^ßÁ¦OÁªuÍÇ[´Æ=Æù)ÊþÑîÁ e.àaêã<
Ä¡f)q°äØÂ>Ø¯äxã:fÉ
tÉKÒJ¼JÑÜòYyäÄ+/tÏÙKñD foß6¼}ò%³VÑiNtðÆËÒt3©­pfÆ­¤îtób«ZáËÎ©¹DÈ¶Üæ¤ÌðÔyòe	»%¹|¨,Ë
ûËÕ]yþ#8¦&aËPÒ'GxkõäHÒK[¯_¯ª £4Tü2
QW£²jo¹ôzÝà
ò£ù^RAÒ³_AË~ðºr@?rÅt%d¶¿	[dYk,íç-L ñ¨ME('×J4É­%ÿ¿rZ|k½ßiÓþÓ.ífªÇù»0ôëSw'Hh¥UÁ0úÍ
j|"Bf6ÔjBXÀºEØL¨ºe{b,$x$}µ6ìÛa;BÈ®¹ãö¡­²I¸;ÿvY*~+&AÅSÎ!Da£#ìÃ*u,tÉ`På:á!oCaÚ¯MÀMÕóÒuÑ÷
úméìÕfëòvúy;öv]÷¥_ÆË5ÑSÊ9:yÌ¥ì×(lÒÙ¹'ÕR

õ£3hü¹GP/uÞ´IbroW	N÷f{_RxÃ]T&LT((ôÓý É¦FóÓiÏÖ·¤[s^¾ ? °CqWWcá^¯ow~ÚO¢²÷º4%Ê©í&RÃV}A½Ç.Ó8¹N¤ßxxj¨=°<½bAªC×!å:uS+ñRò
.6ÊúBµËiÌ@0úE¬a÷=6O
äýbLÐf»öôþNÏò	2ö}Ïàa8¢p¢Ë¶%hq¢ãõ]mÞÉ#ÈK¼ÆuéÖeÉ1nH]Ê¥j8æFQøª$òX>ÏÎûRoâá@²ïh1ÉäY0ÚÒOSD¦´­@ÿ×É¯ÿ¥ú£*|ü=Ï°¥ùô¾ìóÙÕqT~ª¤"
£s*ÁíÿÚfß'lmè%lÚÚÂÔmïjÝÚcÂkhódï¿¼Øå	q¸ÅXâd&XhBP
ó*¦ûÙ¬;Òz<§2Ùïçãà®ÃxÁ=Ü½ÂÊËñ5gÝrSÖÔPæÔLÆ	eç{%¤`o
Ãí¨©BU¥äÒlÎëËåÀÒKLe¬t0ã$©Ñ±µ 	~}imÆbõFj9ß&N]²0ª×-n@¡úÝ!)Æ»VQq{¶²üÌrWÎÙåj,U=*ý_õYULç¢Ihåê:àÉhgÌ´Õâ!d+H<¯_ú£4üWËæ¾jj.2>ÔøaÉ#3{¼Ø\Ù ¯cr±W7Øñ=®àv-/ÉÀ»\¾l%¦ ¹FoË.?ØÍµY¨ÞlÕ*S´ùîÀ¤Cb½ø#'-aÓ¼<
ìs°*3ÁyØ:ñ|ñy¬÷»&¨IKxú¤(©þ#Âs_Øõ»µªfÀw'w/ÙpT*·Ç¾·BXÿë
Ì3ì²\ úèÖê,ºQrð¦lÔäN³2Ì­jÓ#[Ô/+ê¤i¿év}.*£Åk¾°T
xé\`RÍ,jIzÇ6àJ\¤j]øçø6Æí
ëror]¢HØù
ÛE¶I¿íÛûIª
P U£5¤ü»[6jI*ý¤WüwÍ
¶y¼bd·"¿aA
ËöËäÍÑò,aßì,alëP%Ë,RÒØñ¡òøÚ¯ÁÏNyÒ±m­!b[£¢Sý0 YµÒvZ9"zhÀ¥'­ÓÊÿÛ>#ô}§þþ¸¬wÛ
e|¤åx¢ÝòWp
¯Å­TöÞ2¹µEôygµð=¯ÕÅ`ÝµðpPÄ¼v¼ÍXPNcæ8.k?Ûªþ7·+£¡A£|÷4ReMc×£¯ã&£:zng´ª±P<ºä»äÓñ*×ÜÐÜmäd)§7»Xã§=¼¬^-ß\í[(;f¨Jöàl3`?|§ÈôòVÚH 

Èµà£m¸üØIå^0ÓR'a©FîÚ_l¢7õ\5²óÖ.®q²6ÝvÕñMæßBrE¶Õi6aöÀäëaÿY'çy2pJcé3êò<và~Ýýz½¾j¹;zåÂ_z@¤Ö=tÇ@RÇìô,úÕ
Ù\É|-k%w	ñØ"g@Z·.·½ë
óª#mÄ¨Á[Ã¹Ñ!Ì]Kmloh)M{µtmÁ#µËoú¨¹mÛzjÆ>ì)ÇLºj:Þ¬0
GDò¦fx2é¬{t³	õvçæ\éûS=WráñÂèè¤Í:	~ÇSa¤HÚÒ<pZX
í§·¡]1*`A¯´0É4Ösùg»xÿBwº>ÄÚQ8}¿Æ¥C>ëûyÔ×2êY¡´°&FÉ·ÿäh¤£SÌü1¸¸ç¢*ýá>hJÓG=Ã/~h(M©$nå]sPñuoþ°W"DZ-NòËNÐ«v8G(@|<vã«4÷ßÒàM))ÂæîRÝt;«££ö1O®+­²¯">ÊYÀºáè»4G\×ÊT'SÔì×Û£Û[3ÞÈßb¢óc cG;#Ó/S4ï]ÉOy÷`ÃËO1 ê[âÿÆ©*4®96_ÃvóE.ÖÚgøù´¹rQ¦cJ=zÆxä²9p«agJH}Ê È?­¶-QÌõÙFê½ÛGÇ½2Õ\EÐ=,}(Zò)|nÝùÌÁÔGjq÷yx¢x§Â.lCFeùý¬Ûà©,SìX\øÌÝ"ØÖÒ@ü?ÛÙI£Càü.æ¨ÖDgqþQ½à ¡4SÆZ5Ýç¯Í·ñÌøÍS qÍ×zv_Ìû,Ezÿ}¼S¦íPÚ¡M´?[#gú¾%Hè²¹9?¬~×ylÉ¬Ö#8Éz3Á
#Ætå1Lm«àã'ØÙ½|ÑMÛÅÔ£ZHét­ìðÀÿü¹iÙícGqÏC1f
6Ù¥ù}-%
Pÿh	©ÍÈüÙÓ§]2î/¡_|5Ç[
¥OÊô*ü'Î÷ÁWåÅKAæmâóáªg¹¾LÚõ9£[N}ÉnÄmE3³xòøÒza&íDI°~µK")NDC{eæÈU½¿Gëñ'#·T@Þ9Ãµ¨}zOímI°½~¿þ£ôüês.ò
iÒ¢ïÑ>ë¢fJjjÄí3wÝKßÛ |ô½ÒZ§&Ç×ÓFð\óÜjùlÞh!t&9ß©lÁ0ÅÎî Ô¬PfUûÜ.dù­¥`9
/8aÝû?HóJ>5òÅ9F\E)N Ýü1ËHÔÌXié«ÆhG$æsÓË¥bNfDL0Íc[tÖå·¿BL+£µîv'"ü\ø«Öþl×BôïAi¹üôã^eó	ÝoOò°w«LÊqw¼òk5¹Ì
6øT#¶¸¢dqëC]N=Cf"ü¤ø¨¥å}ý9W'íÕ~¢|`ç»/:ü¦/¶¡¶ÍRãy¤Ó/Ä¶Ý^ltsï^á8ÎÐML¶RçØFä3ô»º³ üÈÝiÌo{¶ÓÛáçl>°%3V,O÷J®>A-è_ÍùEoÿÈdÉ·äÈØWu[û¯£EüæMDö
$ÆCëHd^¥kuå~1³t_=í½©/rÙ¤{üV¢ðå|6P55ÉòAý¼+(E²s{/eÊó{kÍN¨£?Pé'e;íÍ-]ýÒ±l67×§v'çzRäà®að¶E7¬³Óµ[nìúgH8µ·RßW:LÚ°\­ëqT#^æl>öÀe1~ÿ­ne]ÐÊ`ô
÷¹Æ=p ÝêæÛSh{ç¹ÒºÿØèr(PõôÙ
3ñÁKbXÈÐ]Ü¨ÿ4èF­TF®¶néí3¦ö&ìí)	Ç|¹ÂBýÿUVºî«"º¥.gçqy1ò}Óz4Å?b~Òhö4&Û¥uÛE×w»²Dø ÈO¨ö¶Ûµ£EüåVþmåuÿÃ+¿¹E@q¡»Å5S©»Eþ-¼QQW3Îþ~ì¦ôih,Dd¼ºµÀB¤õújWQåtUjó4¶¥KÍÕ¼ýS;Qq4ë{èþoËc³¾q¦¨ÆÍÎýa
7=Gg÷×èY¥µ3Ù[G1Jººß«vzf4-Q	V"ÅBbE6j²ÝQñ\Øfòøae÷äÏÜú;âàÄY´mA·aÅäÛ·Ù-QÞã©º+k'MÎzÜ×W¢,·?Ö~!÷P²ÛFàÄæÛãÈäeûVt-ô¡&Ú½2LñE?dï¾k]7ÿ+*#{68ßwïåîáOÏÊÚ_ÉlÖíi @6ê#²£E0üåWnOñ°aµ£=ÙÖÏC{&%2ýºTY¦ó`0|ó¼$Ñè-ßì4QÙ®Ëíq/Y¬ÎØÉXÔë¾u¸@¯i
7]jg 9tÚ$úÿI©æióæöØ5
~CÄÅ@ëæ¬y`
ÍPÕ±K9ñÆz>»xM÷BwKrQ©mOÕÌ¸6B×JHòn/Uik¾l~ìÞ1+Ê5ß¸ì@Æ¡_düì ØÞìûe³Þ"è$¤ÕdMVª`[fø=Ì«¢À°YÈûfHÙ|VÛHM bÇa@9þýcÊÐ8`y ¼ÛÍ4[pfäK_·[á;
zKô´CÒXæªRßx·jQØ|%
Ox&Í¤LÈ²Ý7êH³²£EDüåVÍQÔ>³<IåÐÚ©¾X·nÔñ#^§ÄaNÞ¤CÇ½E_Xü2tñªösFT'9­²îÑ02îwRÄB´Õö
?Ì§ðK,Ñdªøþ^_ôAIÉbÌÉX~³ô[À0JåK×ý
îHEkµûj¿g¤,{üXÈDç¼h¦¶ÈÈ/íé¹oêÕï Jû_|¼Ã¤òüBnx·âØ7{NeþºXzÆFÍ^6"!EáúÞ{þô_aÜ©`
NÏoÇôÂtï+Wá¼!'|¢è!Ñ»ÃÙÊñ[>óMÒÖ¾éºS4	W'«vqf5à¸¨=~eXêZ¬¥ÿäìíDMà¿mª£EXüæM£SCò ËznÜq
VhÐÐÛsJ,­@ï;ÀA$ Nðªò?(?%Á0C!øOl[fæ±.íàèió¹ Nº`õ¬A@_LÄøIEx°ET_ïÎ¿fgÄ÷Líl÷ø¥_)î²GY¦ÃÆz¡Í]¸s%æ¶¥ç[êkre1³!r3¨É¥á°4ofÐòw4B6V»òÞÝ	ã:h/çØ²Ý\LæLà&Ëµþj£5QãÙ^TÞðÍ8ý\(UÓò¿(I6aT2×÷Zq§âù:	¦ÚCÖÉÀuìUcå¼O¯ì1¸ÌÆ¬WØ¶%¨,ÿ5¦:¶ìÜPO^Û^é"I6ÿ°-mµ«£Elüº­UäRbvYfI stÏë4gPÊòÚÚ`ûÖÄmV|NþéÄüÈ¨Ü®X$üe÷#W÷»7¯~¶ä<-°Ö>`6¹Ã§ÚÃß0Ü"&í7bë.ëè°ä¾AsP¢<mÏÛuiàÊÕöO¹¹Nô¶@SQUQP¶2-øß7óqsFÂq¸Æ^¹_¶³D¬FïÈ·$,Æ{lmR706ßî
.ðO?¤ÜyÆMêTæ3¿ò³GîÁ"IKP®R!t
m^6ãÂUÎ¿]@B°`Fë9Ö>h:ûö>ò~-rÆ"ÛMQ~#dÁ¸k@3¾E¥ÄÆÃWFâÇDÀ)õUdýÇ[ãû$É°úMPM£EüÕkÂ¶¶DE¼o!b_Iõ}Nñ­Nb¸0íi­½7p&q`o"°üÜ¤ó¥I­ôZÞç|ÈçÛe;k gÁ­6æy(¸H©-ñ¯âÔYH\Ü;3qIkµ(4×½(òÀK¼ÎS1û©ìõ!z¾z')eÒ0Û#¤¥ÖÂÍ°¡Þ!dTJÚ¯N\m8vÝ#¶2Y¡K¼	ýÂå33:·FB{ÖÂi*?IB~Óé¤¤E×/Å¡^¬''cáDã´¯[l(L9/µºÈ×á=õoæ\ÿZX=F{¢Þ7ó?lÄÝ1`KuP2OP°¡u¾0D
,XâN7\ËóÝÔØäUUÿ^ý¶J/£EüÐÐà×Ä«½@ëCÃmï¦½d\Ã/$û_;)Úé¬
>
jq©\jÍpò»ÍÂbqg
!VÀ-ØÚNÙPTÌRLW]ÌàVS*ÌäÕËfóVAëÃcÐ' :^ÞnÇä`¼1 &
¯ÆÒhkÍíw+¯]8aº¸çtÿ*íõ7xlã
¼ÀZø}ýb¼-è3Ä¾:Å6¥§cxe)JÕÍO$ÜJOb6º\¨öc!%FTéjØöbì®4Ø_ä2ÌórÝaî$¯åM{¤%aj4OÈc8ÅööL8¹C·½ªá~\¨ýÇ©ü³.ô¶°²ÕÖÀ"¤@Ì\æEÜ%»=ì/¶îBdþßÃi?P¯$<£E¨üj^@4X©¿jzË!]o;Îú§kØ÷Û¾¶J©rBeJíVö¼	Ä¤Ö¾·-)íî$¢6S2:¡|¦¢zÕ¯¨æ(¶;zB®PôªÒâaýîi<¨(D§ÿÕÈÄáráHM×s2"0ðµM°F[C.q~U´óIE;£æ}JÊroA,)»Çµ.çâ«Vàðl#HÛ}~¾ÅÞ¢18)ºCÍxýÎJËYÞÔ/¾Nl'.öñAÝÿ_åó´«&Cöµ´VÓ$÷êÍñGQ"¤iÛf-ÆÕQãhS#h¯=ÙÕD?Ö#Ü 9õiëxûßØå3!)ö9]Å±¼l0­ùHüÛ[%$¿I)6_×Ò·ÿ£A¼üAò!gå±O!	÷yÖ¬fçVæBôþeô6ÒCb-:}Fyþ`½[ñTLÊ¨Öx±g7ë_¸Å°;ÎK+ñ6üÃÄçMJ"ßÄÌy'î¸àâ0ô£IL<:°oó9f¨îÉot}Ñ·gdi®lHíóÜÄ?ôê®mf)±ÿÍbøcªfø|´»é%ÜfEýú|®À	ö
Â§HùñòVÊ½}ORN¬ªÃìµýBHd¡ÇA©âÂ~âVê*?AôTb°£a
û³Û>±éñÔðÏkß2ð²(î}Óç_9#çáánAm¹/ê'wØZ40oøê©;ëçS+êzÿI/É&BmJÐ	ªÙ£4ÐüSò\zæÁHÉã<T/D35Ø¦zÚ8,`ßÓý¸vnèÁoÜ%v ÈËÁâvÉ¾vÔÐXQ)7þh@Û0ª|c\²ñPÎ':2!¬ûDå{fIâÞØt{V +jÞ8âHeIA-	+^y#qHµlIJ¨ãOnûÚS¯¯)[þÚ~áüÀÏÎkû±ud>ÃÍWÃ8+ú^éWH7L_Tsvf66GiÕ«­ïÍ*ÑÇ~KwÌÐª2ÿnØôHY<Þv>£âÄ¿à~=yÔg²õÌð´µÅ§¤]5!²KU¢q&ËßS¯ÓAö*Ð,â»Ûdüi ðd-£7äüS±Ìde
öÅÂµ²ý«äEÚTñOZÖ>F<pF®+s'OZ<Úë²öiÂ_£YdKRÊÞ¤(ÁTfHaÔs
Î>9ZL£·\Xòu«;uN ËiöxøÏö{D_w¸÷oâàr'³¤3ùîîCMßÈÆ~iZ9µý``Â/¤3%lÑ¢ä®Fâ5æ?îa# ~Åà#þºy2qï]lòwPT²ý%8PöJq#FÖjè"á²¬~ï j÷>ÈÒ­ïj»hç¡Ùñ~øéDûj
Y ­½éY1V¼Vhÿ`o1X"Sq¸¢'l\'ºpcvhÄåÒ»JFíðþI<Ùd£høüB8*­V I-¿[äJÛb³5Ï?¢9àJÓ¯"dÖ6[w¬ÛóaîåÕî/ÑH%ÇF¢kHÙU×ý×@(òA!ÒÍM{Õm®6.u;üoIôÛqä\KÐê!ùUÂÎß/£OçýªO£}V9°m-Òùék³7Gä¦Þ?ÿF1ss!0ÜaÒÍØÙ:5¶ÓèEWªVµ	EþZ«Î¥Ðê¸¡=Cúü 
râîÂ¤±P§N¾¦£Yþ¡FòÕ 3«S37Æä>Þ½n$\ÁD¿H:c¶à4JOU¬8=
O~®Neô}|zk^Áðá£ÔFßÑ$«ÿHÊ¯F%Aùðöö9ßRMµô-BÍ0 ­%Myf~nòÈCLyzfîÀ 
ÊÕi7¾TsiÿìnM$$%¿ª¥m*£Dü?¿Ð@w¤"º¾Ú$8)YÁ¿'ÈußhtÂë$Ímã·×"Ü¥÷n>Ezèýî2wÑª7,£0sÁïåè%OÃW­ùüÛD
âäúbÊw«2ââÔ±1I°ëöõÈßg}u(j_º¬$à)EKåRxÈx52lBË][WdÙ÷JçÝEó'«r¸CÛu®AýÁªÌ²þÈÒT.´.B­±ïÒWØÈxooeA_ìí¶
]ÚR,*1035Ñ:*ß[Eòr?4- D75ÎC	Qï ÐqÓøª&\lßÒ÷9öéÚ+K.o'±¤¬É·tªÆíTÐÉ¢YÜD6+êÊ=d¯7ÖÔØÂØý%¶ÉÿðPöÀ£F üOë~äöfØÔJ$@idwï9NûÁã~AúyMÆ«Á3
):4ÄXNçRpò­zÉ$#RúöÌ0ÐÖ¶}«°d$TÈëÀkr¡PsÄJÄXÛûA õýZ
Àç7¤eKÈ!«ò[¾dj³
Ñ&ê±²_¥|µÞøl{Ã7PáæaKú½yXzÅËU¨ö@¸´4yND×*h8Zû§dQd¦W7ÓsAÖk°BSÅ
BÃ^º¤ß¯*rcT¬vûKT/*V¡íÁ×~ì&ÏÕC»ÒxÎ2Ê±çÎÊO ÀÀ²þÈÔDÅéÍ0ÚúU¹&(øbÐF_:¤#ðóåk½CPùÌÌõ?äI½JEöÒªUÿm¤£E4üÐö.áÇ¯$ÉÆqæX T/§xqÛ½¾©ø×4òËkL°7S_s#QTýñ13©R®U=¤I·òáBåKª+Äq:ì¥Cº:Ê;ÌÓî0«ÿ<?lqÃ»ÉÑsëpzd?eîu eé¡Ü¢ÁÁ¢LIJÔ]"¡Û@wèÒòL»9Ä9È[(AQü4 ÍóÆOÃðülÙm·O~¹PÄgÑAh&sñÐ,*üP.PùCûüvroý~r_¶mB;eß¤<Ã=?4¨»øù~FïF[Ãò%)6'û­Ürø×sæ!=à
êroØc³ü·%ñ}¤¿@ïsËÿNäp]î¤î$ÑY3ó*zß_ÿºD@ú%A~¾¿¶É£EHüçD	JÔúÓW
hÃ\^ª82jÄP¾!ð¢Ôò!î:®É2]¿üó~HÀ8­òêìýÝu£Q¬!EÀDËµ;¶Û¢{ûsÿ·t¶¯ïçæ
k­lô¦)ÿÂ¥}åÞºq|VÈ.(Û9nYûáÿ¶ânÁ`¨tÀrvæD*òEIû ,~ø3c!àÖüHe+Ø!àfñIô"a¶HÔ<ÐÖ?½ÂwÕsVfm¸
áºÌIø°òHÇ©çÜ\[Ï÷¹ÞØ¥mñß¯A­ôÏ­&À¿ê0IÅéx´	1><ûh°ÄÆÉµ¢éc¸ÇO5ñsp·Å:]$êp`éqÒÕúNh½<yBìoö¤H­,7þVÿm£E\üÐ9« ÿ6ÞLÑ¿Ö<ÞÓ0¶¤ô«e«Þì6ó9=ñCz¿¬ÌZ0EQ­·ë
N.& RÎ¸r},F³­»ãÔR-¨¯¾ü	úÈW\·Èë?ù@ËOÿ¿Bã´³¸Ê¨¤¶,¨ó÷Êb&Êÿw#ö¥v'FgÄÕ*¿£Ú{ÊÊµ³\Ì4¼
Ê$ÔN6Õ54VN?Û>Öì	,äÙI©2&ïô/÷ÓÛ¤?åËùY»GjÞÜe ðUËï)aq9zMÍ(>²&ÓIR{¬¯ÐäB	Gd§¥$IxPQÉ+©½8À#²ÑáNën(´ß!uOÊÛ öËæç?â*äMÔ¤Kô¶êM¢	ð+òBØ£EpüÑ¯ßÝôæ"-éî1Ûf?¶Öë=o^ÙÅk×\ÙoÕ
XL33?!;êè ]«·~Q»êç4XéµyjàziWäë+Ø¬ì&ÈeþXºõI3¹.E¢);ÀöwTìdO#Íï"aÔw+\}ðqÒÔê&éþÍª:>¤!zYµ;0óü<ÇÄ³fLþcZ£m'6\È©U¹ 8À¨lõT`TÍ;â«MY\¼µßÿæòtö{_±©ÐQ {¯ûYû`5ê<PÃûí Ï2èÜùÏ¦ñÜ\i\kÎUÅÛSza¹õÆø>7ÌQú¦Fsù&¼¥3¸»ÈÜ+§tåÕgý¹°>­`
ÿð=Õ£EüÐ®¾U¢5ç÷{®qá$G1 WO«S0\££(»9ÜÛU[nÖdêÌ4ªY;SRÄ÷ðQ{\ï³~dÎz%þ2Aõ«à«wªAÊx~§u\tð¿î9y ¡WÒ"°ê LÉY+ñù;7Zgú¤Æã![ÁgÙü8öKIælòE%¼i.
¥fÏrAåíê¶|Á¤Hgú»ÖÅ$¹ü¤¤ÄÊy¾W´|GFmÄg_Âúdg$'§â¾å 
fVüV{zæÖnAlÜZ§¼þ±h\*Ø=2ÇÂ±?éKÐÖ¥|á°÷è`Ø.pr:·tJ¸T_+VåÓ%}
À< ñ-ËUSöRÃ£ÚÊËéÑ´3m¨T]áþ´+RnD©d¶Õ$Ó£Eü|«þu¢U'Y£¡FÊÄwµý»¬VJù]ï8áAò£ýZà8yVlÅ´û¦0A¨Y[D~Í¶0ÛíI²n~§kqFx-ñ©ùr9×uiÀ7âÂ±Ðn
g¢©q2ÿ	'Ý1%G4G>ºÏ4F+Æ\LµkêrÀÕÍópõä`>ú¨Ð¦øíUáAhy&Õ«|ãÍ¨CèEÎ!­úù[@ñsáºCã±¹ÕEMYïyÍõÄ¬ÈôþBKBôòøuÒë*»@çåßÀâêoRG§íñëÄ°5²düS.JÃè\9%ld$/ikQuDà9Åæ ÆJ¹¥·¸+0Í¶Û.àZªô«o×ö£E¬ü$H ·Ë>gÅòPj7t5eh+#Á÷ª÷rsIjÀcSà ¦a0d¥®à^»å¢ëÎÓmÿm:»à
\¦år¬½ÔÊXºÉÀï_k+Hª FøTDæ½ãÉJISï]Kk3Í$2ôÛÚù4lK
RÓ
MNNë¢IòzÂvY"/Æ5Bû35L¢ZÙ÷¸cç~>¥×|¦@òg¨sz½	h°ù©ÃÙùÅÏ²yLVr ¯Øüâ¿CþÿÄ·à©¢ 
>TE¦Í6=ØªZÊ#é+×®'ö÷Þµ0ó¥:¦xYz[ríÉ/þ1#f>VäjºRæÃãõë½¼õ&ÒY®íÛð$i+Iªõ*£EÀüçUzåÚ=Æµ4%CS&@uÜÕ³+h	\È	©JãTo-½`£Mýw¹o"7Ù4ìØ¥.HºéQH±ÄÃÓÓ1¶ÚeÿûiòÄûnEì¶âÐ%Õö®)ÜDIM(ZïÆ]¼VvSÌË-2ß}y¯e÷Úï¾"K"²'êóõâxY{ùù²\nöÎ£º"5qÄ¡qs? lf¦ÿ÷¾Üáî#¨0ï>a>Whhl§Q<b-fd/N²]?P{B5Z1Ø[ëA'|T1'AÌò)îk!¢;Ûø,fcÜ»/&õ å)§±liúç/#¦6^yãtóA¶5àXÏX2Ö<O0Q­*Ó2LÊR³{,õþÔÜ¾£EÔüêt<EoèdgõÔÙ)Ën~TætÉ	&Ù/i2À½áÀW{
#~§.e÷æøgÃõ¾¸q
ZÒµõ
ÿ¤ßð¡ópd0G}ÓCyGTU>âOd?8ôC¨Aùè¸igöJQ¸eÔ--]ä/óÄzÜK·óö&"Ï
Á¶-AÜYõÆ¸ýO°òÿÈÀ>te-7,ÌÏó<·cj(ÜïáZ4õ¢8º]Éôº@fâ>ë%¸4}Ò,
\ÌáÕnYX($;
VÐAçû_±óBÐà9½¥zh+çÈdzP_´©È£L>ë(0À¶-åËbS^]ÓÖþp:g.«(ÂuÇ
w¯7ÜÄ¶ªA´BÐ¡$½C¶uÿÿÿÿÿÿÿç¾£EüåSìlU;±E·èÄæ3åþÉ@iÆ÷©æ«O¯+</ØUú¨2Múk]cB`õ[|[®|-XÌú<ruã)Ò^NíT\¬ÕQ²Ä\#"­|uÖ®°9±Ie`LÊEïÈøL¢X @~*méÞ$È é­ùF4xâÀ8ò@=òíh<ÏI12|§ ñáæN	~õbÜ&2ò½pç;ÿ=o'Û:vÍ(hb/|¼E3¼ãTzñ(Ï&ÑUÑ8$ppÓ´-`p¬ÕÝ¬(¬°:w"þ­é®´±ò£<Âr¹§^&k'ÛzXKfÃÊ>Pº»ËÇýX|f3Xc=ãU{ZØíÝ¡ôI4½£Eüç=ÿ#Í¢Ñ§0r%À4'(9lÊ'ÀCë¹½Ð6ë>òb=öEªd[jcYÒQm<E ¼Ü`£¹ÿÁ£úg3=þîPIOxñÔÑÎ±båësq÷)Oêw:cË=ðÝFþï};Ï;=$ÀS®>¹HOsª¼À¡
í«~#ôµÅãV@kCdoÔÃ¦W<üa³}¸¦ê_,ó!1ïîË%6.dÛa:alXèê\ll	D"u2åêçé4Wú±TððØvôäóÒË%:áã*~ë KÃ$r dúp("õºbÒNñ¶{ñ¼þ¢
 JýBÅÏÁ¹;C!LSãT¬!;$ÜªþJ^®É½£E(üêsÖêX©ï3lUûE¯?ÆÃ¤@hÃîkÎ«­© «þ;¤£÷+%¸ýWÃHùò¦6D*&rÊiG°?"½bÂÿ6$L¤<÷of(ít3 ¢ÚmÔ¡Ø|Ïì¼K~{»äÊM«YæýIcAíNéãL2q¥ Mçºr&>ÞD<ËË[/È5a>0O/ÿTÄv¥t`á÷aDä®¯´*{_4JZØÜúXò«Má/.Ï¢çÊ¤rHkÝµ¯(gÉ°ü k«&Le,¿&sEçEöÀYÔûñO[òì£^UGÇ(V¡u.îµ27>Dª¡ÕÄÜ)tç4ÊªTèº·7ååÌ¼½UärF{$?UkmûmT¹£E<üæ,
(k0p¹TAàçíVb=CÚ¿âúvÑûøóS¡*KUe0ÅAÛKsð=¯JÁNMjiî±ô4òíHt43ÈCibw®A£À4Ýñ@ÔÓeå£Ï3Þ#Tº±®U~³Ðú$)]î×;CóRÂÐiCüM}kXrwÎQk«Wø¾SÐ¹TÔ¬?âHT®èîM;»bÖE~@PÐÅuêÞú3jÊ²ü´¼ÏLfâGîé¥áÐX#åD$Qa</À.¼U±ò4´*Öc^@XÝ7X¼rr ö¤ÂÏÇCõ0 ÕùC©ÁôòXTiÔY¬½@wÏº³ûÝÐ%eÌ×5ÌO_c9Û-z¾\3h6Ý²múÉ!!äÑ;,»£EPüçUE´B.Ü¤j\×+_gIÞ)îbBO¶-Þ?Ûé
aú"ÒÞ r¸£´µÌ6¬äbDþãßÈ©¨\üÏe÷Æê+?P[
.Lô#I#
9r61®3Höýû®®8Ec¾Æ±u,bvõw]ÆDúº»#g7ç e<wèÚY1IæAØÅQîÑ¹ÖìHÃ*tÞåì)[ùePÖÓ6ì§bghì¼äú6)>ÜÜRèÁ#õvïv¨uûÜ._pê±8T4cóÌy:¬éhJ¢o$hÞF¸ð	(ýëüLpö¦õó:ú]SëçH ògÍ~ÓT§ISäY&}£Mzwúz"ïÍà¢dÿÛ²R6Ý~J[z¥nß$À£Edüåiu\1Ü;ÂÊéû{üRUÑ80öCèík½õ·T7eWÈÕ4¨éS´©÷öÎQUª]( =nìâ@%èI¥ÃíT±ÿ¢yU"[×i
XæÝ¿K(ò«Æ_³2Y&Üpÿ+óç.p·KéÙ³do:%Ìg
¸-uÿá7ÊH¸u8x×I×õ¨<©sÙØ¾IYà[f'àgÉêË5Wø\~ÜV«RÞ;ém%Ý£©Z¶©×ÃäGï¼H4­§Òdh#¹¤ò³°¨üpÚñSöã²á½DDËéÔPo²<[Î¯Å0;û¬ÊüýçñAÃÖ_´¯dÉµêÑKóáÃÆ3É»#2R~Ûú_ÛJ
ßõüÀ£ExüêsÐûãÍ¹¥ñÜÜd DùVÕ6Ü7Õ½¶Q<H{¤%ââ5ÒÂæ7½ßñ:ÿÈyÈtQ§¡SÌè¹Mz>a§o»KâUVeú
å}°§6ÚÿëMZ45!.Ç^ÔÝZíd_GX<íç[¯%wüRs¦/,K:¶ÚE$uQTJct¯4òØHáüu«ÖÀ;àÃÙÜÙ¯_cìJ2×½«wÕtV¨²°SÃ-ÜÅÑ{/þégûBäb]ì
c±eU¬´EåkÞCúZ\Ñ»Eü­g§ûLþ¸U®Þ6À#F;rT ÕèÒ'ºLM¼	ªºÄ¡?hÓ!Ú¶«úD°þÄNá@MÂ£Eüåic½î§¤{)ná "0öpê¸a&í&Æÿ??¯ð¦Ëdýqà}êKÏ3ÓÈ:¨7îc³Qÿ>vGzîGÔÔ~tKsØ¾ÊÒ|XZ'ºÀéÔ&V·\%ßD8b_0í¯Â<´ÜLu	<28Â}9Â«¿ã@)ÚÿÒ>I-ãõ½z'°yÚWmúËvk³1	(ånS¸«n,ß¬EÍû?ó~Wú1ããëQ&#Ø¶ÃU;"ªó
6á-ÁÂ{Ú9>¸{7W;5
¾Mc6%/¸¦³¼ÞæäÙÛö­hFÝÑ=´qh*u(AÀ¾ú4Y"J¢lÌæÿ²àJ¬fAq¤t£¥héËU¼ßëV*õWõMI ´JÓiIµÇ£E üåhÀ¡kUÜÛÉð¥©=Ô<ã|õô-F2ÝÍY®Mv×0K·Z/p/UkàÖùåÜ^[Éæ>hC5_x]
®0Wf[uÿE7}²¸
²ó::uw=Ë-µÔ5{Ï¿Ú¸Tt0Îßèí=Ø¸ÒAUÎßê³M¶­`Ú!êä Ïát^òùÁ¨`»-è¯©6éúä#K/-T'×æxÓ#¢/Auû*èÜ,È
BÍÑXWæ¿-'p6ü^S¹õtãÚ´ñ8u¾ ]­3	×z¬ø¥²3XvØ-~úÐoKð«YCURÕõxmÝÓ,âV¤¾TÁ¤!Ùç
¿u·m·oöÿþ¶Ý©Ä£E´üç=Î;Äqeøë#Ûäf`Gd/ÌØ\û%êË#¹JkpëºUÂl©ý¿IÖðË 	Ó-/ÇÀ=qv¿©=¨@<{sbÒèK÷ÞsxÃ×Ò|Xk~¾ucoã	oã|_ËT`ïN"Óòºú H<~)È³4Ymêö@¥[eVE°a>ü$Ð8%YæÕ&ËXgìý§xGp·¸@é´¾PÇÊz/)¾,$Ù»[}ÔDÃQó¯÷TõÇ½¼üçÉÏAÃXÐÃB\,"PÙFÕ{Ô»2â¾iT	ªaPN;VyÒDòa£H ìÆqü*·½â=>L°TÌdGþ·TUnÕÇã¡ÿI¢ß?5;W0Í²%²$NÒ*·nÀÐ|Â£EÈüåVÍ÷ò|wµbK 5'Y< ,Å'WWV#à­Õ½dü Ýu5 òauáA¾Õ
ôÝÆÎKL
Ë_Tßo>ÀtQP8!¸Óª	O¶"~$,³ \ËK±J½"Gñ¿»»59V,«Ôyd¤@Êä«7)¼}]6ß±ÃåkdÐÓ¦åZ)ÑßCÈ9å
y
zÊ2(¤ÝRöÆ-ûøÏf!Ö ×ãá>hù"N¯æÛx×mìu¯åw´b"^0q4RÞÁ9çåça `Aç.3®i<kh
d
ôÐ[!VøwÂõÚääø°Â4-«µÅÔzÓý×æuÎ~fë#è¹¿
=«,ö9TÛ»i%±6Ô%þ¾Ø´È£EÜüåT!ê8sÙ.eà²óõðÖO§ª< èn®@iMþOîî9K}õXØ*"xÞ±<×Ïrù»ÑRwíÂ(séÆÈB¦uaÒï·ZmÝtÜpkÑ¾.kåûñrÉì²ðûàµ¡ëR^RlG;Õ¦ðaàÄ´ÛóÜõJ"òÌÌ(dÅ
$®5EF´Ã)%âÎæ··½û_5ULvÙõÌåÝ^ ¥(º³è|ØàûÑ²:Ö({9jôÑ1&L{i½WìNLñ].ðªXæ¡ç$S³-óÃç`ÀtÔ(Ûj0:" x7ÎÏw¤©TY½Xnj"ÿÕj[õ¸&»Ú"ßö¶Hm¶mªM¿µÉ£Eðüç=ÍZÕ9l(Ôß 4©Ø_¹F ÛË|'ÙX?Øß)Ûx{gá%¬¤BÛ(Fó÷O) «voU_"Ï¹ëË§Úd	5AAë-rNæC¾Ç'_^&Ç6ü¬êk`©ÚãY«q"1ËüýÑzÖ£o2×
å"°Ä.)¼l,¥º¥á 
ûo° u[|ñ0!D±&ìsh{qó×sÄYá¨ë Áñ»Ò©-3Gú~ê¸¿9êçiAÐ¤íÖ|Î'¡R>Á
[öóÔª{ãÛ($C»ü¬Ð@HÌû¿¶[ùÝIí}Æ"6¥Ð:DÞÔ¹öM(ü±{o2å{³`èïÑÇABíÖí±!±-Ék°ÝÇ£EüåVÍ;¬'5Ju³ª]AMû2ý<uu§))dõ8]*rdRZ#crÉx­RãsÃ_Å8É.^/2ûeÇ3®9VyÚoTÚT7!ð÷³·Ñé4¶ºÊYõGC4Z*²u<»#Q9üib?5Gx¶t3¼î
áßÆ¥Þ!jô¬Ë:P|WÊ,­<4 oÂøü_09ùÝÍç¥n&5o&ètLÚÝ$Û&à÷eI¯Ò¸W.@|*]M«´gE|©nmX­_á¥3JÐµ6]%¬%¿.¶ÄAQøi.&Ût,Ä$Ch
©%¶ícÀ?"ªæã>E°£{ <ù8îÝR{JjÙ±qOb¢8¬ô"í$!)7úÉT~ÝÉ£Eüç=Ó¼N¶n­lcö|&=õuî¬â7OvOF¶FÈ"ªÄ£6kb¯éÆVªSõÆÅÛý¦J
ú_TÂ«v©ävÀk
4©Q..vym7"*nèxÇ¡ùY ½£²~°¥­î¨U'ÃD9_DÂYØ.d3§8jÚ8R¼}»å6«ã.Ã±õÉBõPKM¥(EÔ/9ï@yKå¦j@l9}-¼§ç+É·
ÃSjÔ¬Q;üx"V?±?KÞÜ¬Oü¨Dfìe%oí¨í.¯ü°ºxôaÑÖñÜ\×êq§2üæzE¹|°[v­Xë¨®£¦?­J6~º"@eÚg1ýös[
,Ö"@6RQ LÊ£E,üæ*õ>Ô,ºO<ÞÃZÓ;ýzÆY¸L·ñ6cÓQ]ª[w7oï6n
]zkuGBp+ÜqVkL¾ñm´O@@1DÆ8õ[ôt	®*ÈQiºÉeáHjÝáóDÀíªvlµã!rDBú6sÔÜÛ Ýby<=hà)`Îÿô¢s=Ï!¤Æ¦äf',R*³f%8¶Î\#6Á9ø!jÆ4\eé¦ )¸øÚ1>ØsLq$×%.Ù6ªLú3Tg,°C£ßàâ¹º ÝÍ+¶´hÎ¸ªuÖºÍ*Öír£v,Âö¢O#ñén8PzàEÒÃ±«1ÜQAi.à?ÿà *þßþÊ£E@üèÄbvéÙWµªº`1¿|£6ÌwÚV
ÒRª |ÜL<Ø÷~Ì²}øwJ²ã½s p/8«²hx¤º#9&b9»$ÍaëwÂQÚä:s´;Þ!@+a[ÿ²Ôßxc±[1³øâÿY_|ýb]ÖËXÁG>i°I¶øÃ®Mír#9]¸GÜz¹¨l/?b~Lp
+æÈv½ì\Fó'èî¿ÖV½LÇA[]Ýv
áÌx$
ÇøÒãIèC	òáëe¯M©êKTg¹§OÖG¥×·-üÖ£Îë¢2µ3*ãWg;çL³..^ä{»XÇ=X*;Ý¹³MåþöçjkÇv©ÿz`¸nÿ¨úr&~G¶r6)ZÚJRýÏ£ETüæ&Iâµiè(¼(ü´ÑóÛ4½Ç¡ë¸±Oãè.f¥ë4±§&YköußÓIWKý³¸à2 q@ãê2Ý>vbJsÀUu`¯6ñÙZ6³Ä%ë¡=¢A5ïìlo­î-ßóvËÿ-²	Ic¯|\wøx¡Qgs{y­æ>WW5NJå{f
K|Ïú=¢:Rçh©Ðýáñº²ñ´©>Æ¨Ç{%ÁøÍ3g/´gï"0vGCßÉT¿§ÂÓÝ4ó)?Ä'BXd]ôvZ2[¸wÿ&ÏM^3ê%dö+Ae/ßo[5eÒ<5çÙ¦¶ö\!)àXUmþÉoìÁý$ Ð£Ehü¦KxGÚ¼0ÏV ÞáR³¯úb¹i
°øCS~që5Í»~#?å3rõ­-mÿÀÇ­â±¥BË+¢×M°ß²×¨°80·¾nØõï A¨u¢éu%÷ùè1u#,¯§8}Lì^þåj4zb§cbO[u {^Ã×Ìýìv$¹dÖ°Dgö@·PÆ;-§}¤Vê=ÑÃëyWühvÃ{ÈxòrÉýVéáìl»ÙþÑ±-¬'¼2Ý^J{'\÷K`e÷]K¾Ý÷%Í0fénçÝ]¹'ÐW¼1R%½?¸ÓÆ-tª<Í®¯/îoÓÿ©:×¬>¹ðÅÍVÔä<1Ý*÷}Nãd¤I/À$Ù´¢$R£E|ü¦%E×ûæòÃ©nÉ1jNùgÜ5þ<¨pûTQù­çgUg|Ááì[²tÙ¼êRH[©ý³V\«è_úõµÉ
ðab?q¯óÑ±KÀHäÑkÕIuP³À.¾þ­¼LhaPÑ®ýL£ï/vô	\®V-|#|îDÅâC!MÛPÄ].ä±ØÏW\ÂcÀÍVËR÷êa£5p/[bUï­Üz­ö%JRá©9õïK±í°cU¤@¯¶HxW´p­_³QÈI·Çe^vû¦xü«=á(_æ7Òi{ìkþ9Á üL¬Â:ÉíÍ4×iÓu'ÍÀßü×`ªª²{ü·Ö(oêÄ±ËoxO>q «ür'óÂ¾¾ÍLæ}I"@´ÖI
íH£>üÐüø®»«8.¥hkËv©ÁàGÆªºîáÂÃzaÄw×1¶ÁÖkâIçBDªÆJióÜúÕzÈH$ªò<jåï?¼ïóº-ìÂÿµ=@ï'ª+ô+T#Å6Ûn=]¨a1.
b>Õñw
cwr,¿¡,;@Ç	¢Úæ`xû°s^Æ²
îDðIFµ¨DRLÌZÞÝÈ9CÕÚÖ{þ¦/<8ú$«+¨oúã}íüí¥oO­(Ñ~Ó2¯êXÎÁSèLLtö--¾2¼¢¢õmB8
Þ\UårÒæ'?ÿ,r×qÈÀ$|ÿp$eCYB[ºaÜ=Ki6òv$?Òü&k£0¤üA{1ºg& Ü±Íì¥»¶ó®{eL|lé¢@1C`Ûi)5¡Ã^jç«¾>ëdÕTQQBåÕf¬^¹»­Í'ÒF÷Nøh[¸ÿåãîµÀgÎ/%<ÀªCEÝÞÖÃ¬6;/þXD2'l"þhû´»j#®RþÌó3Ò	ÃÄKq§+E}N)²ü\3F¹
{(O|¸ )	~xÖiC{Nâ·~¯Ä?%9êW]J§ oÐt^ÕÖòo¡Ò|ÐZf¼¿©pvÍ¿gfì%øTIWÅ}QIöôïäÇºAÀó¼2ò"0=Gñ:ÿïGåB¥°¯	+öB·ÉØA9Ê\ÎèÛ$ÍWlwÆ¨lÿ%ºPZð£+¸üSEÓq¸ëá^Æ r«´L¹ôöJh¡òÅÖlË&'Zéèvô×Oä@Áèaâ¡½q3ZKOËDc½º«þ¬¯Êðâ6·²cË!¦³R+Ã§4!ù(¬P¸òëoL¼pÿ­î	ÜbKéä7µ#Èí0Ö¯X®kmòÑ­Ê7eé¾
QQé¯<¡l	á&ä×Åý~Yq3!4Ì¬×Nù¡à=c,ï½ÒÖlûÀÃJáÕoCpQózW-ëq"¶øÅ9«ÒxÞ|2QÒÃû ±üpô·üîwÇ= owX°¬áMPÊß¥ùò_¼)-w#@UBRJHÔ6þ£ÌüS©6±£Ôêú²>Ï3&&N¡å
ì³
A^Ì(.túÜÌ·ßJ3wSô[èxÈ2Àöf?1&x«.´ê(ï]#mµ½Ï(â)F(@Þ;X¿dÐµ?$"_yT`zmÁzõQ
ïÊ"Æay6)ä]µ÷­#e/×LX¶ùëODRTø{oè½Æ5
Bv1îÐñw¥\(vZm·}áëë·³aÿ~ëLË}Z)YH`SWØ¨r;³aa¬m4È¿££cøîéÐ¹6xîWTÞO<ªóáÚÇh~´?ú0Ò»3Éªßöü¿Á°ÿUµ¶£àüSÁä\@QlÃÌ,©Üºb.À«ÏXxÑÎ(6z<¢¨õ²WÝ¶dÊ©ò!Ë<gX	Ú¨úß¯bØ8}Â{LÃ®÷®³G](ÝË*ÎÄ7ÿb§ìÕ¿úr$Ô÷p
¨ê½3¡Ë*§à>%DÏ$~P¡ÛÂÝýyÑ3G\­Í¼;Fò$9Í²#â_V\:×W¼âÙ§
ä\¹(
ÊwpyKÕW5æ¼{5ÙÑ±öÃbþòºï­âcLãëÏm«t¯nçý¤±z¿qB¥-ûïø]§ÃÄÇ×°Ã¸Ûtö%°?ZJEUZÚ£ôü[X»1¤h¸fz¿I09Bý#d(
²yÏïDÛU4|	ã¤d8kìÛw¤ki]at~·-øn¹A'kâ-W sd4ÎÑÙ¹¦õ¼3ÖLG7ÓX¹5m;ÌýiÚ¿Õ}Õö­{®60¿`mJxâÛ7Mx°£ÁzóÔMDÅï#ð¢3xÌ¯öÔ¨¾¹@Ð²uy`òÏöåÎ8;îØºR§©Æà3ïö¥x{ËmöñÇ[1xýÿ÷e²HÃàB[EhÑJäóéÓÕeàÄddcÞ=`ÝÐ¥lþù>£ò~àd+%vwµ¿öÿòV¿`_ª·e£üS¨+zæMîtåKÜ"uðBÉ9Rö¨ÏGçÃDIp'êL"Yó-Ð!NÔ	¶Ç¸-£"í9ÞÏ&oÐ"ez,vÄRbñDüSc¯?¼|L	)UªKQºF<Ñßc,vL»Åz4¦cÊO3ú:³§Jgt1ö¸ÚªrvæGó0ËWPóÆöFæAö¯T
ØÑæ¾Õ/P¹¸ëXaû¶Î}°vìÔø±ñäØ¶ÄI¦ _?hÑm·3¦:ØÕadç+$¬¤o7$D*Ì;Tüº¯f@Ñm"þKIH¨Ú¯oÿ£üyX>\?×ôf®ÊAµ+x³K°pro¿ ñ©GC-0pÝk¤&SË¦Â¥Oý)79«ÿ¯§4J´¬Ý24¢£Üæùo[V·	Õ²µLª­«Êì}m=Îvðn1Êêk©Iâp>{Qÿ9ÝrqÔÊþ§¤¤/¯GùE8ÜBõN)±¡;%=Z¬j¬ïCömäE¥«M¾3ôÓ$ØS]¤ch}¡ò/O	ü½Qz«åV»´_4Â
"(­N Ïñ1×ïS¿L§BWãªÃhÂþQÓXÜB¡k¿N¢õ56®²Ôá6~g(3ªDõ|T,
U)\ö¶m<ÇóvM)VPéFDã=ÎTý9Ñ9£]_*§hä[ÛeÏü[yª®Hve{®ÈÆJ_AsF'rþ¢]
«ÎZ¥?çc+c2+]Ñ±ú ,NrrÌïKNå ¢²ç*"ðsho·,ØËRK@ÿô¤%+Rn½+@-£Y0ü¾wÑ³u39\ÿ?ÞÒ5¤e~à]S|°T%oÇwïøÛ¨ÀèV&ù_ÞÓeÊ-ZÈþñg£øFQk°«OÈba½è¼æ~÷-n­®EMÿ_Qu%Ò^RiZgdÅ=kQi­¸@»$çûòÙZPC]Å]JGâÜLºKÑ¤QÄ¯Èg¢YSfºXÉ»cUT®5ñýxZ_\ªÇ|&Î°ø)î0ÕÃ¤Zð·¿NràçHqP*}ïÚûpP0{ßÍcG²ÓF÷eÍ>áÂ{.÷tEÛzí+FOb>7+õ¦vf"ÍcöÄ=±n4Ì¬vkÒ²KÁ$ XL¨ÛQ§¼Ô!oÿXV|º%£n0»ë·dÒÛi7"R*¥·Òú¨7£:Dü¾$ELxT¢N
Ïª±YK¡7ñÈN	ÓnHvÌ{2
BBÀ37Ã µMlIh)ãÄMï^£ÏçÄ°`]ä4æà¯w/Ómëk§ÿ¡ÇsaÑÂ;*OcËªÐ¬BÒGc vyãQH½I³Ig
£21Ok!¦FµMÞ±FÃ*ÚB­°^¯bï/Ìg,PiìÊì·ôógV1#R{t#É+=Ëk£(x5`häóßsS.;:i¢lÖ¿·çjMÔ©Ã*óJ/i[QaÚÝ8Wó6ßÍ]/nU$>¨RþÌP9×¥¼LÙ¬é:»ÒºkÜ.8;!OÅ5í¢ÕócÛiïÂ¤Ãx	%$%µÐ}~£8XüÓÍ
¼· ïkÓ4SÎÜ¶pÀdEò EfüUú(-az;Î#¨eøCêfª$Ñ`Ætf«`ÈÑÅülé(À3~É¥ø»æî¶­2&¶kõ*
^Ð#\A2ßY|Ü©ÇÓò+ÞéîbWÙn+VÉÇÅñi-<mMÏ¶ÚôöÊÁ$Îµ&H Bìê9{7k´íQ:&!×è¢J<nÊ)æ+ ç
6jÁö¬á|Ïtc.Ê5Õ/0(
ø}drJÎÈÝfµ\$uL½1°Þ8Ó%ôËý0·ü9TËJ¡d1,iÆ![Ép,±{ÈÀoo¯³¤Å&Ïö?Ù))}µð¯¥ýÍ£Vlü[_àó.à<çtr7ZàÔÌÏ@Á¶bªîÈ!Ï-yq0¿OoE YàÀAåfÁ+~ªâ@õ®dÚ»z|Õ:OøB¬Û[_vú\×ôb°##i7¤ðÓ B!æyßýY_=
[O]*òU$ÕÖùF4,ácûýO>!{üPÔ^8ºQMêÔyë<mKU¯»±ÏW+z(o{©CGçáj¿/d)oN{Ùq=é9¨ø¢h[Rï kJ!ûíwÄÿZL#0±Iy1ÏwN¡üu*1M¦(c¨û3ëByã¤¢,¶ÐKìÀ³KIhi>ªíªµ_ªo. £?÷2áwÇÑÏtb\¾ÝÐW?<ðb5Ê]­oýþFö%´­´+þ¿ö£@üS¨)«XÝ)"Ð¯ÉâM1f4Øcz¸Ï÷XDZØÆuÐñì¢WuÖº+ì÷ÎÜZK«ª
:»3%²Gâ¢\r¿JÁ&»m@V¿¡¶óàã¨)÷^ô±-Zo¶¾]in
þc|ø¹9ßh0âÝZ[pµ~+ùW>öÅáÅ¢ÎMõóDðs(=h½14¶£]á2ß8ùQ¬~è¾¨¤/¢IéÁ­´o³nÒT á#ó»Æo^¦ÁcèRà©Ã²÷ÆÖÝÊX¼ëéu÷X.Ñ¾åLqëZü;#ï7Çý,iõO R3©Îõ©ËL¡ä«Á(lG¸ëBGÉãÊ9Jü8'$l ÷ô¼ê®à,??}Ù/ädI/ÿ
¯¯ª£.üS§ìÉáN¾r¼å¯÷åûµû[,Skùoç{I35<ÞP4ÉóÙ*T ÈÄ¯Ü}°ÑýgªLÚüëÐãXÙ²Þ!ÔÁ©]'$¯»:¨ÔDC¿ÒBS&ëªçVdÿ8"¥êä\8ZÃ#Úlþùµ{ÌÑ&¸ìÞÉë?ò:*Z#ÛxR.=Æi7"Î¹Ç^]ÜiÌiÅû
eOïCU/'/ü.YñÂÚfµTâ³E& DtRËôû÷VRry¥Ñ>+}d§°ãdARX?åKÐéEÜ¸Uñjxã%äZy?#^Æ÷ãóÐX¡»4²8¼lhäk7%FÇÉwcµ-&MUK`­­£/¨üS©:E£ýMÖgB.þ±
·ã:ÑÎNb­é#QP_gÞ¾ÆûÅIVgÝ)Í:"'åøi'ÌÈÒJ£ú½]ÏÌ`µtUà$p$Æ*jq£ÔÞ±²0ÚÐòïØ©±Ó`¦kaQS«#	[-p6t³ÊoC§¾]cïx¼äàÈ®R³E]ùx7>
@ÜÆnã"ué¥#*¬$jn1²âwæOw¯;\+®OF-veØH1¦ÒÂ&à¹Ù^ò¤º¥iìÐ8½{å»f4e
ÙÊÑ×x¥ÀG05[øÅ5-5jÔ5³¬ø&ë¯d£­BjMøäÒ;òZTù6:+[+I"}U%
ÿ¯À£¼üS§ÔÎ:>ë¸À±06ÛßDçÊðÕ^ÐUÒ^ê|ÎB±*ÒÓoñ³ÉÆ®,ÕF@¤·hi{Ó;Bªt¢Ù¡£¦£P(föÑaÜ.YFqxuL*Zã[=]
^Ö·µÆÁgBS>"êvgQ'~¶nÔ°æDHMîG¨ÅCÀ­Qà|]¹þOÖ·´)Ý*ùý|¾{<1YÂP£}¹D´«6ØòÕÓÓasA5î_h5GÏ±LXï@,¯"ÚgÂTU")è²©è&°£&Q©J\!÷±Ý©@oô¯%¿_öä£ÐüS©6ÔÇ»ÜÁ´í:ËñªIÞzYPìèÙÀ¯¡nÓ-ânîyÀ(DxU±(òÁ?¶Oå,Òk>3FõVÐÅ6«Ö´7ÝI¬PÏTB}FfæwçËu`÷v÷}Q<¼ÇÞ°÷iæSæN·¥ÁÄv¥CÕµpüÅÑ¼À)UAEÄtª¥yy÷¦ªÕ²!Åj°¬i§×Wk àÅ£gN²J¢lÇ´]±Âã6l-'Ñ¼ì©ê:£ì¡Ã[FX,[¾ÔÓm¾¤©øÍ.ÁWy{²byYüí%kkkÿän¿£ äüSªSñ1E÷ 8e¥ê÷aøW%úßzß\þ#ÿÎÑÛ]×?¿Ó1lü·´Êåö¿¥çhÔFt­;¢(¢ù?ÕqbâAfìLEOoÓ.×ÁJYPaÔÈLæÂ®=DV¡ðàù}µµæg¢@CâRÿ¶*Û$ÿ	FseÇð]ç
þ[DÆ&æ9æbV÷¥þ t­UïpP°>>3·'¤V'ï3øÛö°®_óÛÅÄôtBAºÆ·¦4â÷Ð5­æ~²YßÞ
©É_¤¡Êât·vSµ-¿åDõ6T´`à,³òÂAâXXînêÙø,GiÏ5IU3%"Rb@?IR£Eøün¼®:,H	ºkØ]Øà¬áLwìÞ,'y+èß³{ßÖqÚ4Wg\Üªïâ_5úsb N*ý®êßäÅHÝ](~¡6iüFÂâ`bÐ§±%kãºw[ìÝiå­
fGäp)ôï½ÜÀ¬¾3£H<U ®2£Þy)zsGÔfAJ7÷õîíP´®6Z¥ªé±a<)óDoÙ\ÎÙíÈ*!ÿ±¯^Èó ¬Ñù¦%Ö+D£òv³±É£U1­câ²¬¤ó¯fË«øJ~C Fïãéw×ÁDiÊ}+ëÑ_â3îö­6-¤|å«ª%
÷zëýó¨QîÄYÖÁÈðQÞÐ"µ:Ð?ð?m´­Ýªª«£EüS¨aT«äb,Nsþ(ÿQIWÒ^\s5§b÷ ¢aÖÉÌ¬ÚìNï*YtEVëùYûÈî.­FíZÍR¶
éß +SínÿÛ Í/;Ð--þÜ½Ä³ÿ.Å²òE¥v¸OÈR§`	
`Æ±b}/õ #¨B¹VÞQ¸Pï¶{ôÉ
?)Ã}Ögh0b6?JXt#´æU»k¼S¥P<(BFïÝpöÍæðGs`ñ¨¼tmZ÷!ó~$Þá¾×ô#ªL¬ÅósÃ>ËÜêDTfkê®·¯ªáîÀmøLèè@évæûîã'!býÆbÝ\ÆsðÐìT[º¹ÂñMÙq[°OoÕa-2Y¢Ð	JBvµ%·d¶I°£E üSBæ;U¢§eÍ;¬ùîËÜÖ'J	ó£k¤Ý¼)ñÐBFjÚúè&àë¥²Áü
²ÿ\h¿Ý©¸6õ;ÆËðîaÕËwmA\Õ)à{éêoK¾ðkc´Ý÷M4¹ÒµÀÐ}ÄÊXX¾Çÿwâ5z
pNæo0>Þ¾ÝjRûr @Æ62ïó¥¹sUÚÌ<º
®vÔ<`hÌ7¡âBOë5Käw}ÐA¿zd¾.GÕ1ü {ÖpÎy°)3'ù¬ärßa¾vogÉíóÌÓ®ÿ²
T¶³âÚpÁö
(gÉýênUfw®#þÛ+æXYl¹°À`qÅ¢35Á¢º"GRx(eà:'Éóv@Ê`a"@ooÿ¶@´ýkä%°£E4ün._¹U6ûYzç5Uø£¯Õ»¾-(¾­ÂÈ&CÇ±ÜÚ®RN¾ûoyø«
ôn F
{çDê+®H?£[:Å?JÏ´D8ÌÎ4æIÎûâ§&ÄÊÝ¼[¹vrÒÜÊSë2éuqÀJd,âÃÁn+}:½V~c/Úw½h&×T@©;±-
p¿ÐîrÑ²£¿ýÞVA$êô2ðÌå´ût\bT,?¡:]8ZðsÎ]ÝOK>Î³8uÀu	f4fÎ#Ì'v·XÐ¡à]fSÍé¢P¿Âc3VÅ±%{@Viö
!óy]a¡(j¾ú»å·´2¢PÁ6Íã'É¬éy L"Üý¸ÿc.èÉËFI°JIn­
õÕ£EHüSFÐÒ7×ð>á69ca;qëÞ	òaÎ)!)1æb&O.;ø¤ÐëiVAm-R¸¾ëy×2'¨×¸IäôÑÉ¤Õ:ÃúMãúM 'æ¾aÈÆ[aT8cLLãié§y]dÓ`îmvÔÅc^¼©ÙZËU^Ø°8!¼O*m*©¶uP/é7y@*gZhRÃVl¥xzÛÎ²¼NÌBv=×ì vaùámA3ï@}2_röé·ÌI¹$¾ýÛþ«­0¢0¥ ÊWx#¢E­cÙ¨ûh¹¶2}ûA½ûuÝ?¨3ô«ÐØfSÏªß µnEþBÿÛö'jðnE£E\üS¨&«]{p½O½Q¶X»e+ K*f­åw*ÀÁ¾¤ÛÇZÜUê°(¶Ê?Ú"¾ö(cämÂêªK0[HÏgÓ¶fÅc
56C/c5æ.P¾ÎæÕ
®ô:2ÂúL­Q®fö´³zMù,]üÉÃ	'²´Æ±³e~e9RKnf&ø(¿}(t<x?`N¦¬àÛÊ!Åw³Å
;"ÊØ[Á 3?t^÷iÐûÑs¾FÃèã8â>*pªfeHyè^dàg~*«>Üg¾âëÚb1o9~KÝÂ¶CôêþæËùò¯­î	_};ÁI{BÝz.JQºA0 /öÇDfTcgkà[$6ÚOÒ·ij­ü£EpüS¨Q¢w÷ZòXB»RU¢¢ù`>Ûx÷"L^£uâ9*ë`{²)ÌúÐÍ´L#p%;wL¯î~ÁÄ´»S /sÿYs÷8ÛdóúL	ÆÏ}å¸åÕéöf¯{ÍwÇÑÄáN}hÃüÄ¿>$(?dþkÎ6)Fa9úµ÷Ð\Æ\mÕtK¨ZEK49V¿ÀhâÊ¼^??´Æ÷äØ}©Ý2Öà"|ì ±Z×K'xô2¶Ü¤7lhmÀìbWL¦¶Ó^»i=Ú4ÀoOuÚ½f±ý¾ÅjA¨[7ï½7L{O¿>ðÎîãzNÍùûxÏ	?tj	öÄ¹¨¾0¡ô­ïÓÄ-I¶äKÿM¿Ô	I%£EüS¯)	¨1ÁQazÐé-Î$ÞõDÚ(¾ÅàSäEhÛ W¦kcq¾_H>se;ÉRf-WÛ"tÓ7r×ØÏ¹Þ$.Ùk4®l`}¶\w';BÉyØuÜ¯×¬ØIîx3BËT£)[Õ¬h#)G [DPiÊ:%ÍýmUbAþv(XënTÉ8Ä1Mºi'º¿ö	@+¯Î ê^ ]î@Âú G~¾Ýn'J$AVúiÿ÷{¿Òà/V{`²LÂc&³¹ÙÑöVÜO_
¢jËLRJ1SéB5 Ákdc'zDppZzOAa5ñ¡IÑ3Òª÷òL:áêO¥ÍG(«ï[mÚI?Km­éhY6£Eün.b?Û­;b<zw¸s¹ï!:ûÂ §âW1Ä%ôÛö]´>Ò0ô?ë¤_xSpÞíyV¨ÁvÚ(4´/®Uþ¶WK¹e:£hÜ7xë.ËkAÒHÜÚ!×³B¿¸ÓÖîìv-cbäÒòü·{ôb¼5Úý®0ïBeø¤.
Þ-øöNCLÅEYûôèË²gIý¬¼izeÃ?ä`êé0aJì
ÿ%
"«VPlÅûùk\`ý1A^jCsJ-Ò¾BAhÇo*ûoèá£/coYéä>íSàíÌgÛ¸v­zGî4Ðk¥_ÁYn®0;ØË_±ïgkìòâbUOú8ø§b@fÿ@üÿÀ%/£E¬üSÑ³á@"¸ùÃVè²¨º¢-Ó3<b1Ï°vÜcôDúÂ#Ü»>cdÕª££"uÛüTGý+Ýõû;LÅÈ6ICþV;TNî'ÖÎ+brdëÑ n;{økx?WYíÒ:LUïèä2çýGHàXÊ]I×dN&OßÅýÚUë|«ÝÎSýÌÜ
9äo(mÔÔ0 Dm2Ï³ýEå Åûªiv½(}.%û[XB>÷Y
=
³ ô£nì0|67ê¿¢F!¬A·Ê±äÞçÐççÜ5Óö]ZÏ¦ÝOÁmqÜ]òqrºfTõ8o
4:Þz«
¹ZzQ}& ûÈÇ%oÛÚßÒÙ)-ÚM¿ÃíY6£Àü¿w4
]XÂLwF¹ÂÉýÞ_ð¢kÓ|ÒÕ¥m
Ñ:ï©hG«ñh&&VaM>W`»î±öÎ%­JÚÙ0?¦ìeëè­½!W2¤êS£¼FsºnkÓîÍá´2±:©¬üË-ãU¾xC¶']¸¯_P·:âÇP/iíóûX×"Q³7òg>ùí-Ðb_O¼ÁþDë3'£¡íç8ð°tdi°ëW#é8BÕ;Ú×¡xS¯"¤MÓªPÿ2­>ÃJ~PZµáÝ ydÀeæÕ'óJÎ¡RªÚ%!³äæÆ_ÏDý«_¬Ô³&èvèðÌÐÓµ)­uRù4îSHÈªÜãk0l-Ì³ì^o*Ó£¢Ïí:¥SPÌÖù~g+¼ÜÌÀMp®w úGVäJ!×[t­óØÐóíÃïÐ»nW
ÇÒ»÷'ñ«ßÈ®x;ñ¢7Gé¡ù;ø]°gëgkþ¢ìwÊ^¥é9e¶"MÕtIsi»{JdWÔpPèÉ¹ëÏÑe|ìôRv2ÂtðzhlÂ+íAkcÇ±1ñÉÃ1ÔP¬³|DæMÖ¬¯(_õ_û$\6é?äÝ¤þNëóÛ»$1£·Ôü¿¦æêN¡¿.®é£BÀ×3ÆRsk&çg.'ÏÍá:=mÅ;¼ñ½?¾dSÑJç[q»¿bê'Q¿=[Í¯dÐ¤¸Ò>á`F§áß5p°Ø©
ßvY|×á÷¼mjCçn2²ßµÒñ
LK¾DÈ1ó¸¯§ôºäÕÑàë¯²}»_êîïr±Ã´¬kâ®ùåÁ¦Ms)¥»±©]ätø?T@Ì`ÞÁ8DÁ,½çT-áCfyÔí^¿b)n+ºN¬WôÉÓiá[:Ì/[9È:Ti]k2¢ !GÉdÚeØ²ÀìFe GÛ¯ð»"þDqøYå½FÇöD`ÿàx$ÂÒ@¤ærë;¦ÓÌS8ôG+¢ Èf¨Å4y0ÕeuçÆuc;aïúÚá¸¹ó0t3$µBAÁ¤¥îÄ½^ØãªåUzº
(MÂ7÷ÃÎgOq¤Î¶eORþ 6Û²RIøHÿ¯¥þËC¶uÿÿÿÿÿÿÿç¦£<ü»¢Ðù£<¼0kë­LC»©Iÿµ6åQ§à¾¦¥dt Í®äCwO¥::PD¦ûI"½,,±¢SöB"1Â´Z¡?ë¹.Ás¼Ò=Ç9pðý²³®¨õ?QVë¥×0[A)õboÀ:µ[d¦&ÅÏdp¯±Ýé9J=tÑåµåÓz#Øf-ÃüsÎ¸ ¦ÇTr[4J´?4óMù8tÿ¦áÎÈÖ¿ó5ÙÄnrÂà'süç£Ä9®É<ÎÚ"årý\£ÞÑåCäé0»w¬¦a5ìúåôýVÝ2	ß´@áZauâ|åì¥^å]xãá´JHòËØW<nªþÚÛrZÈ»P$£Nüþ8å¸{ð8S¨à¢r¢%"2ÕITº®;cÄñ»Îue8æ0tg¬Ý<±B"¨ïó(9jvk¹³6OçâbØÀY7úë+üÑm#Toú×#	oJ¨=ùpÃ«ÅnI¹>¿#C!Æ>&)¯Nb¨LìÙÅG+Ú8fñÇ}±'àw¬¢âåUpWY/ÐgmnÝ l«)·¸è's%²°Ü÷Ü{á¨éÖs[rFFßîQ á<>`¨öÜd"JQh&^©qÌfðõëððì5ycÔ]mebÙMN+ÕiUÈ<ån[ÀB÷à(Qjh(Nõ´Xïj¡¡ýäæÃÒ¿ÙOI-ûßü>JÈ9vÖï­»y+Io`$lµ/íP ý%£6(üç=ÖÍC5d¡ÐYaA[½ÿ×o|<ç>s4h%D¼æ3ÞiÌ «Á%ôwøÉóÎ"r@O`ÒBêvÀaêÞj|PgFT5lY÷wÎõþ
± ùà@WOÎ½f2nz;W"×Ò×ûõv¿M/	b]Z¿v\,"[}9E#Í3Õy)Ùq¸øVF¿Í­»ú©zÉU0´gqTÀ}ÖQÌÝ¿>zÅRÓ|-°D¦CKûZ*r Í~ê.JH­ÙËCÅh>@!º=$)Fv¥ÁóMBÝlÙ1vi_'ê^B
ø¶'%Ë¢ÛKV
xA£UøðgN2°	7%­Ñ2~ªÁjv£;<üæM4®Ü]ê	k
PI*Ùðæ²û~tc8RnçV>îg`4!ïÖÅBØ^Å³E÷Z2 43múÿïÚ4[¯W-LS-!ò¡@VSæ|¼z]@ÔñFuÝßÒ:y{-L(ÂºPjÑ}N0_Ðÿð¡J ü`á²*&§p¹ÍoÒ¦ý¼´µ&&ÕuX¤Í÷`^øyNÄ;A¿_ÙõDéÝ§ÔåÙ{{ê1Ñ7^ÔW)×5z¬ôd§ó©S,>7®s
Ïð¼L
ÈÃ[rPñ¼«àoE¼$5­ XÔPhKND¾=:Jf]iuZH2&öÃrjÉ{e@";!BìH
·à[!;H´+ús£APüåU§<DÍédM¤î\¾OõáIÃäÓ/þ-GñÝV¨¥èK«³1&Ë·¸ûy÷N¨Àòè°³µ"
&ÂÊmmÞÃhé¼%¸(V)úax?bN:ªZ¿-©Réiê`×{ÀÕ¿Óñô{þ;ëGð!WB´íÆµ)D¹rOÛZ<@X|ûF¤Âp84¶¡ËÅ5Èø­£½Uª/4rm#¡ÁxÇ<¬^û0pb_+Áø('n>«2Ä±»±î¤Féçö7Àg/ÍÒÅb{?9ÌGNîh	D¹Ì/¹áêÐ!º))ÂzÑâV«Ô4T­5ZÃ<Þqn$¯©öH¾ûÚ.'+¥k`±)
´ ²w£NdüæUjéÏ±<êüHT]~¹ÑMÆg¦%òx¶Î¢ j¥xW¨[Êä8bC}ßÏ2Gz0OhÁ1rù7\çÌ¨]9b\~ª¨:É²ÒÛÚHL']Ó^õuÁ¨*Å°§Ùõ	dðÙp4,¥yÁ½á ¥³f¿£Ø[C¹'®êÆE·¿3ùU<Ì¥+ùý§cÍs¬cDÄ`|·qðº¢øìAØo4¥úgéÛä¾4ïi$²=Ä¯p_õÿÄ}õ9î{¸Nd¾Àèe+Ã¹wÙ¦Ì)Âñê¡ù5ã^½òôô~x`Î_mÐúñ1mâMÙªP·zEåÎiðÌ÷Èz{²WìbR4	TÏrÔµt¬eB(]íoéI?ú­T"w£Ixü1¼©´ð%ñ¡E~Ó$àª.y¿Á
`õa/¥¤0_qÐ«É\H¬âiÑâ]¦p­u7·G¼þ¢ËYßm îíb2I©G×
>Þl±ÞeFÔ35IñÔÖÅ:07s&aðï0 µ¤Gá«ì¬ÛDT¼Çxi$îÛ°ðd3=3¼\Î¤«ØÚã®3BãcÕk·:&¢3­Ö¤	óñ4L6£i#çÀúj¬¶ íÖö¿3Á2î)ÇY1ÁßÄ@ÝfÝÖ)³ä÷Øk9Óß!Lxs¹KÚMzÊfÑ3ÅÄò¸3SD½=¬WÎÁMu:Ê{§tP.¦cïÈÍy´mÿa-$íÿûm¯¯&Bv£JüÏþÇ#
¢©(Áe,sÐ4 ¶ÒR!Á4E8DyX¿ä^]õºç=Ç=¬á¾Sc~ëAÿð9@MÎ}ÙõÌËÓ¦Ûh6E
5³Nx<çÐïc¶6ÿíu¹ûqXFý.K¬¼¾mß(×à÷uKÞ\?ó°5y1pÞICÆÊî²}-XÉÇ¯ÌÿÃû7ØdÃj¯©<PÎ´-ES7bÒ×ºwh©Ô[%í;RægZv}ìà]ð(FIÐå5ë^·ÁLi%:Á¢ )üu0ÛAY*a>èÈeÒy»7ácqyt4¨¿eýÒDN2 ¼oÚèhá(xÖÂ'']±¤×ñ²sûödAâ>,}dûÆ¨|
õÓ¿-KÿÛHþBRP¥ÿjF£M üÑïRëTa%¯$Äe l¨ôæÅ°GM¯0ø(ûËPÎ_ÔÚ´(?x&Ûuº¯Tpiü±ô7
Ád3®Ëÿèr°¹0½âÙæ¡xÿýA¹NJJhðþí­ i4&l:Ù&¹.Ö²\ç¼êG}à@má×Ûâ âÛñµÛ°«¦ë¾Ê&½dµ/}LÀ=¤9¤K#L¦g£øîq}ÍWéç¹./Ù1J°ÅÁ7[¹.<Ó®¶­Âiÿ«»EN;¤	Ï?(Í
¢
~Ïõó4^¢È¸é¢BîÉ;]S5HJ4g&oµ¦>p/
H¨}õèÖ`ÊÅ'Ç½ÝÈhÔc÷±¬/ßA0ù!tË%öÏ¢-Ûbvÿl
$ÒRJ£G´üÐøB£]÷e¿ ¿8í_¯¿é°ønéÐæàºõYá-¿ÙóJÀ¿¹ÓÌßÇIP
À`¯ú§¶Ãü,pTþ|RÛÌÕç@G1&ÇÀeòYÐzOo%çÚþ¦z.:±ãq²2@:HX1#ãß{èßËÓ¶S7Y×:m÷LvKtF®üòjîÖJÀá:Á_¿;­tÔâtÞ{ê%@
F(¡%É8Àµè7µH
Ô¥yÍê×Ýk¨ÈU·òü¾
þ|ó%ðøbùÔ¹¦ézÏ+-ôÀ¬ÂY+­ûÉÓV_löæºRÍÓzM@ÍíAÜÁ\çh<¼°ÝQ-ößNi@þ6ËwÎÔPF³É~)ùÊÿ%U¶ÿÙ»U"@õ
ÛúI\£FÈü|®"Rü3äú91õ°¼ñéªXÚô2=ÙC©¡eÝÁMÒâÚÉd$ëV/ý(ZÝ±ªÙ~UMÎf¿Dó¥ÖSùøyr®»D»³¥µ:\V¾©
¢î¢j¥ðÒÜÎíLGèh$WM&F¦ßlª|Ê"ê4ö`·béÒ¯®F²;fÓñÊÉodb£TÈ[!¥ßW¿h³ÊÖV¢ ùçJjû6CM_aåØµh`8
TÍêær»Ca_¶¿CÊtK	
w©ôX³°m»ÎìXy;òª=úÍk"Èÿ¡t|§_u\?ÜcçµRp©cló¥Tõ>×£í Ìe=ûj>ÅjdÒô¿©ÐP§;ù£EÜüåWv*°pñ*lÕÙ&¤)´¥6a¡%þÏ*ÑßA½³´OG8kÆ_c[61GV"âV ÆmYÕ±;ñÎÊæ©ûb~ Y$Uz7¡±ÓL»_³ðlq¨®W8\ËÞb\`hðýå«*Ë;»÷mC'÷çíãåu©^®l£*wÍªy5¤Sf'hsÖ#åc³3ªh'þ£sqÝPÉ_/|¬'¨àG{ðéÇRüIOy4dëÁÿEÓÝôE ,Mßç58N=ëÌa·þ=m;jq)EGóßaý³Ö¡åºN­)
UyÛ¾i'»\qh¾Ùm­"¿ÄÂ¡Ðö6z«©À§óý©·ÿÚ­rÑ2HÜ£Eðüåiâyó,rMúo5íð7  L¸ ´=/AOwAÇ½á2»Kcd}ÿuÏfB3¸e.UÃû!NE+¶9@ä¨¶fÎ!UæÁe^¦6¡zLm«RS®ùá~J«5¦&:bà®Ïr]¿ÿò!xJLØµçc\Ñbqú×àëkïnÇ[£m+(âü_úýÒÃNÈÀØéÖ^y´·ÖÏÎPo°¬3õÞX£}ÑgæK¶¶ª~EÍ;#¯wwÝß]wäü-gÎLa¢HQ·+ç¢'Guñº¿ÿµ8´P"Ùð(¡ÑÓÿÖLý,yÈÒº:ÀÂg	±ÅxT\ì|ÔÁKCâ¥MzjM®)c #dÚ}Q)£8üçCÞ(fÿJò¢ð;×b·±®¦ÂL ¹¤Î³m­öðh
3S´ËÃr4À]äíÉ¸2%:HåÙ¤ÀZ kÔ÷76îÚz[´à%yáÂ/¶>'`àH
D	°ä:èÏÇ[TýÎ§#±H?Nu×®~ «5Ûùïë43-¯(ý3"L¬LõÏqhËÒXkå*ú	íÖkz#ïÑ÷©ÖJ7|-PêÕD|ópÉbÌFOº²=ÎîH4ª¥´&=7oÀ
0ëL-áN£-ö¦u´=YnþZifögsÌ7«wM0NI!¬ÈÑ:2HÖÈÄÑ2KU$£?üç=Ó³`}ªîJÚ·éü3ç
ù>ª?ë¡ë
ûIÚÃ
	<AÄ~;"ZêÏ­¬â»ÇqÄWã&Ð¿t/6¢èñ?Ñâ{å¤¼Ò[¤Öã±é
ßQ´O²ãyÜüÃæC¯ûz<)lÅP|õÎèW5Ñ9£ÛNVÊGÐr.ïÇ¬5¦\ôw/£ÆIÅ©*§PÑôàÝîÞØ$ùRßø®gt«øLÕ­AVè¾Þ
e#ôÑ+¥EâpHi`ÌhG¨Ê%l×Âû[
ö}¹³ªÐ)íØ¯ïqç_¥«³%eª±A_³Ø
ß Xsûm¶2tFþì±4ÉÅn¿Äü\Â6ÈI m³iäì¡&Ô³£A,üåiêÇ¼Pð¤°^ye
Oz#S/rcW«Ã¬A&»6m9&Ðñ[îÝ«q`·­»f«ø°:,ß>UÀapeÅE';±tÇÐoµüþñÚ÷ ëÔL
8ÊÁÑeqeÜÜýúÏ+ÚUCÒ*0T£Òß&ÁL]ih:Ü½êëOÂÆ¥<èE ëÎl´æ^ }Îg¹{T*Hû)g
À*Õf@âwR½r\ÞÌûxïdõcÛ-Í_qÕ~çVj g«5Ï|y¿¡îXé;8V÷K¯¦|Z3~¯ÐÊ»8ðÔÍq¡¶þª©01^9bÊZ·}w0+K«¤#yGX¬Ø&A0&û$Ø
þR@7_KýªÛ¶£<@üåiÖùßLûâeãñ³`|½Óúý²_­yôaÜEÄ4^,ÿ\RpÕDñ+¸UÐt$#° óýÔMîé¼RáLlt)Ò}ÝÉ6ÏðåËËZËLd*I66U¼ÇäÈó/Ns·ÉK[A
JJT~w´4¾yJnK­ñ7×äðÙDiÓ@ð_¨äOünÜÎ
1N7túé«_ç~²ZØ62~HÊo"F=íMVNWSlDËßNsWwÆÐà7òæ| |¹MhæÆN©*þU4<A½è®;+¶H×ÑÄk¦ZIº:%Àr<Ï%ë|z*%Î/lQ×ásõe¿nÇÝ{B^²¦Sæt)é¿þ%&Û{`$µê³¶£CTüç>Ô¼ìÚ­:Ñà,î¯8{¤ÖÕý×uDÄÓÝLiÛí:ö×ïÿIÜé»§áïÉã¦J¾
 þÐäñY|/ë oQùâÉÀvÖÒÙæ+ x%E]`jÎéFà!ÂF«¦"´wÅ¸üÀ÷L@ÒV^4hÄØÓ`4¾iôÐ72iW¯WxÓæ.û¶è-?.,«ÖZ­Uø¥èeçµp)âWiÌíI¹ç(ªÎù$ÇÔåp<Èç:#ñ¯sêÃÆdùÍ+ÃÇÝÈÖ¦\è²Giaì¥Òelî{Ëqã]çtÁ}ç¾¨DÖç*ûïÇÑc;·Y.ª Ëñ<¼H<¹vfüím¤6J
ÜÇ£Chüç>ä~¢Ï£rùíLq`¦8&Xü@B¡çº ¿â]ZòyhÇ«8Ñ£*»µå"ó½æ~"ÐNM&YßçÑÔÐ¶"g¶¼äh×®¼­ç@ì~ÔuðÊ9´Ø©>#Ýå¥ýÃh7Nu¸6øüÇñÒjåù=3´&RÊÞ4~d\º îùè;ÁmqL<µMáîWì<`­IìOÈq³GïLÒZ±`æ]¬/+¤?Zr×:ÑÙÐéb<á(ô#í²"IUÁæC¿Ué`;7OîÏóY®´S¸7+*ut>Gñç©ûCy#Z¢LøËßIê-Ææª¡^ù[!c©d)ÎÙBOT­¶Ûh6Éê ¾ÚÓ£7|ü	Di|ÿ#<BÛ>ôlì¹iG¶úP(VÝàcïªÓÚ³ô^G#â·Õ!°Ö%bfG¥}Õ´Q(ì²­2¾Fû
Iq>&)©id:²|å¹ñ8.#¢Q|@½O7v"C(Ä3H<)R¦@gDndI9Túr¼fÐë[Ò[c,ùv,¦lìR+æHx;[Óod¹.¤1O6RS%	5=[ä
	B)|xÉ¦°!¯ejv#èFÿ,øa}-ÿñ²DFô,<G#3GÖQã9#\SÈÇbAâ$AÓf-qø«êëõA-xÖpE¾á¹­íVL
.f,tÑ/rÔ)ØÏ G°»ägù	Øv´
üëÃÿü£8ü.nªb½pªeºàß\¡=E?Ñ'ðhüÃ=xe|=®Û4,v.eç~ö*æ¯`"??
hgmÁÐ|½.Eþ(ÍÈswmç¡7ðtHU¾xî¿îaí´%Xg·+ï_¶?J¿óã+ùò()rÚ3Î"&Tn:7*ÀF¶¡¹9+ÐíMÄæ.Sã.qÇNi>jkbk)ý«"-zÊñ_xê>îPþ3k2Za¥Ë:sNc]¸5ÆêN0neÑæN-?]õç¤çmÏ//üÈÒIýB¬^ä8¿Fîõs×mx(ä^¤qNñ fì>"æä2â9À2Éinú?kRoõ'fþª¶£<¤üÐD ¶×¦.dJ<uì\ó{¢«cþ$¦RßnÊÖÇ¾]LhoòG÷ú?PV1æù*$wÏ£ÍØxÇV¾"¶½2IZáØÛ»Þnè(o¬[Q@èVö}[j1õQÎ3Ï_P/¬ô½µ½«]ñ0d$U µ;:£PëOö£¿1·þTö~ÌèhlÐCâÇÉ¬éÈH%côe£Ø$[ÐêoÞ»ÑÔ 8Â¾ÿNy}°7´û2!'µ Ñÿó-^®÷
lðpliZH
¦îgÓòÍxÚa\Ç¥Õ3È	U1ç2NïÆiÙ`òý#á/-Íîöêô%Ý'÷/3@µ+i»[õÐmÿ£A¸üÏþt'Õ'øvYãÙý¸pQíqå$¥}¼_-*çñ$Ü|X¶M}ÙâºÒCDîeÊhÄiÓA²û´«ÂâDCySÌxÍõ`ç³ßZ&Ë	Ck,[ç}×aWeÍÚ¶èþM*ä-XÓE#ÎÃîP¾®ªê¡ïìþa,]ÞÚ\<<?ÀÏÀHT°'È(Ê¸Ûú®|eçÔ*AÝáÒfqÚñ¡	ûé¥GÍ#y*"ìÄìê-Õ´©ÈÆT2W5v)GQOëÌÜ§}MÄ¢ÿ)ÁÃF®>ËzæèjV«±ÀÛ³útÏ(»«vã9rEUá/WÿS6Û%Ò%¶ÆàD$ý9ëö`+b	v"U$ ðl
ý£DÌüt5¥5>ÃæÞ'ÊDÊä¼$÷~(àÎØï­ÿKìÖ*ÄS®9úæïË°çvîµ¦ô¤þt#«QáiAFãM¼»Æé¤bHq=%õ\·¬Ý;JR;ûÝoaígßáY²ý1@ì^OkaÍê
´þÜéÇÙÙÄâMØÞDãÖFB­Wp2æï¼û©Uä[}¡HÜ·8­nºQ¾}äKrÍ7ßiq¼h¨]ÐÑg¨0xû<ª "VêZ¢`E(\tno((x¬¥!´ØéRîÀo-©cïD4ÎrîxR¥VEÒºàÈ¶<èÏck¹ñÌåù" Tf¥ÖÆOxôÃUoù	vÿÀ¥Ø6£=àüÿAÊ­<J¶e²-q¼Ò0ßJ;[Eñ~ùÒM4ÈÏf221ywO_ã#YRBRæ}Ä?íLP>x*Y«¼¬
1pÌ¡"MIõm²¾òmJÌÖ[,^¬+PØëúá`¤¥@,ëHÙÝ!mÐûò/¢02Ð:IU-UëñO!J0>ÓpÞég¬oñzPN,8·æ·	­ÿy<¥õYÙ¥*!kOiø¥~^È@fªhÖ= ;{Dêyáî/!ëmtßaîéµGW»ÉÇw²LQS¨úB(m$g}N!nÞ§Ééágö(¶hQIiÿBRäÎþC¥b jLbû(x«ý©%-¬v{²7jIHH~5^¶·_ £JôüTÄþ
F°ýHçòA¹ÎÊ³fçFááNÚ9áÅáÚåw10Ä¾ÏÎ»¼ÊZÂJU2Á¸¬x_é½fúõc8 8Ì¾ÚpÈ¸`9®±å1ä,H-ÙªkFºæÈ`ncÛIrw&w~c½b¼
;Pb³»7§eü'ãÛ:)+$uíL
?ô¼>®}ÜéuJ¹[8Øòäê·[øÝçðSS!5}ñF´DùÛü+æñ
³µø}-ì`Üºc²ÒæÒ3ö²ÛãÍ?lü7õ7{QN×
z°Â.±ðæIî§rlÒÞýü§}ôN"NþÏü{µ>ÍÌØV¢Ö1ße,%¢K :»s¢¤Î7§w1ÄYó¶êÈÉ$ÿoH?è6n¤£Lüåh9g!²ý"³éü4R!@3¡ê>^´#ìËñ0d#9àv±O9AiË÷U®·ãûI£ã½ßE¸tç:WYA2{¡êì ¶Èf(DEÃ¹¹êÞâJw}Féonpí¿¦d
Ç¶/5§ÒDE¸·ÍjDºNçÂµDòò§FèçÀÈ¶ñÔ>ÜÿTôõHZÇ¬î»qÈ]t4ÈsR!¥.N(=Ê{_TiW÷ê2¾~ac-Åóß!­Sð£V!x?ø)	Ì§$¼·Ìü·×Ç)z¹Ñ§D@]r5pÉ?´dÂ@2Ö2ÁÅýdÒh7OæåQü!v.µÜÑÓÆ)iùxÕYòF9<*&@®O÷¢®0luwÿp
¥oÿþßëJLl¯£Küåh¢öÜÜ/Cðéq÷@¤í¶¿gC»p¤ü^:!êðbÉÓInØ`@0PðÂ¾	;pH 5Ú7b]ìNsgÈQ*MÆs¯FSim}¶+ÛXÞ/QºÕ6|îû(+ }2­,	;	½ò.TzhÞ$\¶ONE%)þìt#\îàZSugIu¨Dz:®­	®4@Ï9J´=/9Å±}ûu+90!£àíñ»à(GO¡s
~K&MÑÛ¬;+F-;-C"o¯Ëÿ,½¥ÉIdØÏ<h<O9íòºKwDV#¸_\Ð>ÑØGRð$·oâL¢²vy,3Ó8»R=Qz«Ç wã¤ö¤éx~ I!$«£W0üåVëåN,®³Ý`ÿæ7ÄèÅÇ2¬¤ây"¶&õ·pZúí ¡ôëþà½¹à¨ß²N3¢·
¸¨;&Ý/LòPxødMOMÊÄ°dÙ£¥kvËFä"vqJ©/?A^:Øöãýæ°øFÐ×xSbÔÏß Iº½@¡Ò![ÿiMÁ"Ì±åå×xNÞ`°9Çï¾MÍáV1è
ïJêlâ­'èÄÁÀXWÌqw|;º !~¹»U+\!UUÆ9K»úøU;ÖcÆ±û,÷B2å,=ä	ç«à÷Ëf`ñ0Gé®´,vdÉÔ!JÙºï¯áÊé	 VxéÂ_iÉ%?Yu</ZÓÕÀ|5Uº
lm°6 µ%lL°£WDüåh£}ëèÂÅÚ×nâèü/_ÛrðÙÞ\Hø+Ý^yÜDk§OBÜI#Ô<¸³Pf­êsÙZ,U]ík.ù²tï¡ÖZÄ$¿'ç#Æ.ml·îðÀ9vE¾M¿÷M¯§´£e«ðjs´ß,åà<ìjh(ye|õ¼&Ü@ºf¿{Å¬CÚ\ð5»÷Ð¢ù ¼ME¬9y±ë2ßÍ®z=ö[áúðË:aÍºVYJ1À\DÒ¦Íð©µ¿y4¦ÌëV®/Jy£,üwÎ{¸(óË´Åa±±YàVNÆÓvO=x}×qÊe´lý^@*q]ñ¾¦+÷óNZ_¶WÛùm£×8^Ylð¼(G*²&ÀZÝ lDÚ´%Iü´£MXüåVÕ&]Q¨LN8YÛMQÈÿþÏ
<|ý
7ÝØjsC©
ÑÒª¥$Úú¶®¸4ÙÆè:´ªJ33ÞK»<öíÑq±7±Aa®Ûúu:}Ñ¡XvÓ¸-ä`À{ý£°þà=x'NÌú½=ÍeCÏTÉhÌÈA{]æ¼Sñ {ìÒÂ-¹"ìþÒ&_Lµ¨oÝ:}\·íq·9Ó»ÈG§L9(t$í½P©P«ÏBTF	NMìØmm\7à}Ì*/²·ääÂ6<0Ðßk\nÊ¨òèKMò"º¬]6$÷ÍKñÛ¤[ªZOÈÉªËCÊâãaÇl#J·&èùõO~Ó{ð<PrÛ¥*Iõ£s4"Ø
Èò7ù;Iêª$¹£IlüæUF\P±ª¼ÝEkK¨ÕÂû:÷Æ¼¨~,ïeìNCzjQ¤s¾WÏS%]_wóÊáÃá£éÊ¯KÌcæ
 ý%Zw²[d3¶©F®Ù
^õVÖÉ¯PZ}0hÂ%L¿Wî~ªÁ@×Y1{¢ã/âpû£qÐZäúYÃi%ü
Û£qSýúÛ
n*iöÐøKnÇ4(/Ù ïÚBÊëá
63?Ãþâ½åÛ/l+7êÐ»í_%¹}­5Ð¥øêâW«C¨±¦·ûç0?Ò4åCWû-¶·ØÌ«GjõFs.Õü}åÿ.d\ÌV¶øð<­8¡h'½<x£½Cÿ%Þ7å¬¥»¾Ä`m"ì¿j¨I#Ì£Cüèîø¶qè÷Ë&fä9»D_½X$Ïè©¦&¦	LYÙpe3Wíè?¨Î~2´ÍgñËýºÂÒÆlþ¨Xbn
6Û]0vÓ@f·1s[Wòl²w¥L\l<ó´+'DEã©Ù¸¬¼&æI´DªÙ@ÔØ¡'ëqGþaSD_@[ 9¦4ºýÊB¾÷jl GXÌ6ÍW4HIß®ìl²%hÅb¿ðß¸Ç®dBý¹Qê|iæÜæHÀÿþÂÂHS ¡0ÂYFíû½rvuåtÿ`FGúòöt ý×aÍÉx_ZjWÔ*a­?íEËM¡ðÉ}Iyam/ZMD"Mÿ$ÖÛ7à¿lÓ£QüåVÌRQ.V G«ý¡_4k¤@?ÑºÅRi4£I_.Fèçç_Øp-!ûl?2õ[ÀcbÜ\éeÎ¶ÃDïBÏd]kj_Ùêºø~¢"k(¡Ív«äÞqÖJäÂ4ü6ÝÉà%CÆÏ?wBÃ^±ð¬RëË©HaeÌI®EÉ9	¨HPÝØ76fm³e,PþÈÛÚ:G·¤.C÷é÷Ù[ûq®0
ñ,8âqá^qkBòî·×}_5YS`ÜÂ­Áå=|¦PQJcÈWÎè¿ð+=¼&Ù§Fs~èD þ<½1ÊÎcõÒv"Àë°ÿ©ï9ôoL[³y-´]0lÂùdLýi´¿pùir3k´¬{^ryv_¶ÚR·íÛõþH[$Ü£=¨üèóâr~$­Õ½²Õ'LTÉ+²úÔ±SÏ3-ü>­jÊápéà|ñ¯áçW½ÆÎïÃàv{®¦çð1×³ñ¤Â0£AîãUEQ;¹±NÔÕ¯µ9Oxi+´Áí¦[ó¸v°Á1KÒú½8¸ñ²ÖtÒbkV÷k¢4½¾ªÅösÃj9\·åÙ
|Òè/2	J¢8üu@`«Ï²½~TÜj|ñ'X-³¬³ÃòÙâ!7ÔöÜb¹ë^},,úÍk+MB¬ôßÊÕ
Ë1²XT£dTÚd¥u
×RÆÀõ9ÉÚ¸Ø©û¶$hgàQ@ù ZM©6L«dõêßlå£V¼üåb
YIK_¯(±¿ÈP+ìMÓ¨¬ù´¶7vøÉËTºkbDäà	¾lÆóá
ôºæë`ÑÍ§uGgü¡$©mÉ>Ç!$}²oÞbç$IzpG7ûO¸×[×ª°K(¢,f/eX~_*
;@EÐC.*àDmO°Öì:ù[ªÞÛêÎ¨Hí7sRÿè?)[¡J¶à^jÁbzAÔEÚù°}=6·È@ÁB0Cò>©½bRq§.8¡eÜ>á2ÐúDn;÷m¢´²j.x¦ÐË½%E¯éÞF>' Y·ebíÉ{^(ûÔAÉrS¸3=aNêòXwÐ¶«záD¼§Æbq¹ªPzIQ°w¡Lrkµ¬¾Ä:¤£r¶¤$MxQ-¤Ü÷£EÐüèÄQü­_øêØ¯!e[!Ïf.I÷ÌÒÄØ%IRtèVÛÔ²³
­ßbHz?ª]ÞÄ
ÌZPÒÁÙµ½c~kui¹ÊìùyJ~ël¸MçØçn}Ø¸`@*À|¾t-Õ"é#4îD¦¾
ò¤ÞØL@tF¿hÔÔõP¥üèhUy ±¡êÌ>»$¾~|vuÂ½qËbT'Q[½{Ã!ËE~o^*%Ó5úÎKèãlbÔ,ô2tG·³:0:Fu}hûvcÇiØa}3AÀ]ff³ÔJX§çè~p[L©ÿiUQ"£kú1JwÚ¸JFëÜÖ?Nl4 =ÈÌÛ6Kr

I?lû£Eäüæ+;ùãlA¶÷*ÔPKÍ&7$$1C"ÛÅ	ÆØéÙYÎ¶µµ0CÆlÐå~iM{MwòÚs
µ]üÆ$í
5wk)ÓÌ¥{Ô½H4BM"è(
o!*Ór¶{ëxËÄK¹
0öÉ¾½·#q}ÐwíûBí´¿ý¶<¹ÎÊ|K_¥2a¯6	õÐññCbBÿþìIî³õÆar0cÿ.Í=£áZå¸<ûNMT}¼ãéÒÙ«)[IþÜBöè`r­!Öê¸Í`tGÜ($Æ­a±Ï *QÓ?ÔF\ZÇ/ç'¦Ä,alhlU]ûz"6ÐgH¬6'¡Æü­ªrmüÍáêÒ]&C.9_£|Ý|9¹îm%»l7¶É/®ÍÉ³ý£AøüFÙÛ«a>p+´øÝÜx$]nÞÖ=CKâuâÔ³+	&+W¢ns(c¤jxvûUÊa2©3¥</NÕÛÑÇÔù®Ó]WJEDK])H·¢sÖ¡8sº>É¡±Wm:ñYÑty®4d6´vo«8û;³h£ià:øÛYêeFkiE-êµ:ç	!0~1[Ä+ìºáÜãUp¥sBúmd%z¤oHnBkË©bÖ7*ì­C,£HÎãXÂONãªc~jý+â	f¯ÚÔ üùº6ðkzøqkÁ~AaÇjÉ!¡»Ió©¦"ù>®Åy+f-Ëv½s]ãvßPl69?m&ÒØÿÿëÒ¤£Iü¿SìË&F²$-Z¼ +Û+ô^_`0æ4Õ$N5uZRâ[ü³å^*wÀbðPeÂÙñèÅ-¶°µA(ë«NT»·SA ÌfÈÜ¢âal¹A¦Ç3tÞï	ÝÀÎ®¯¤¹çuìoÛfuE²ûTAÝY2ÙùbþTzïûæ¾#A^áPKË55D¦ôr/1Öïpú<r¨ß¦3i´êA¼´fmV ÖZ¬°Ô+räû¨¸Ú'±3¯¦´dZôÇ­NwV»ÑL°
,_Ú[¹Ê«õs¿a±É>»U2`zIg)-C
hHõ~TwhßhßöfA|+,rÛJ>×ÚzR¯ÎÀÆs·P¬»K[}&"Ñ¢VÉù)ÿíÚ%¿ÿ÷%£E ürÒ*{
%ádí¬?WµÏc¬e`aÝ·£WÂauNõu}MÔ¿Eî[úPô÷¨CÈ,TdKü ­¸Dâ	úßzm´ÿLTÏ
wá¯KMv½®ílÿÐi{w¼oöXÎº½»X¿FØ5iPèÓÚøqòeì)U/úO¯Öxjðkîr>,,j.§6pè­ËdtuY ËeUy/ÄcÈyÚnáMÍçÜt
ÀQÿ#Z	2ÒÃ8/^ÓYWV¡I(|P£-²ç²*
÷éêæVä#?6îª"üXË|¶WÆµ3b<ß~'fpá¿NÆz|[@º]Uõºå¥ËÊ`¾ n.46ÛlFöo`Àõ»KÁm£.4ü^Ûùü×©Ñv=ÁÎhö~ÚÃðßAëÝeê0±«,kÐ5÷î\^ LÖ
jEa-"BwÚôOï½óSq¢è¬\DgR1Ãß¼½jzËñÃôB />0¢­1þ ¡WöaJ0»·¸¾rhR¹U{TÙ{ëé~¤þf')írOª+nZ-8UfAØN@åäÏ²oJdõ¾%K¦C5e¦ÞW»ôî(Þª·!¸b¼ÚX/[	O7©ÜGãAu±gµ%#¾-¡!MåT Ù4á/xS¶]¯¼6"=FËxº~+QoÿÚ/&/SÁò©-"'oö´$ÃÛ£Hü[_ç1Ó+¨Îm¾åe^q¯!¶Zþ Ø½-ûÚ(ÏíB8¯`?å@9[«*åàKÿÕï(þÒèMKCÅ¤¸ü¡pT.¦+§é(gøÐhT/%s¥CO0¶ô Ñy%ãE¢ä1êÂ³Ç£LáöÌñÔg9Å^ÿ6Á1h8¥/úÌ³ïjË*¡mè1EÇyUõÖKî)Û}oÐø­±¬£Þ2ío|sæÌÆ6Ìâ¡"#TT(?½f(ÂÝ~Ï¡ÎQÉÇ·AFdÐ}ü°iEk2Å";ª­ÖÿÙA²jU%°£\üSCØ);_Q¼.Pkx+?h¬d¾ºvü¤ûÇ÷dYo*?Ðie¾Âd®­Z»zØAùûª>V5®á&òK)brí³RMïöLømøÁÅÄá*$|;Þß9¦k=^lém¿äcê²h¿ÿ<9Î ÏtÒÊ¡K8E_Ìû=Æ¦ñ¿ÝÞÊÞcÀuxµª!¬HtzåÃäúìTþÄ+rÈîÐ±*vgG_¢¬$"1êxÓwÑÅüí'>¯]L0H=aÆÆ_f¹ÿÏ¤gd\ò3ÚóZáFôéÑãä]OÏÄÝ<Ãû×mB¸]ÍÏ
¯ª3%°6$ü¿è?H6£püSÍøA³©QµÇmèáT
\ö<Eö&|E®¥gÁª2Ù-\À­ÀM	±½v]ÒÐ²3±b{\Oêæ««
:ÎGgøõôG÷½iM"Åïsm [v	´
lé'×yÒ?-Órô<êZk¥ÈW§ê=¥¨rq8°3ág(WñDß¦Æ,8Õñ8í´>È{ö£~jEU]+wuÕFlÈä½
)Ar'ÍéÿÍ¸óÚØ?cè¿nË
"ýÉ~6Ú®GÂæPSO®;µî÷ÌöD)G«ø¦îZbà«÷öJ&²Âç/dÍÖÀ/ä &@ õÿj£
üS§åkÔb|bX$ 'ËÇÿ¹L¸ð6OIòÏ*Øtç^¢{4AÏx@BÄ¬ïRCr2ò1ÈT½EuH¸Ý;#UÐJM3ôKyÂðÞkp2¨(oYnS[G1_3h½6æ{B~Ú¢Y¸[!`D[ËûC1åq×UÎuÏ§F<ÉÈÃë£­7e0d«[ñÉ9×I£ù°?Íºâÿ9®ý®(Pä¡^)O¶¹<=4íGdèIê¸Ò|vO£[ÛK_Ö;@möæ2»Hs°½D#hËåP¸³ß"Ãmª	ýÁ%¥ðnÚ£üS¼]ÎÓ5¹Å:9Ö_qu!²ýp«ÝðLÿY\+½·¨+z[Çà²¾óë,höJç.à	(
(_9Q|à´!Áö-3#*­y·c6}Y~kénõG¤"]
FúI%Ê/7©FØÜ¹ÛöÌÕemTì½.Yó¤1ìÃªù_´
KåcÏG
6Ê¿\ðm j|Þ÷eFU©É%&'>2µj¢/k^æt	­ýE¦?F-
%CdOô6¡}¦°§F¢ñ½Cøäsýy3-F#Nw/ëV¦±ö©.e¿ìb¨v(±ÉªnÝ¶=*õ
ý/£%¬üÓy*¯::Ã	¹ùî÷ëÓüH³S44l@zü¶g¿ö´gãØ3AáVË=¸¿Nñ5ºYrÀC@Mò)ðÁ¸pP8Câ0i>ªøÁæ¿ÔúFQVRÙ¢5µ¹WN»Vh/srßÍòa´¾½2xþl*´Rºg`ðrJuÉZÉ«L½Àpí¬µ	:±K]¯feáð\r#´Ù\²½cV!j¼ë¾Ø3ôã
RQ`è±ÓDT5«ÙÜ7÷o@]zî1ãJÐrå»·¶èE+%yÀ·múvßvnµòKRBÑ?¿ðVD6îU[·e
ZýºI%£"ÀüBW®¸>*Z5¬ãwê»I+Å<a$kk¥Ü¬
êÛì!1
°Ñbcï_í½/mg!³E%P?¾ÄÏÒïK
ÕX0Ã<¸Ô±ªÑt¾{ôü;â7òIB0zäW<M	k3¢égË'þ\
 %
~Ç¢ñý¯/7Ûì°mýáUy°DBé¨1'npÇñ7±	$5GýéÿZ?ÚVËGAÇðÙ6èzXª6ä²dûP^+øâTF®¸"¼L@¹úXäJKNUuà@ÜcIo(
xÑ«âìS²éõbWIÿßgHIø3Â~ÛU)Â#Ô!UOª	Û]Ä[Ú@	%BI=Adoð£EÔü¿7©/L·Èÿúä$²(¤¡LôD>T¨
ò\¨¼FÜ7ÅsEÓwaPZAÎI;ô§|À8¼6ÄEÛÈã-3ÎvqK©¦ößa2nÖWçä0'I
÷
34¹èKüol®s³È©¥T43õ}
âµ;XtÈw¥à²Ó¯¥`6?Á¾N$ÈEâ¤Ï¬O\ßïª¹,4ßS£+kÒu¡®º.H!qñ:mÃü¹Ánÿ?z*H°Îg£ÝgW½²Ïo¶óoÌòøñ`RL¼Áº6u²?>JÏf¶³§pEÀ÷+Ä
; · C=þò~nJºu­c¦Ã×ÿ]¦ûÁ¦åK(j~òvÙn[îrp2q

&æfr[&Þ_ÿ¶O·pC¶uÿÿÿÿÿÿÿç£!ü¿éLî{¡Â¾ú~JØuGer$q}ÚEý
Ì·ÓY¾ÿ/òÛ=³z&Ç]Â*+öÉ[Ö~ÖpÚE_TtÐ¶ØM·ÕNª0¬´j}áu7`Ì®eÊ®¨~w~ëMyàªÆveè¢HENa¥GT÷H7¡cºQI½1&ËLhk¿~A°åE´>·<½kW×aû²vÅzø©ÖÎð,ôðÖúwMw}×Rdó±QpwïæÝÌ1Ç­Üô
Ùþó
¡ DµR3ûT²{	,]p×+lÎªaþÛC?¾ßÑQúCÙÇÕÃªÔø¢ÔºîÙ£@ü3þ¢j¢þ oïÜd71(©1V/$²äe
mÔõ;æBÌ%}¢m`N8 S_Zc®FÉð"âçyÁÝÆ7%Hª=Õ`2¿ÍÙFªbµÄC$=¬ÝaÎä÷ØªØU¹E¯®â +ÿ}ü¾(MídØÙAMagfÙúÒiÀó&pÏ£y*ÍYÖYÄ¢ð#|þ{ú<\×\è®vïcVûh7Ú	%UøÙÌbOÄ[:£ü½kØ÷^L78»°Sr¥¢×/ßÅùWPk«ê³QfXCcw=TzÓÿQCáÂ$x|FDª¯ÊíéûÂç4ÉånþpD×â
]Èt½x·î'°QÍî±¨x	ÞÞÆe5(\qÃ1Ëswº¸d±Îw^ûqHü$Ô^íßågKØðYzàôU3ÈwfFÓÅ8ò8"ú5ösàº×ä)97y£òÂq)[Ì\R<
ÿ»] ½Ýxðýí;þ%²ÖAUôàé9 0Vu>éY3³Ë.täÉÇÜp(¡^$A9PµBE²öûØè³èß¨¿<ÖýI<Hd6iÀºPéëcî¹;äèÍgÃüø`G¿4»¼Ä8Cêà+³(
¶3Õ²ÕÀ¥ªØõ¨?tcíÕd§TÇg»è¶N;çüiX·Ûw¥kYÜÜÈkdþLE²WòHú£Q(üd´"þH¼ÞMr*ðK2×*×lô!°àHrQw1Ãe@å¤7ìÐM	Tö`X)¡wnSªJ!¶IfØBW³«pçËÄ¹°Ð&ÛYÏ`±À2rüBÉ³êe~S{8Ãn~Ýq,Vòl>BVÏ`&ÊD6Ñú5Ú³üweA|q¼´2Ó|ë{_Î[àÅüÑ`@%Î¹ï´Zæì·A?]iPüþÿîB[ÇÎb«ü\)f¯J¹©ÉA4Ë5÷RS0ØsêJý¸)¡M¦`ËUÈ·Î"F{95`ÈÈ¼cÊüÞm¬/~ìÚg~'ä_ý=8*Ö*&ÔD½ãAÞ{óÙ¥ïK}ÜüÆÄ<³ò®iVKå×ÕD¢±@½¿­oÒJmv£P<üèÁnüárÆ\I>\`RÆ)vç/r:¢~ô~ä#vã>#®ûºFG90£ÀÏJJs~fóñ¥Õ2-hÐ
!¨\ê,A÷2ÉÌl?8sÖ¼·bs¸Ë r1y6¨Ï÷3
+IïOO=ÓÈoaÛ56¤Øý½ðè	ÞýåL,l1ø­ò'îê-p|è)´+ò)¯¡ÿd§RÛWÞÿãqgaXÙxî¶È¥bô0òá6ã¹ý|aÃ
>fÖ68I2ÄÎËy-}«{þ­zä¢UU}­;F&£+L¾¡}»7ðè:è¶&$Í,bE$Z_ÄÒYíÛ+øÌyþÿ(YOÍþ¤b@wÜc©¥¶ÚÛ{jK{}¿¯û7´í£EPüz÷}L±tÚÙ9?ìLÞg£w«-
¸,¾!zÔÑÞ<7¹6lþ:åÂÉ@Ôs7æ^[XÕæê!»÷×ÚFàß æuØXy5ÿ¿!¿m¹	ì®ÒjñÀ/éu?ÜQ`7®]bÅQbë"
2.~Vû&/b{ÏÎ9YvÖëú[MIÎùaAÌow bNÉ\íkç
äÒ3×Hº%º9è¬(b?Q[@ÙªnG²à÷õ0MÒ@¶Üò»Íèéu2{(
è@R¶Ç¬I±ºÁâ¯Å=	¨uÓ¹dÈ  
æÎ
66*N¬9Íwod¡V!DaN9Ææôgû£$¼tÉ{8«§è9tj$·d­Ki+mnÒWºK@£EdüB=¢ÆÆ8Ów§©ëi²)zïú%+Þ82oùeÌôråÌÿÂ:y¤@NNMÍ3¿¨¼Í
­©ÈT½fx­~aÍë¯Âß¨5.õK0²søfL(¢Ø.çç>vàÜ/¥¼eÜþ]´i¢Ôaü×l||uÉ5õÉÌKø7§à;§¥.üî-Ì"S2XÔE67Û@|þl,òØ
Þ{½u|×îé­âÜÿaú²C_¤üªq¤¢Jÿü¿êüÓ9¸Ge¦¸$ÖÑQÑÅ9Ü÷ÇFáË=¦×tnNlJ=TGÜÜzcó#o6~Ò>k¶Ïz.¾EÓª»6[¡½¿·oÒ$KôÛd¶£Exü½m¤îæ:¶¤]Ã:OedGÃâ¥âÓGXÔ`StëÆzÀ¥>r
PãÏÉMÝÑ¸«+îÊxÞ¬kf[Mö ´¡M6·GË®neæ£ÛôÞèæèk«åñ|GÅ/·u,2:jöìM±ÓLh/&)¦ÞÕ¦:|!Ðÿ÷&ç«¬&#@±<Þl-½ËèûîcË·ò _ À±o>ûÂq±aâf!Ã»æ3ý8ò­rö}k,IÕ{ßwY¨lÈ <a¨øí3è?C.i
öìËõý»!l³ß¨SPó?"(f8ü¥¾ô¼^Èè¹¹^¥{ýjäìçy'L¢»|@ïàýc~Á©_élÍ¥AéßÑ5M·)£Eü»Øë,Vüp9®Cû²z3831ãMaD×ÿòöy÷ PüÏu1HªÃ§Ú4¥H¦Q{²8©ö:íXâª*Bp¢Ed¸Oãâ?
 dçg­¢\>ä@`@dæTùr lë%ï¼!HßcIZ}¬u¥f"êë1_v©3à²ïµ²Ò×9Xa©{ô,Ix/Ø)4áò:EÇZ.<T±ïoý1ùAý~ò©ýåçæiãL
ùt;T'n±ÝÛÚ©@$!¬c
_ÖÛ¬Y'øÓlÍ¦lLÀSÀrÉt*À>%8U»êÜñªõõÞÁ	ç-ÇÛ»0a#gç-oÈ&qäßûËªÌ¥ønÀHID×ÿá)£E üSö
<§ìu¨QyZzÈôï#¬£è*¸§a$µ)vVÇ÷Þ#GG¶EíYõú1Åx'è;û¶~­)
dZ«0"p»odÖ§á^ýX²°_ßØ~Ö]´ìÁ>ãtØ	±ÚZV<jÙ¹JÉ	öN,l¨²KíequþDæ~üàÿ_¤áÛg;©èp
®Yqÿ¥ÍÄ{~¤)î}&¤m J§V,vÛé4É:­`Æ»þ@¶!Ðøç´3Zz>÷8É	/ìÖ
ÁGYÖ³Ôò÷pÅµ®ºåo¢XÀ²g=\¿¦¤'õo}pÜ@´kMLýË%+á-òõjt=Í8<W'G_w­$}×Ü=Aõ!
+Iý²dÿe
¼+Éÿ£8´ü[YÉþÏfÇ9¿³q2»`H°(<g÷+þ¶èîÃþ7OÉz°ô¼ï^JØkf&ÃTOÉMýl[Îù. Âxý¯vö"V$Ø
]^%­±(C ß)lu½¡÷Hc°I
«qu~G¿ñÖTêùx¨MYD
'á¬@	'ö®äÅq7S4t[âô^x§ë±B Të¤ÓÿùxÅÄ×è¯×
äÔXúÿ½ôÍ
òtêT¡°«oÕÆ&ñ´pc1bÈR2ëá,£ËÝT?ÝCJ(Gõ¾x´.HÈäÜÖP[ØÝAxáqÈziÈæÑûX`86íÁ]´;1Þ¡¦bÂ*Yxø·èOIm³4Ð_P­¤£ÈüSÁ·2Ö[jdÌhjétbéJÃY_Þí2ü0ßëÎ
ºv£ ëH`X¯Û@8MÜt\eÛÍEp#ïÿúy4ÃyN(¾¿W;ââ5ÂÜö{7VR{«%ÔÌ,Ïÿ(ÍsPqUº3±|øÃÃ°8ÔÎ>ÆéÓ·Ó~È;SñÏ?óþâ %AÌR/yS¶Ü0e&ºàÐâlóe°í0zEï}V÷«ksþ/kI·´æÊþÌù´Nkê,k+Ù=Ø£D äâ¸S(³ÿX{kTüÖ«:2ÍmnÓà£JÄ³ù'ÿ¤ïõð8&:é¶£2áw¼âªÂ dý/ÒJÕð¥ $£ Üü[X¼(zéüÇ)ÅO\ý:÷Ftûò~{ÿßØ¥JwÝGý§ÙÍqPÁ 5ÊìG	1÷4ðÈÿ¸yW;`Øl^³krÎýßÝµ\68cyx:ì X'p±Mâ´â¨ >.(7Ê´Ècd0»<	tuWÐ¨xÐO=yÏ½£i­òánèøø%Gê;gÄHO4À¸ÿ#ëGàÅ?vØ¼¶h¿!×$7&I5üÐín¤t§âÖ;DôDGZ¡ÃyíBCQ²^|=&)_OÀ'8k]ûÁ%ï[VÇº®ôþl×+Úé	J©$m´l>Ôª¼£ðüSª ×'>Í¸W	l%;	~6Â¹Þ	-Ö¨oÐDÕØphó4ÑÄ!¶þa_ÌnIL`U|mÇz<D/êsèwp$¯¸mC46¶]¦¯LÂzV_tO²öIùÆ65úZ¸Y®Wg´ÿ$öÉÃnýîu´Ô|>ºÎÚÊ(Éó¢7U+ç ¨8TÄÆó3mÄ
CMÅ¬¨X«Íz)·õ1
<8q¬(<\ÒÔ!Xû¾zªaý&¥:'û²¨ªÝ?xØ]à¡þ';¿ãë¹iP1ÕÓñÃ6JÒd%%T_úJÝ¿£zü¿+ösëyª~:áÄXã'Gbõ e&"h¼=s'[7
ó´ïQª¼Z²K|æf=Ü÷a~ø"ý³·
Øo§#CLRK +]ÇQe=<XÏé.>q8ZÐÔÚbEj Þm$(a}ÏûÏÖôqn0,ûö©DD3·*Ð
ñw¯±n+ø&6
9+ÖK,²,iÁaP)ºÈÖ/GIÙH×¤Ø1¹ëì¤³2O`È.
Mt`'K¥äwÒ¥\Uèñþ>nTºw'#8zRÙw\ûÕ!4S43ucÊØø¬$XR=I¨Ñ}ÁDdÔ÷2¥¥ÿtzqE¡zûIì2%ÑÇ&´Fé+k,^+òåam=(ÁÊCûiÙÈðÁTY¡x/5 »·=NìÖL¤ÚßÐ(Zª¤m£Hü½Ú÷û~í)±ÑÌ4
ñÖìyÔ.òº¬üìva)éÌéÙ8A-bJ,¸òpíè6Ìµ®AôÚjg»DØw
*)<¹ä*í9ðvùE¯ÍÐDSïâ0æ#¢ÿ¶	õ¼²K¾ûÄzñðX¯Xð¸V?ò¸>¤EfßRH·Ø>û¼~ê¬ÎeÊ·E¾-ÁÉB:G:Py¨³Wð;®r´ÂurFÔ³IVÎzÜ!j MÇb-´Æ[sª?_M÷è.y´ûãò[a¼P³ºî»º%°àpWF¼Ü
|_ÁHËýÐBÊãsåð £u{%þÓzS¯8XóØfÞaîÙ,ÀË¶ò;(ÕlC "TÓsu@HZ©6Mxm$Êì£T,üç>}ôôÅgaUöÃjoC*x:L¸ÁjÏt5 æý
ófÄêOj"ìéÙ¥`=CÚÊ w,ôrªY GV¿¾]9º­H;ÀØðmðd©(>áÐ°ÞuÊGÐX¬þÂé°V
1ÎÑ^ë%óVþFä:´Eþ¨gÍÄy1^éaÂ¸Ç?6iS<ü=äcþ·¢âòaÈ{£Ý4Èû3ÿE)k"XO3;C^¹kVÖÿÛÀÌYy	n?oâæíúTÙÄháëT+½»6DN`ýW&IõÏ	H¿Q¯3ó©¬ÒgLxè®JUIGÍ@7¡KÑ¬t
±"$£]Có)H
z¶dòwDÜ¡¨ä\«l$·V'ù>Ul4£@üêt2É¹Öª×Ó­çûéR^%OÍdýë@Ì²ÿÎºmíQ-û¹Hñ¯ªíKé%E8a8K¿x¶ÐL¼Ýÿûá!´±êMéP,GIÊú)µõ;yPs.+,ö={Êý`!¿ H,Iàhj9­øû±ÒªÆº¤×=ÓÉ PáDÚLnrù-^P°ð³&öñ\jë1':¦Z}1+w	&{Hß:%`ÿÞÒ¿»êÖÀM×¶0F-A\z{oï{jôÈzKæÒÈr¦ò©$Ê=®\ý;ºÃ­x<¬ùsUÛÆ.lµ].»º.ö'öjQoN,hñp"vÜüÈÕÈÉ<7£n
yÓ!ÈeÍó53«\½£¨t×ù
bhpÒÒÏ¼Øâ$7jMÉoøÒ UÜ@£ETüêGD	ô´mA.~¢XµþÝç)=ñ©Ð¦¡üæljæV@&Wá`JÌ`NW~.é%ÖIvûôq]_×&ïù@	°¤&Þ®üúmÝ¸@jiV§¾º\ædó4XOwÆa¼/,æ¤/¬£OX678ü¦eL-öÇ~ÃÖì»{Ñc5ÂYètû~íl
*KÃÍÕÐ|°P5$.!
ÖÃpOüë<¦<¯_+TÆ£Ø&ë±âgBÕHÂsÇ8ìÂt&´^®ÀÙYz	h¨4XyÈ
ÙÑ÷©G;øöãBpRû$Zæ¢Pç~)eãÔ4ðÐ1W¼­^S$æÔ$1,x¬ìI?ìP/¯«a£4hüøÔü1¢a<lM9Ý¯Ê­ä[ÂÆóªzNÞ¶þïØH$èÃj<ùÓýBM©¾LUóû
u·äGJÃ»N ÛÖ¯1¯Ív
¿úçkeÿ:MhÇ4¢8§­&^(ô]D0â¦ò¥<d¹þjiÂYLÛ®ÛùÇ¨!îótåe5µócA§Ñh×÷RÂýKZâq<gN3
Þ¢1ÔàÐ3	¢ÔLSî©Ì°z2çÈªÒÝJ3ËDæ?£*þ½ÀkÛç÷åªh> £i×Áv\¶X"9ÿ}ôÈªm~³¹Á_Å4¸)|ÈÌc§$Æ`v
9,NC\ª;C
mÂ*P
Éµ ?ØR ¥¥ð
P£.|üOÕº4þÆéùµs£Å¦
ÏÙ¢«Ë^y4»d.AqªvûÚå3A×SF»Õ<Ç
¸ß{±Gü|­dË?¦Ç"Ñ¥
F{Lû9Öé¢*µo
éSU5ÜßMÇ
IÏ0iF°¼;Ü}L½EDÒ0"ÃÛ¬;T?!¯-`9ÍHx,°ÍàuÁb|©$§¯ÚÜºh;©ªRßVSêCñ`%ð#çpËbÑ.$èÒ
GGÈ°&2÷°ÔÏ>æûpÏÒ[\b¾ÿ¸úNÜx£º¹UÜÙa+,ðÖwv'÷kÏ¦sZÍØk³ðßÏW4NÅ¸£õ0÷ô÷Ô®ûUJÈnÖí6%íõ¯£-üY9r·db9×?Ý§±¼mc´'ç¿ë¶ÉF(M»µ=	{íÿµ*4¨Ûz÷M¶$\¾X¥$Ô´D+xllÁ5C P8ï6r)×ïõÐp©nÃ³#uy_ýÛ@5êò3L^ÇûQbhõ\DÂÖº^ù¨·bTÜ:ðÆª/Ùâñ6Z
ñü·0ç¡lnû­×{*ÖÏE¨XþnÅ\íÔVü@âø%Wé(YLùÌ»Éá»&u+ÅáÑÛ'*%éÜá5UiÚ%ZVÇn;ì¦gbL©/,mASZýòª$h
Ø
;ËtL¤PÇèkò£p¸±]ó²w£©mÛð6HRP
¥Z_£/¤üýÛÆÿ`>×(Zê
Ä±OIRPZÒØlÅ¦¢¤·ð·Y*ô3ÕÙ&
¹6`¢«ÿ"Þ1S·3J%SñÜ¶.(ã¨ú
%KIµÕtªÞ»ß'y9Kí«f½¸8§GöÄßð6<õÜ~Á1_Ýl.N(/'º°3ûi?~qq¯¥sª[ìî-÷¯Þ¸(0$/C»ÙR	÷üD»º
[	ÒI»e!Ã
:>^.mß)]C).ÖÈ¿{éeð7Äa´J¬ö|	VÖÞKä?ÃèÇúþ£ÜV<¥¹fw®Ç
ÓçOíêA¶²Ä"÷à¥yþøù4 ì$ÖnM$6ÛëÒÿõP£1¸üKC¢t~=íP¯ýýnAýU&

i&gÆïâ+òakrÃl
ÅJ"L2Oªú5<rB
mõf¹ÇVàS-3ø©`^ßÜC±Fl½3Bpå:ÚÖ¥u{ª¥Klâxã§tËC5"¾î¹8©Ý¾{Ï¶Æ|¼;>°ø±ÑÐffvÀ@dúËëRùYv\p
öó?Ïåqê	çÝG0z[éüyÉÒ;2ÖLá¶/¥·0£QTÑÌf
ù}_cõ3#Y	Éðn.UýÝ-Î
f6ùÚ,]ßæAZüo§ÝûÓ#gVåà\Dï¹ôçI­ôÓK$ÿû@dðÿª£Ìüp[¤Û<`¿¿5»ÿ"¹g!=o×òî6*ÇoÙ+jhYVµ4]Yh<ÛÔÝd¶iØýçöte¬çBªÊ4ï®h2Ô1q²¸¤JÜRÿE¦ª´¯ÿÓD /rdË£f}ÞÀ;.$/ñGk.\µKè¦Kûì,÷µ±bÈUûyfnP}Úz#Òu¦ÃâGU@·Àafÿõ2DØvì;wxo\ßãWÞ,'´VVó¼=R"^ºÑÒ!(VærÙÅ¬£c{£iµ~Ï	0\K A½3¥À^:EK'½#u3îaa¶ßQ»áY]~k¿û÷0SWôgR¡ÝíëGûê-Û·.å50åÚWÈIÙªªøùýEÎÅt[_.*M¹äÁð4i)ÜÂ_­LB:cÂRâ»~Ò&{ä>¼ød2Y0¿Ù½­¶FÔÀS2v£9àüÿì®ÿµÊ±ï6Î­ì~øàyÑQNæ5ï/öØZÊùç½RZÙ9èÁÌDDäÛfQ¨/Ó8û¥¶épëé¢wI)ø3µ¿nv×}LÓÄ
ïÙ}°Ä9áU	}¡·ÛaJÞ#dzÈXÏ~Ã)f2¯â¤|nÒ¶ùÈ+§ò\é÷kÌÉ"~&¿O+²e¹ïnÙÃåïPÀ6jÒHexOÐI½#DùáÊÃÉ¦¸ìxý×5öÔß¤©~ÿE_ÒK^dZ\ÛýhÅ»méß^5á~ý}Ñ#Gªyæéc[÷ØIh÷V8gr¥2ãmfàaGm¶Ûµ 	$
­­_ú
Ð$£AôüL¬ná0¹ì6Jæ°ÁËóÁø.÷B+¼ÿ,ºû0üþ¿xü*ðc0iíNJã§Å.0¢x²w©AOQ{/®¿,bp©Gë¼2Èí1tbY¤mAøýÌÀW­^EÂzzý¨?UgxæúÝu+D§¡¼£î/ú÷±1ßµ£å¥#î°ö®ÆKV3ðóÜÉ¥W3Rj(ÝêW;´Å«iÎ@Ãh?L+ºìûlVÓ~GzÅ,"ë£fxù3VÿSFI~ÿv_$eFñ;lÌu@`âÊc7ç¾V;æjf¹°N¶»G×5!òïÙ[,X´dÌeZ3XB(v*µÿÿ®àË³vî!»v%½¿fÛZõ%T	£Büü$W¤yÅÑþ
_qj9µ¥ÏÇoÞü,eÙÛñ²:«|±Vém/
3g¹Ãí÷	.#q1¹^ÔëAah ¯\ÇÚþÂ»@Tû:íÍ8Wç"oÖÿ
ü-v¤uVTæyÊ3½;pà#ni7w"
%T	Þ¡Ï¸IøÆ°R½ÑýT<>gm¦)é?Þ<îîìÍS£íBy2yÎU1ó'¸õÑ¯Û[æR¾!33ïê"MÂèÉaÉÇbÔF(¯î#çPæÇ5Lü!ycÎ%=e×çþIçáÂ®|ÖRlß/É~W,ðrïèpÓºÉ¢àÚöûØÑÏÂXkìË_z¤N·Rl[Iº¶Ð?þn­£Eü¥Ôð?Ë)M`æt²õÀ<t¿¨ô¯rD¹çÛjøi¼U¤ìþáV'uþþºúú[¦'ï÷Í/]
cô¼9zgzÅ«
Êv×ÖFWÎF¿³ s&{ý+zÁoFv`OãÌé@r,
:`Ù_¨µ­)U¾VéüR5±ì;©×îTúpñI<Ã^/ß	ä$®°õíÃ³7ö1ÁÃT¨-i6Êrw?*T?¸WH¸ä¶p*¬GMRV8µWðåWkÂíÿõn[¼QDÝaâã:¼ÛùL¡À(LqÇ÷Û S½d1ØÔË»aGcO¨¯ìõHÜ75cQQ¢IF-¹ÍúêDÚ§%ßrU.¶!É»"[ÿõod×ÿ£S0üOûS¦Vy'ðòwEkèò»ÍüÉd@®dÜbô¸rÁÐmávT&»¿3ÿèòÃ¶)5n×ÀË~CÐ^!Ç
ËB®ë\x:ýï,
ð`cøÙn|[ÂdËÒ·ó¬.ü&7b®òÂC¶NÜYß<­'%µín¶M/õ<
!´Æd%ã?eº×è$
Öï´¸LvdwÙ¢\÷Lä^üSóUÈ2üKG­«¨ñ;³"ï¹-Idç¿'jU«vÉT÷»u)%]klÏY(9Ê@ÁC§ð"UeÄm4.©(CI4Ê×/ï:äõ\BvùTOÇ:YêØôêþÞAi
ËXÁ<ÄiuBüÑC	"X`dcMÞ ÂºNBÈÈPÖÀü6Ø²}i[m£UDüæ%Äm)ÁÌz#t3KÚ¯^êáÕÒÐ±Aõ//?2/ÈYÓÍéûE¢e¿æ¿,(F®FÖ,Áw´Û­Ð -ÙH`ØD3È,NíÚPu~ïäb^4¢Ö3rºüu}Q³v8Ô6p]|Ji*µìnbù¤Ç ¢U]§Qà-Ø<®2 Ùm²WCÇ1³=ÓmuKÀANÐ +-¿PýaKÙ[³|ó^l;¿Z»wÆÒlÍ©÷îJ{0güMEÝØõFPåH÷D
JQz|Ô0IWþåaX	<OÉ{Ó@bæØ:|w¨ìÄf§¢ïâ ØBhúäðJóÑø¯f¸Rö8ÚÛsjXëÔi¥"Ñ¤JèË¾5s	·ÂJÍnÖÿ°¤©oi!jõ£@XüS¯xé§­ôBmJEG¯>þÏ.zÝ~È![%ÜÔh«K(nB>8`ÿ³ºáD ÎÅº®%0õ©h'L;¯©é´äÀ+2X]& <vH+¶Hg\Xð8,BJuáB3bãá1SzvÙpõ"Uºv3pÄÉ=À·ñù@öDj!±äº£îG¶k|¿ðõ?Ù¶\¸¤ÌøG±<Û$Yf/ÊÖ`ÃR_iÚwFûXéqùÍûÜp,YS&Í\X'Yõ§XËø]å Äõ$,3õRÌü@NÁÅÞÃ¿¯Òâ®«J]y®
;?rÁÒdjoOæB`¢M8$¶°|váÿÀ¹?ü)(Ùm£Blü¾æÄM)Æk b¨å¡[q¥Ìço!®z{·Òn
ZCkÖ»<Ãîºª§2û%¡þX%Ñûdirê®ì«ðû`ô	Tò×oSëwùãX
ãóÓtYORb_²Î%_Z|Id7ù9¨¿5oôHÊía,î¸AÊYâoÅ*Aµëx°k'UÍ4³t¸ñøqûÅÿ6°dñx8ó¶×ÞsCÞ2-ñßQåÏHuvÚPñP¦f``BéÓÎ×L£>ÊÛÀn¶§øÚw~ òÇÖÜ±Ô¸íÚ)Q-ìlÌV½µU¼¹iøWqhJ#>DÁÛÅu,¹DtÌÅÑhÛ'ÿ¥³imø_Uû~£9üS©¸³@Ý»ßKåM9qìáv´_mý{6wà¹ß&)yÄ¾¬ëhªáÚò¹E%´¤ö]kbf¸O.´¤_£8[ ¹°Ze?¨ãêW¶?ÞCUÃ³ÖEóïA+ÐÚÙ¼ý>ÅêEgÿÔýuHXevp±UM[üWæHbøSÃ.d4Z«µ+
×±3m.¥Yh=Òðê_þ¯AçVÚá_Õ¢_ìé³oÃ"håÃ%ócd°¼X¹vXË@Ç3S»hw@ôx_W¾Ñv¡ÅÞp«×þ±{Âëù='}_ËÏ¬3öneIÍÆÄkjMl!ÿ	.iÎï0Kfüó0ÒIÙ+RþÕ
Uÿo£2üSª«o|ì£TJ`¾s,v8£o¾PÀÿ3#TÄð$[ÐpZ¯¤É|7®_ÓÏ¹«Çõ»S7ï³Õýy««Äå{I÷®«käððÑÀYõÂOÑÞv³#¥ÕROL[¡@¤Éµì9ÝOÉ¡v¹tp¤ÝÝ*[ùYmW<ëd³ª­²|fsÅ+K	ù3C>ÒÐÿI|rÈ¸`"l+F¼Æï#r;aÏ×ÿª+1	$Î²úTHPÖ±¡´ÍB,íUJô±<_m4Ov¦^}n¦Êgb3âÇþú±|(=¦9s4ÿ± >6TJùüS¬UßßøûB}íÁ?ä3µ/í$Û¤£=¨ü¾$'qi?4
_Ü¢4ï`JYô¤ç0±¦c,O/á»'/¼ò&sXÐÛ%¯Wt'+t·ìÞ7õ¤Î!wÛ¾õÄÅ}7%ònñçqÆr©ÄU¥lØI7}t§ÎÈÜì|«w/+±
\=üvx=þõñIþÛÐ4ïÓvtöLAÂC§.Ï)%¥¤9~ëv¦Ã&¢õãÅ@?-Ãï£Åã¶íîç¨Üâ¥qL¡Üø2¸ß¦OÉ¨gÝÍ­Â6ý?¹w4V5ÂSNòk£æCªëñö\ìþ&@y[«BêÁªvä
ùÐÖd7R&5ý8<(Þ[-Åaût÷Ý\@³ï°ÈßþßÉm I¶Òø¤Ó£1¼üSÁäí«Éìp	°}÷ì¢ÇÙLÈceOîþê$º7-CMÕ°z&=>o	~z{àñ@YÖø²<Ä	R)f>êõüÑ£Áñ®3Ââ_
O øzÂãcèGeðV§.Ëz0>"$;EÊÌõà]õïÌ8pn° ÿ&£ÊurqDo»ßÀ×<ÄáÈÀ3»{±Ä¯¥'þJTNWNÐ¬²BÄAWAâ'£
Õµ=ÜËM#älìtÛdP ²îû)üªþ-°Ì9qê±º®ô|Cp[@ÿÞ;pÆºÈù
,Yà)	ZËíì9IÞýC9`$I$+ù*À£ÐüyZEû6 ØCEÆÉÏ3}¯FAÎ:±#¹§RMÎé8) ¢¿!A­o[PÍjJþÜû
<uñW >JÄ	¯Ó^2Uw/Öí1ÒÚì)¤êRo$«ÔÅÕTÖÛ)7@¶9¯è@CUæÒçbìî¬µr3Ïô4° åéµc´A3¹½Ö×4\ñP,n©ÉlÁ3ÛÁþn±µÑ¨|·ï§ÞßðÍÔáøfe­¹lékçï
ý=Ç^=)æÅ%8´{Ìå](O/_O+æ M0°i@ÝhÍÆ
^=¥}æzÊÑÙèÉÃÐRrfVÐæûJ
/tuçÐE(EcÔìû_®B±Æ¢}XÉXO ±¹3é#æp2ä;ü2GõÙùd¦2ý<Âl­=¨DoI5óòÑ²«½üð¶ÏoþÙ*Â4yÌ¤ºI¦ntþ =2¼O$UÙ&äÚ@¶(
------geckoformboundaryb600f63b9c9909f563385e8bf980ba97
Content-Disposition: form-data; name="metadata"

{"chunkIndex":0,"sessionId":"3336655f-8aa6-4a68-bd48-1624b772d0bd","durationMs":1,"startOffsetMs":0,"endOffsetMs":1,"isFinalChunk":false}
------geckoformboundaryb600f63b9c9909f563385e8bf980ba97--

</payload>

 So that's the error payload. Obviously there's a lot of gobbledygook junk that's like an encoded audio chunk that's in there. It's a relatively short one, one would imagine, because it was stopped like right after the 30 second mark. It was stopped at like 37 seconds. That should be like a 7 second audio chunk. Now, just for the sake of it, for the sake of comparison, what I'll do is I will create another one that going to go for the same amount of time but that it will go successfully because this time i just let it run for just seven seconds:

<payloadgood>
------geckoformboundarybe1008361d5fad3f56f4cd82c9d72bdf
Content-Disposition: form-data; name="file"; filename="6907dd78-83b3-4791-a619-a8d95b047ba4-0.webm"
Content-Type: audio/webm;codecs=opus

Eß£BB÷BòBóBwebmBBSgÿÿÿÿÿÿÿMtI©fI*×±B@DMQTmuxingAppLibWebM-0.0.1WAQTwritingAppLibWebM-0.0.1T®k`®W×sÅÑÝ SVªc. V»Ä´A_OPUSc¢OpusHead8»%OPUSá
µ@çpC¶uÿÿÿÿÿÿÿç£üÿþ£üÿþ£(üÿþ£<üÿþ£Püÿþ£düÿþ£xüÿþ£üÿþ£ üÿþ£Y´üù@ðÏé¶ùö^Q³6EÚ¿Ý{¯'QÇLcc¸U@ä³wÇ8áFÛ¦.jSêM`ÂÚ4gKÚ^´çoµ½Óh*ÑÏKI=´ÈÞÁD°Ö«w
sãØ¦YÄ}ì-!DNéª,fS­¸5b¦ñ#@ÜW$¢ù¸M,Q#ÐÍýÄ^gk¨5¦ÜÏÅ$òn{qÞPÃÂqÏÅ¯@(§í
T"GÇÜ¡F^»`EÃ¼Ô¡°ÛñÃTx1ÉäD3ÌÏ0
üìÍJæFô®¿¯à§ÎïXÍåC¾xÛ*M&u-$S]úü;Yg4^´âkî};]ÝH<à }6W1FÀ+Î¨p´ö`fÅB"SUw""@ Ïý¢	Hû@&Ô¢£qÈü}a%ÍCch³eà¤ÕÃÇeoÞH³ËG9oåù¼Àê ÄÇ5mÊ 7Ô#îU*tÕ­ãát×ä§5~ÿzññí³ÝUÜ*E>l[9(1uÐjI@ì·´àMÔÎîä=÷)-ó@Nèëz_#cn×Õ-vM)§vçä2ÁÊZöïé­å»ä²]àd¦ÃxïöÅweèâ%@%y'	>²îü¾rx+ö%h nÐ3?Úª«ñwá)ÓÒvX8<·êYcRÀu»%ËÙÏoÙN4Ãè£_í:v9Ë¿bwÿÇYÊO;w3¤YëÄÌíåÈ£Fßüàõâqá¦N^ZSwé¤&eÏSvÝB­
C2ôrj4þõ«jµ`Î@¼ÄýU[@Òv½µµ%Ah£4Üüdù[¤£ØºÁ»{`ÌÏà¯GÌ©Î¿síñáB$;=-E¿¯¯ûxÎ!n"õØ®ÑKå­I«ªºSw­KüØ[^y>[Ó8çSe¥×YXS¸Q9:QÕùlycbà»èÆGT
QðÁ¿1Iqg}Ý}»¡¾`½ô­§Û¬S¨÷)Å¸
y
£AHW$ëòE<yù|Ö¼È7];ó¡Â5íÝV2E(=
¥9Êð²>´ºúâ6s¥[/Q&uZvlI»ÜÐõDVwÝ[´T
¨]KIAoc2"¾ZAÉ}©®L3nª$²ÀXt^i%(Hd$"¶Ûml-&ÚPªØ£VðüpJy²­ê½hx×a½r°Ë`Í>Q·CÞûæl~
nªÂFÆ¾¼âþì¨ó«¸J¡¦áûÆðU¼*[8z[í2Ù§oñ@
ó«O
\ktQ<Eí»aòµÃûú^Ö5»5ãÇÂª³l©ûö6âÅÑmî	$IG 5¸¾$Õ6¹Û·m»IÒSáw¥_bÄ#Ê²²ÌÜæ¦àcM{%|/Bñý]ïÏFIE>LXiÉCc¶õo±%({¶õÜ	cý¡X
Ø&ôfvÆÁÓ1 ÜôQSÑTyØ#ÂÓÚq£½93ëYDD¸%íßþh\o$Ðäv69âîtØ®uní"Þ.m¿Ù¹?AUVZ_£3üAeÙXBµª|Ü^ì/¾rImk÷'s
½ag8Dâ3^ß_J¶JÎQôt§£¨ù?1KoÒwu/*Ë­¾-ò¬èÏ4É×_û½ÉmXu!lYR¡×´¦äª»¬øHrPX2¬²5!yX»zmWÙ[×ª%¯ý¹ÞÍû"¶mqM"OõGðëLÒF ß£;!|ö%ä §eGrgæ~Íg£üXMË¸êf
Y÷Ä¹­·å*Pt ­»ìþÀµçßÚÝT|â)lÉJ_=É|X,ëx§+Ò2ÄÖ&G/°òq§'Á¥TÆÀÝs#ù$a<
õêæbQhÜ·`»@? _P£4üÚÂPYbÇ3ß¤VãÒAÙ<Ú
xGpß,Çn'gùðõÿý¬$ôì±û¹Pãø`¾ÁôNó
eTûáÖø&NØU¨
wæåV£Õ(ój®kÜ@PÙ`ôo¶$½ÓçñáÕMèÉ}Èª¢Ùs`ðc¦n(á%*÷éom®Âf+Pô³z²ÁÖ¾Lc<¬åeëË¼Î$RÓ]p¿¹OcOá ²gðÂô!y²dK!Ë0§äñÚ?lÍ^Ø4Ä²RýP¤ÙÞQf]²¿0õÁ,Àà¸¿ïÌrF	Fþ%x
½¼Ø°)+Ù²¢4ÈâdßzRñuXR¶M¤ý&ÿÿÔ6¯¥ª¥£,,üB>pL¿âáücrgú{ç£Þs`ú&$äBn%)*é_\Gµi:¶-±oÍdÙP°ÝcsºH¥~6?öcûuÛyjUMNet-uûÙ­íÇòÜCLuÜ`®}8gz4®2+wÕj1k2P*³¼TbFÔûmÌÂbnH;Oìº÷1§ÝësR2± üV>`[Í>£WapB}Þîvõ¹¨¿±?ã	sl¨ÜgÉÖÎ¿ìUùòÃ{§".O1ÉÑ¤®r&»U^OÓ¥$§*bEFÏbèëñ§@­ÒÔí	Áã¹¸ØááP|¥í9;³ì¿ä¨Vv

ÛöÉÿéi@j£,@üÜm¨IàxÛÖÞiõá{«ÙcÅ±Éh=æNnÁ>Ü¯d¬ðþ¼T!=;Hh-GÑ°ÍÞG_Oé³£ AV)pÊáÔ'íÇY8~VØþ>£çNèÙnÀFëÉøÝ«[LêQUÝ|ÎémäsÂàçï[Ì&ê
2¦uØëñ¸¢²º¥u32Ká»ßààø÷ífÄÊÊÛq¨ÆÖe&G}Ål´¯
67ô6ÏyB­»×ôèJaÐúéËÖ2#3ûkøïçÉuòqfE§L[?
nµ »ÔÙ÷ à¿G)^«y$ØaÌØ¢`\Øv~ü­!è:0Ú±ÝÒvl¿ÿðWÿ¢}d£5TüÜnüîÞ3è2D¦K^uÓT+K_w÷U²ªd$HvÎÈEôè¬`üht°¾5ÂZ²ÑbRíÖaö;$Ãx¤»®Oú6Ôz$èe$8,p4&&ºx´c°è¯OÚ-~
¹Iüü0z`Âu»ªå|/µ­kÒ¾ñýä³èO&»Y&Pü¶5Ñ´aµtùYò*¦¯|åÃóêmA|;û_©mãSjÁÎ
L&wz¾âÔTì¶/kÆ¹-!ó
Û"xÚÔ¦¦¹SO)(Omò5)ÔBclZ?;ùfÿ&U±ÀéÜäÎæNäTî°@àh5½¤´mm*PIAhU£OhüÚë]¶ªµEÁç{ÅJnX;¤àÇüv}hÕ@bvhÏ¢Ú_Üqäs8VTvy¥D>®xþºº¬åòä¿0d²M¥TÍIM®«R¹T7«AÛYË¸åYMN»¾ð²ø¼']KØéØ^ÀÂÌWpkeJµãjr ó¼É=åÑíÔBº
T¥CèIÝdïû?¬CñP,Ð jÚ%ÀlR§.@ÿN
³7"O°0;éæSñ°o|árHVvgwña[gyÏaVmRÛpp·à	äp×zõ_!¹sÞÏòµ`Á.|Ki\CÈ@©â·WYU¢²¸0°RKôú½kjÒNðõ¼·QæùÃyðujdè$ÚTõF]ºþÖí'fÛÙºÿ£/|üAl³¦fÔDì­Ì9×}ãÀLæ³JùG/â¾_»õ¦ùâ2@oò07¨\tmçJj¥
BëþÍ	O¨äþÊ(1z¾éBøÅ¸C--ô§õk*ýÄä½.ïÁR¨ /@ëWö4zê×x9¹:Pþ¼M«J	+(IÁË·¨ÌÔÜþp ÛfPâ:Ù|ÆÚõ6RPKRjÙâûìV8xræ w*þbz;Ý³§?-#~Fx{ÿ1q×¦P*8Ü£¼jªÐO©:3ÔÅ\öGåø" ¼åÄ{NÐ¥Þæ;OEª&á¡ËÑ¢úóþêÃç/ª^§æ¼»FE¸EïfgrQyI·fí'e&FÿÖl£2ü×èø3<6®ÈëèÕäC¦mÆ 
úw>MO°QAA?^âkè¹jºïÓãòú
©Mb<i!uëý6ErÜÎJ<m´aH³ªsUË"§ø´¼¸1ÄËY7U°õpM:ã=,t_WJGhSbüvÅr=¬ÂË¡ÏzòÏµës	qB%Þe©±ÚO Å´ì6 ¥ äÃÓâ>·r\3æfjT¨HDõ;]Ê;,®[ï¯CÕ&þ{¯áðh¤ß£¤ºûéa
ÚN­Xr!® tscª*èë"ðNÒJ[vÉq©=+câ4Þò,¡Ò©ÏIràÁ:
bK_Gøyâ$	þÔ­
]Õ£4¤üÛQ×	p%Iö'­`MkÄË
G7ê(åh1R¹*iu¡2å¦d
øïòùÇqTÍ`+Û]»{çÅ/«_%fð#áÓn[Þ!ËH"vFwéåoùPts&¤È¶§Tá7)¡´|Ñd°#$¶x¨7·SD{cªÑFÔy(clB/¾JØø¡_êäív<C	ÉýMÃ£¯t=)};e¹ed\Áúaº¼µAQ³Özwå¯SáQmÖ×ÈÃ"þvÌØ},@ÅÁ~W$ùöå8/J¢ìSubÝHèüx)Ç+úºg3IÂpÏ¡ØÀl-_d4â]!2ewÛ÷;ä$	m/éd|nM£-¸üöbmGß½üÝÊ	h3ö»Jn$<¨yú¨Ã«äJ#ð÷*ë\ =Y9ñZ}ømdmé¹PÀ#÷©®RV±ç/Êð»
·$uËèuØzBq3óZì?®Ìm7É¦ôI
áGy®¹tq¦èh IÌ£ÿ¤§ßSt~z¿ÑJäÇUaÖ#W¹\lÏ]Ñ¨
ZóÛ¯À/Q<9£Ù5¡e2d8àåèâéCÞ  ê ô-Pmü1§)!RT-éÛücÉúµ£¡µ©>Y¹½Yÿ³`'ÈÉvHµ9|ÐB³ksä/éÛÉp¹ï¦u0Ý¶ÿeöö«d[I£*Ìüì®}Ä«|n$Ì\®ðå¤«)ºK$­-n+ø©ÉRyü>%Ú©{ûaw
 xE1[æ6ûÄð@ôÑä'J\sDÌe	Ø^"Æý	*0àPöSKèuf¼y®=ïT/hx}¨lÇ}¡uÑ]ÿã¿»»jï¶QI¤¿cØ¶[Éå»¼KÅû·ÚwW{nf¿D_5xëã|N\×ã¥Rö%0	=¿i5@$È-ÿ«G|Ð¬RÁìO:~wK<ÐÜÛL/p¹;DÚÓkl®Þnî¸/Æ(v'\òª7»jÔ¸X¥gC*c½ßàævZyBoi?°TPÿZü£àüAyêôk÷PüX÷zíÔvÖ~Ý7çãþÎ&à\5ÂB,VõÀ|öàåäÖL ØEëd@½a»ÂS¢ªVHà?çþÐ
ÊÆÂ¢HÓn¯KîbQWW°*~äõw8Ø9(+uÀ1¹ªoY7DÔ`®¸ñ@8Y¾@±âÿÅ§¨Oó>CK|6¥%¯¡wôpb+!Wæ¢!@úÿ+é¼Æ ~£|ã(k"æò¢ßqä0Y×ø5µ$û0ö:¦sTúÕ%ñ±½¶Þn­7N$)çââò£_ù9$;,ËWÅ ³Ózy	¾ÀE&ö·bRU&JUÿ«£ôüAåÚ6PãFqÀÅS>R|CÍ×[»îq¦±ofÙ¶÷âdKº¢¤øe´pPë,È]E^UÜÔã)aû<¼^c¤_ÁºtZ³mßØ~¥y¹óùÌ'Äèê¸y¦¾ÉádV3³lc±U´fÁaa"Ô"é	]Än8Ìb\¿1T¾Å)eU,Ï+ÒÚ56í"³æáàÃ¡õçÝØuJáÌ£
¡³7N¼È>}À»sq+¬Û©®	7ÚØÈWæª¤O}¤'¬"gI³4ïVÌ_ø`ó2 AcË'1)SNö-\jâ¸ÀqÉÛ_ÚZõv£!üAfùâ»¹Ô©7Ëïà)ÑV9º¡P§ÃûEâû4Rgßäè¢\óÅØ¹	ï(ñ±'PVH\»c¿*_;"C+ý8Jò#¬jîóòæ£³soP9wr0³Q'Ï\PtÙHOóÿ¡V¬y6Ù*Ïå«éáRê§¬{Ó-ï¥Cx%Ai¡x/vw¤Ò$ÎL.LÂÃÕýá¹¤¿ÙéÏ·LBµ1¡¤Lã@K]s6ÚÑÃª°°ÃÏÆìÛ<Ô5¦ÿÞ}¸³"­ Uä'¦>¨®_ièF¯}«]yV"Ý¯,çELP[ìd?6Øfè%d£EüS­ØuÎ,Æ'ðÂ§PV§<jÑWCçi¹×ôÞÂù^ÜäñÎDÍó!÷®þâ4ëaÞLÑö¸mcJÊÑÓ¿¸UÃÃÊA¤`¾?öÚß3ýåÌdzÞvû `º<®8³N¹@Bßí%NêÚÏýð½òÃ¶äÿî@8¯+«76]MAU#S}K:TÓN__ôw|lIo·óÃÝæm¶êPôH ÔþçÎñóF¥SCJ^ðî]5*×:h¯çJý(AÙ3¦ÊzÅrâÐö4´ÓÉ$éÕµÈ8Hbä`Õ$p<À6
Àÿ¼WÑ Þ p_s*«Ö«ûüÛ¡zûÄjy<O²ím&ÿlmmI
&ß£E0üAã ~=n¡ôlÑ=:c
ºs|}Nb `Ûì]ìÐ$ºÔôûÎñãi0­9¦ÔIÔÊ¨½û/pBvÚýhM d#i6¶±i`cPÿQ¹l+D!Á·NÎ3§ìùØzÍGæ7÷T±ÎÊ³ø¯Oj2m8\Bd(ìJ±¤Ëå×´ O\!ýQ×LÝñþiä)O
W(£f
ÃÂ$ZÏ$ÿò¼bçf )%¢%ÄîÆd¢v¾ýJ?^óÉXññ&Ôw®IÃ>ÿ!¾<«ÕÊº¨¥K%Ê,'aåjâ_ô=qCÖãUh¹;7ßÍh ÖÝV¹A¢ðfH±©py³Åf½¬`|820jÇobvù?Ûäÿõðú·ð£EDüAä	{ÐeÞ¶Ó´ï)ìw¾¬VI~ÞÆ·¯8]ýCºïpú+´î	wó¶$ùÙoâp!]?@Øã¯"«pÎß×"kIw]°£mBç#Å_;ª÷émÆK.ÇäælámùI²kßêÄÒsvòAbð ÑÑQ9üös¹t	¦£{k»àQ±]ØgínXMnT?\c£PYo÷þ!Ó%pîýl©RyÚ0iTD¢mM ØÉ1¡±@ ~öÕ¢7vêTÿë¼þz¦G{@l<d%fTÊGò Mz·Mg48¢Õ,î¨H§;ìv¶þo%Ø%m~òAç·¯%oz(ó3ÇÁÔrD)ãööé4öÛkvüÿÿð$ûm£EXüAß§0SQöÔ9æCJ}è-ãáë0Ï^qñoîä\ôÂm² àËµsÎ Iï^ÏE«`¤­)#+C«8¢è1hO>Ýá)Yû4èRót¢¯¾/nðÿq¯Ùx(É0u!b$¹\ýÔ²UÈ÷C£lÎ¿Mö3åËuKî =Ø§FÔÿ]ÿa|"÷d¹>
¤h8¤«ÆJ3;Z8PÍ?E4Ð7O¶aMUÊÍî]o<ò[®Wñl·þBýw±8Õ(¨êËbôZÚQèï`ÁèAØ,Á+µED>
àÂËD¹ò|ý|Q]±úàXÊ§÷ðüpÂÍÉ«¶Ê}w/ëùÎ»ìà^~¶i6nFÿK`	ÿòAivð£ElüÙ ÿ|ÿ^Êä³«7{ÞÇ>gÒZ]C59"tZ¶"nFjöÜ! ÝËÝî­L{\W[rtÜ.uº(v¡×Ï¨åÇ\ú!R»í);$ê-¤
^ÖíÌ[r_ñÊãæ¨3Ð?d Þ;=*¯3US5üd£\Zææ&ÕCÏñ}¥!@Ðî£ÉP!ÕÓ~ò×ïòù!ñLzfÿ+ÝYÎReùÉýðm¾\d¯åq*8zã*½-Ö°n¼òÉº,åTRË
G$z`»¶r¸¨57¸M|"Êê*³ ¿ÊðC¡wè"ÚUAÐZ#ÙkT´Ä·Èø~,Qk¹¶Mt7ªùâPÙnÛ[ÚÖíÛoÂ¾ûR£EüSÛSvÅµf}íL">ß^2Gl]ÂÆ*
¸kw°±üwP¥XÌ±¶B-íX1¿é&Á$ßQósèì¸A`¶_Üù a_Çr§e"áÈ`ùW¾kÝ@¤ì¬×:Íî()²6^û`8KG6G!-Ue'!Åëë<ÿ«bOùsKkxòUÿsäR³¼Ãëc¹Cö&wTp><ºÚ<dåî@Ùfô0éÅ)¿ÀÊ_-²J
,	ÿf+m²®¢=¾-÷l­®;!¹fo¤)}[§7_`|×XE¡½ÝÖK­2{`õ
Q¹À°ÐúËëH)±;N¤NôR5á<|6âèyîØ@I´­&Ù-ûRv£EüAåÛ	`YàÌQ¥ÝjzKLö ±¿JJØhêOÝJJ;<úùuÕïñÛú"y=1Òô	AqQ¨Åßß¼ÿÖ_%|{
±S~Ðóä°Ï­¸÷Ö
éðÔ	aæ·Ýw­½ãÜh¡æs;*A0V5:'.5ÊÐúð½vÛUxË³¥ÇãÕ¿Ô¹MñÕ¾Ñ*Þ±º¨ýmSÔ2+GÅ`·Í¥±Ý´&GX
y[ù\°È4'ÊBú¥áKåÐb~Ä:sñ[ü«f`!E¦.~ë¾ÚFµ¯7òîál	ý¦¤äÑ­äT-B÷c(BMñÚ"<¼aH6ÅB?¾ÀÂEø ¯©ÖP­ùxË²Ò¡ÍôÎ%/ÿKd­´¶Ôþ¯í£E¨üAã­jÓ¬Ô­ÝtË'Õã}Gþö-s(ÇlF¢ËD³¼ëg§GrY3ÎÙC]ÕWoÁov²õYÞµÏ|2À8u/-ò=òô¿ï¬BÅxþ´¼çáZåWù&+1uÞg« îvOÏN>ÌPOâm+}¶ì#9è²Øù¦¨Óc´äÂ, 5\ÂçAÕÇrGµ¤PëÕ%yv¤Ë­&hgbuQ°£®ÉÛ¸x?à×-
ÒlF¢Z5õÌÎ^±YÊVÆ¦7®]¼óÍµ¼  êºçd4õi;HXt©â²ê4¸l­¼½	»ûê1õ¸¤(WØ
#@O7PÚ$Ãýv­lÛ&äµ¹ªÿÉd£E¼üAð.aQÇ`a·ëÖ»Ø§¨ÉN[2©V;Ò­M]Æú_Ùù$Q4l¯I³_u\¶Ñn9&ý@}¨0å!Têe½í
{ØXrðòYË(»	ÒD
ãýæCÇ¼Æ	.m$ó­ÅVxÁ·4þÑnù÷¯ÅëÍÂ±Qscv¯cSrLÚ÷ø´ÛÁ¹¹ 	YÊ§hÔz6R(Â©õrèTm<Æy¢:þmÇûÙW*Qc[&îúÚö.	/ÝÅÉdè/ÐDº¿«áuU¤Ûyi_º5¾zÒZ6¬ð?oVû!GÉª~yþÝdS·Ru\¶^bfÖ_eId²°¬Â¶¸îÀÊpA§9ä¶K[µ+IÔ¶õ	$P£EÐüAi¾_Ò%²2b?êîÎÏ1}-àÈ¥ý>
dÜÉ0VYþ>/þdÛ
®ö@&^¼Wg<ùK²$¹á>$çÀ´µ¥Û¶Ï²Ê¨pJWuP%ÿJ3è	½F:©Ö´Ô6ðÙ>äï¦þJÔþ
µ#pjGÃ¦Ê6Yh
EqZ ±½Sc'ÿõàÐc_r±¯õb¿_þÜ©£ç~w¢0M8ÚÙ@^põ°Î Fì¡SÙæðòÑíÙ+7¦ÜÜºÈj3Öü >õ8.B¡ÂTÃ DüåÓÄn./Df3ÄÌõkk·Ü.w[²R`XÜoËe]-âlåABÇà{h²ÁÌ8ý0ÏÎ°ù­kH	:ÁF<!-·Kk­´µ/É6Z«d		£EäüS§ìÊzUR2®¹xàã#³jIá¬YæÄzÓ	ÙDÍñ1|Õq÷æ\ÐlHuU3GâØ½sÚE'¹û?U4òæ;]æOÐt%RÚ %²üdXJ sQôÙgî9>	}Ï¥ûì4ûÀ5/WÚ¡zúà¤ðcâ4®.E3ÂMq±i3ý¢ÔæN<Ï*`"Y±Dku§´¾µ »ÕOT²¢*n§obLgwÊ¢3ý¬¥á ÃS,êT;êocÞiàX%qHJèÝònênjDó»mòooâfu"K6t!}¥7ßa©ý/¨·Iê%6ÈÝTÉÚÐE.Y`Ûu>Ü	¼eP%¶ä¶Û@?ÿíÿú£EøüAå¸°_©´S(vuµJÜ9o%
5·D-Õç¥![ls÷ÏAË¿ÖÖvÙgÿíÍ3y¼íµRÐÓ
g>Và9ÊSvè8¸ypÍ)Ûgñ¡"q]tÓDï!±mþwî{×SÕyC}U|r¦/"Èä>´jM_÷Ï~Öû­ÀKÂT~Ï§$NÿÔ²"ëNÝrgV~¹h1¯³å<uÛ{5õw~Ôå@¿Á¾{4´ñÁhLoO_s_&Áû¿Ç3éGÂzõuOß^bs#rÀcó&á¥è
Ëi"ÍHü±¨¶~v6w©ü¡©Lh ÄÞ m#+­ß\ÿ/Å¶Ò% lÿÚßÖ¿ÿµ°£EüAåÙêä©ö~6ÎñWÚ06Z¶=	&ßÒt>ËõÒMÐvËÞr¬CA!Dº$p¢e¶eQqH@/Zåc[`RCpb8ÍÐÅEFª-ýÃ¶"5»?2ËÔ}:G#âÝ¿Uµê)DÔGÄ¶i¬è»®]11x¢J¹£
#Á+ÛÅ<ýgRÒ¸-K1":vç"ðy+£Z?g|È^§tÄûã¹9} ¬÷2ÍÛÐNx^~Ç~ m'}|¿ÑéÜ Õ!®¥eËÊÏ­·Ìr>ó±è:ÄbºRrYëpqyµñWPÍ	ùæ*¾1Gên¼ñ±PQªY20¦_
ºè´QPCü*·¦&*¶:äØ@nM$RP_íY£E üS«¬õÝ°17NH7:²5éÛ¹úÌÇ°â§ª	EòÃàCÏä4å8"LÕÂÖIùð>/©SÛ³ÖñAÞ«¨6 Ú}zXSMõMaíMÑîbÄXS9ñõBZq
ç³Åêé¡VÎÆÁOÐèÇÔ¥ª .&¹íqÂµ?Eñ×1JN-ÿS|?«¶üW4ªiR0EÇS¥} Ë[·.Ó©ø«cÈûsÓÓp`]Â9G2¶þlf~±WÁK©Ø¬¶å0O©§SøÄ#)®ÂK÷aéjþz©Q|P# C]¿ãD®P"ÂFa>Õ<ô!A­5#$Râì»»BR;È<Nfí$¶°$V·o£E4üAyçBîëµoä!ëºýòÏm¿¦ÿÒ%>ñ¡ÙªNtKh¯Î"kY?rÒJÍ0&ØØ·®$¡ðû_û@!]ål~Yò«ÈuÛRþ¯%ñ9Ñå[ÓÈzaáâ$%ÿâºÑ^Iø .þ¯mÿ×ò
T¤ÖÍJÑ±hÜ]áò?ÍÖ¥@û*m±ÃefQ±ªt$¬ö].S½b¢ ædtë
°Ö14÷PI÷íz$Á*KÕ®¸_l*±ðm¼²Ó¹¿í)Þ¨ÇÀwû_érbZØC¨Yõ>»â¹ÓÊ|³>¨;ÁÇÓ!Óã¢GìÆãB¥Ö###qCnäjÔ±!WüøLHö=¶Ù¹'ÿÛ&ÿ×íH£÷Hürâ<ÜánÞaS¿È>éÇï¸ÑS³øbM­É·Üw££.AgDin5½/~}õ²sÍægÝ@å2Ýb¥k½(m©t'Aþ}#~É`"ÙufÜv¿O¨pÎ,,wäKïµõ»^øCÜjv¡û^Ã6¥Ý"Ñ;à[!NìÿkðØ=*NC·{ÌS%nBÈÂÿ4¿>¯_Ö~â8ÛNuÇ7äWíÏj#"Q{ÝÍÌÛ¯uOF\Zï¶)úC¸óK§¨Ó>@Nk;ÂO«:âäÝò Îvç,Ée*Y ¨àýg5PÔ <kù÷«¹Ð©õÂn6åUôn©=¸0Ü\=s§wÆÌêw¶Þ­0±YhhÌ§½ªº4ü"g®eÃNìèV6L×`/¼¯îÁ='æµ'ào2fÿb9{$¨¡ú»F0Ár¥°082êÐ*´sGOÓR1È0	çSHsK­ÚØáü¹>
Þ`ç1þí¥ò:NAwy8­ekx"¶dz¯éÄY0ã\	ÈæÝþ/MP86·=Ê¹³¥PD@-Öfÿ¶Ô­µ Vü$£Ó\ü{ï¶éÌáUºõË$ÝT¨CÇ gÊ\ëÓL`.h Y¤.Gõ_ü-/Ú]/]çÒT»À,Iåäa7zD;Öö_<3
vblÐ8 YåFø	7­²%}î( ªª+ÔCøº I¾}tq¾DOçtÚËº¹Mr=	¥UãAíÓÑ>÷Ý²7-µdjÆÜßÂDDKSV¥UÒi{O¨¬.&á¢Rôl
¬@¥zg¾ÐJÙ3?¨@ç2¥þÕ&tbN,BâüÖûIoE\ýGDDùá8Çwnã_ü!=N?gïó¯ÝKôS|Z³LðÔæô.{ÞÍ&wäÚñ)½Û®íÍ[Ìrù,PÌñÁÕvÎMèøGûðØÛÖã¾òfkuâêä#FWZZZve$Ô¿Âÿ¹K¡ÝÃÖOvä¡´þÿéÑ$÷üÕÊ+áÌhèÝþ6{-¸ntÉ­a@ÂFpNñLfÙ@mZvù>söÏÓ×LÉ<?°©u|è­"[Áû$áWD~leÜ´¶JDü$ÿ¥£püS§ì½Whyêÿu¡~ìùN]îDúhsÚ"O¼eÃ
`«ft¬7SÜ}YI¢ù!üJ³¨ºîËè=îÙY
A3×¾JúC/®Iþ'NÕR}qÐ:û¾_l!ÃÝô,ú¨E9S}hÒØ0<H6ä1O{ÊáÀÂRçõÀtÈøé¦!op½;ï(ã Jqç©U¬«Ìdaqj6!±,ÆcW=Ñ$ÂDh :÷.cÔåøÚ
)e/
~>_PA$°Ö9*>¬þÚð±:qeg6y;ÂÝm~ïwô$|<ú
©?£üAëìõÊ0ØÜ®(6÷^ý¦Ì»ÓH¨/1¸ßºtK
å*ÁLêïc4*CÅ»xÉç¢»ÏcC\1ÃnDòRü,ª¯Æ`\^{OsRR×9\+°1½qf(äw#åhXá«·ÝÜ)ßXn¼Ð¡
làÜµÆ¦È/Y;9BÒ±Î¥ËiÜ®Û8
êt'Ê?÷VÆ:.Ð­ÉW.n{SÁ¾ky÷?:ÌÃºn+ÊSÉÖBÈ{íÙNU."¾Ë²D¯ÇÛFêñîsÒz¾ÞQ±îÝ}B®ÁB=·ÿâ~yÄ\ÿÃEÒ/!¹o9Ûv&äÿRjý£®üytêÅ¾>fE¾p8QåÒt«
Ê"bÛv, à1ÚçÀX
sÑÅñÅÛèèu sXáãj<ÍÆóÍ)êv©ØjL;sÿÌD¹
`åÃô3[ÍnÛ`ÛºsúÖ¥Ñ«¥F}w{3«_n±3¾ñ{ïê|Ë®@ur&mdòm«÷þOÄA!¤Gÿ¤-¾ÔÞjNÿI¢»ÖÊ­aû¨"_vn·B\ÝQâ³N°N¼DSüòâìêvßöº)T¶CmÃ[z³ÑÄ÷C ¹å±'þfCý,9O
Ð²%§*ÂÉ¼Ù³¶ôKcúh´KCÿSÙÏ¼`æBkyýK¨*-h÷'Få9Ià³	5MçÆÆ`½È¥b´Ô	
\X×8®4á«%ºÐ2x+ºèRÃÝHçÞpmEÑ»°÷ 5	Jk=¸paðía½â4Lg@·e[@ü¤ü&Gl£E¬üp,;ü)§=¯ÎÛKßd-[k;L±®_è	ô+ëEðÙIE®8MÈGØ¥D³Yî]UÃñm´¯	 ûÚ=/tÎ¨Ñ·ÅÚy¦-ò8§Ò´mâý´rã.e³ÎÓMDï@²íKáã§²Òû²ôFD´þþï÷çÞ}úëuldöûìÂ3Ë°´Sê÷>¹BÆéú\ÏêÜF`}ú¼9Q×èh["Ò=s"]VY)F:K¦ÔþgoQää`Ü;H4åAë¨³¾ýã¡|]XMº¿McJpñòÇÞvIAðÉ«Ñ=mÌ"]­V±ÒÓU^"Ð}Ö¨«¶çÀ¾£RÈ^,WzÄ_z$	þÔ­oêëÁd£ÀüSw»j
.dôÃì¶ê(ÁLð^o`TkÝÏ4ízÅ¡ú¡iãð7ö{.¥H9Á¶[1IÕyèuÒ×Õ¿D§Ä«äXáìy],=_d²HZÄÇu?,âü÷NJZÓFÀâ9þu«Jy£µ(/¡'tèÛFHfÛlVû¢ü¢ûCg]ÏMÖç!¼<T;7KÑç(\N¼îÞÀ+úÎÞ2ì·ç²¬;ÝÖwgµ5ºÞv	Gâ¢è¤%GÙ§ÕVéjDG#ó7¡ÄS­NQf³Ë=f¼îîJFÒ$ª¶þ¶£ÔüLDå¾eQº¹¥XE/Ã¬Ätî§á=&´}Þ+¸èÄ½ÃÛB¼,>h\Ìªwgª|"®¯9&Ï×ùküßúÐBÛ¦í0¥LÞXÎÐ"äbÆõÒ#\Ø¹"RXÓ" þÃX<oW9ý`þ|sØmp+É¡ºÈE	]Í»0ZZÖ~rdýFB*Jr:¦¶(y*¥ëK--/Îv¡\Pã¦}WÃnE'ÒH;ÊãcT°S¤h³R
H3¸áVùKþTLªyØDéà*;µ[¡,)´+z70Å(}¿6ÒnÝ­¥l
PK`C¶uÿÿÿÿÿÿÿçî£üB>°Þ1ÕhÜuÒ	cÙI«TE¯)Øx«©±ý?¿"$I§K^i5äï«ÓõÜòU÷ÜF\0e»,ÍYRvÌg}È?FþÝN8C'Y~sa,¼»¤äµ»ÿqÆp÷æÃMÄ?¤Eº&¼ÆV9r!2|ÉÙ7GF&üQs1ågÖÜÏ>ÑL*E«o:w¨öç¸·.¥¬qõé$sÀ³yìÂÙxc!Y÷Í@J"9=ù2ûTõU½7tDP(º#täXx·4ägßÞrã¤=ÃÝ¨FÁÃ¤ÌRÖÕwÿüIüPJ©~¼-£üA{½¡óÌÎwãúaçÙ[Ò¹£Ø¦ÙÍy4?m²hàu{|b9Z¾ð\¾q0pÅiÛG:@%Ë÷0_
¦X¸c ¬Ê4+ÜUïjÔuÑk-3yÅÂ]áÐÓÀÉQø^É"_áKªW[w¢"yPðãÍ¥a
Þ@FÊ;Þú¶âSê7Ëý}6@$;Ê¯WòyÏKwI£õCãµp§Yá´ÉWÉåÅÆ)6¦¤|Ü®MZÎºMÏ$|ÚVÌ?»VoþÉoÇ=ÅÙIÚQÞq®Ç*zß^f!²Ø~¾Õõ[@£(üSâNÔUÙ³=ëÕëÛí7Èt×.»¡èSé\hWì)ªW§qgeØyÚÜT!àÑJUxa¸wºð<"³>{z£¿"êÖVÎ07VõtÁÿò5Åyó¨
§ðå¶Ls0éy µ£å<7°ãrF&ÞØØA
ÄíÒÓl¤D¾H¿åL¥ä[Þkgúiùö8(ËæAK³ê9(FÏÎËv=(uÂ
·L*ëóJ°aµJÅB43¾Ï(ÓÃíO³è+\»«"K& ÞM:Ð6*Ó$%cy
b
oú
P¦ÿ£)<üAiÕ%·Ú]!tLyò(ç#ÁïJ&T¤ôc4·$Ï qV_Ä¦~¼Ñÿ9âNÐxh²hÃ+U¼Ágø"	&WÀ¹÷©,Å©È)Á&ßÃ|HôÇîÝ[ma^ðnkÂqÉÔü&P½ö	XnÚ2#x:10ðæØ¦RgIðTJÂ±¤EXàW¡&T·I'«JH¶à»Ä*UÇ}P1ö¥;4è:öãÏª"ÔtòÆ;eát;N¸<éÀSÔñ_`àË&79cpÒà³"DX9|=L¹åU]Lî`¹Ü<Y¾kÀEÇZÓ_¸­¬©<ôáB¦P
KkîòññÒÛRe %h*¼£EPüAðE5ì]AN@aÞYÓ[:~lS~kê£AØ±ñðéô{È2´©:¸ÞÜ±ø8.CÊa­ö²ÒósA¯Ý)z³RÊrq.3jÿ±âørèöýuùÔE/ ¥ôUWLåòÊø¢NO=6A%Æ@ÌÒÒáÔê%`·É©ð'(ÔXn¾Ôn`B<§¥Âmùjôba}:>÷áJ»ÐÙéW(tâQû¸²÷²ñâÃñDÁ¯-wrf¡8)DàìøzêÍx4ü×óâ>,`ø¶J½bà.8Aetôñ½8öëK[INDÄl`×.¦üô;5EF\ûgÛÛ(TgÆ
VÜ`ßÍë¦Õ)íèÌ{Ç$dµ&ÿþ@üo£EdüS¼4|Mâ0<~qº=M ÿvøï"ð}ßÌÕø?}ªiï¶~ºjyùl5´ÔA¤ÂÁÓ,a4r¿åU_)@=õ.!¾ä»AkrìõÊ7OÙz¸ÂåIÜß¸[×Ë9/¼bzáÄ­a&ÉàiþEÍ°èÛs+üÊlÙHýo8¤ºÖ÷Z[[Aâ,cíÇ,yLs<$¡x¼û'19þ4©§O`Êå$ò2GÅåáT§ªàx³èÍ°$s¼u£#Î>óýQYKÎ3A)ên©2qaæ¸@Æù^
S«ôÐûD:¤Ìµ½bl±QÚ$ßa÷)m3vÅû¥ÈÉL£Ùj¤'öÛ°?íþ©}d£ExüAåÚ:/)À=Úªöx\·uvTóÝÏ»xZLk?Õ|j3xê#lF[¨Õ»SCxÄÄõ|ÔÁ¥#Ã«K¹ÛM(A«±]SöµLy_f·,{¨ÇØË½¸ù©hz·1Ó4í`HeN8C);Ñ¢*õâï¸r¯eÛB6yáxP»LÖ½Ylu=¨dÊ${>¤èºeönõt¾úLUñ_<Æ(k¾èIñºl-ùîI9Á§jn~q#½PÃRbd`Ò~æÛq}'$¿³±	¾l~ÖIìpç%íTF©8x[c!Íçµ¶" J)RP£¢=iLpbgwè<ir;jöü°JööñuùÙ`Ë4XlÈ>1ð§Å°Dm»ÙRj¥¥¤£EüS:OC¾qñ-7l**èÛ¯0\` Ø¡³eé%2Ý³}WéìåKe¦7øJL¯mTèvgÉ wMc²ÊÜõÑúe9yãÞxÚ«.IP6ÕîáR("ñ
ý
	¨Áúñõ+HMÌþ¼e§F èv\èÑÒµË6÷.fzÏËÈ Vø>¶+tªl¹ìi³Ö+Í-HSOÅÊ8/ ÿ#¬Ú-a<ØtèÞl3ahÔ7[ÕXL£Ñ
Ë^}6ÍãÖ6Ñ·6Q4ê¢íd5m/ýBþH¼y¢¨=Ì7G^r:àW¶maæ(¸:(ãà½ëôøÛºÇLì¾
fàÚ»v;sÝÿk[nFÀUÿ[B¶£E üBXËßäKDo½reñ©ìà/Ä{]@¢ÙD±$×´ø¬ù7í·iF³±0E oò1¢úHlhíýDÅ1qì|¬#Ñî1:á·~"6
ª[eÏHBaGo§ò{yÈ`òãýºì©;4.ÿ¸j£jTç oñ3ÏEìW'û`íé]ÄÓ<®½X¼pC¿üþsÉ¦~HÈÝj×Lÿ%5(ì[êÎGËbÅ^}uoGYbòYÔÜûÒÎz¯WzÞÍbü
Ùö£ï_Á]IáÀ¼acôãz ,¡&ÓásBÙû«{mdÆà(ðwÌ¨ºUl3ÜIBª$±ûªìÑ»á®7PÙ_D$nFÛüRª´ð[£E´üS¹²QMFO¶ÿ#gÍ¨¸MS[ÀôcöO
3ósíÎü	ç¸$8ÂbÜgT°
Øóõ\¯'ñ*Q;Ìpäl(Z]açHn;ot=¨ä±øèÀeÅô.Wù4v¬'Çù©¯tîä§9ÍÞ¤:!!2£Ì°3P¸o½yjêDÆ\$p³V°)MÒ»T^,&;_Þµ¦ô*Yëoe¡ÎrÑ9ÁÃ'M[@1%)Ùä7<·¬YDÚÜÓ Mµz;°¤¯`\G=ª¹Øè^ðþ7úF¥ÊZ;$°¿
ôöPÙ²
R¿­«õ"O_Ø¹°&BêÌû-C$éËÙÛîÚÁ<`YÃ¶ä43uÞ&ÓwºèÖ}Æà¬z`?oilßÁCöJ£EÈüA{Ï¯OaÉÛlsà·3[ÿé<Á<ÛÚFî±Þ6¦2òóz]]6X öÅK³Õ¿AO|s¿<¸läÆfþEüjÑr%¦{ÔºJÕó­ýCë¸ãÙëgM-UÌm}\ùèªz¹$.j²ÆF§ùÇ×º¼`ÇyxÅ&þ´Ãdë³Xb¿eGCB>ìkùTH½t±A<]|ç/¦G*OrWà©GÇðÈ)¾é¶°B²ðNÚÐ¨¤)GNÕr-q`0ñ·_¥Jå8ßÈÊZËvéhGNôV&	Ê
ü'\Ç!ªWçÇÑ@åð³löhjöÑºaÕL{y¦¼ZCÈw¦\g_ü5ÑÒ[öÀm½þÛWè-Ù¿£EÜüöQâ¼¯2Óí¥þ¬×8\$ÿ­;(t'ÁAB\ùóëçæ£×îaÙë{tXÉ´£63så}©!R72ÿJÔ)z$Ï¯gg§¿|÷ÙiÞ4Õ·3Á%Ýä%{êwÝÈþÄPaÄr¯
y*g¨x±c9½b-ÛË²­:>[°|tèÐ<´ ×¨±
çCîÎ<ÓJC5ø"ÌÄNXRê ²¦i®ãpNÑoùæM¢«Äª8÷(øÄ9Å¾þ`f|P#)
Õ§Ù7Á$7*c|Ù ;sd°ºfW
ÔwÄT3]|*`åeUèön9HÆ{ðyÝ)fÕÇÀt3r>n¡^pºfÖè¨ÚcØÓ&d&Û[om¤ÿkUj¶ÚE£Eðüõ!óîa.õY5æ`ßIÎÐXþñÛjÿC]1ù)ò-L¯÷IðÎ¢Ë'mÔÑÖeßIÃÍý÷*2ÊÐ?5IbIC6Û£vl·hÀ`ÚÛàNñ½Ú.¶Z4äCn :¡E~m¤DB·× mß®Ãw0×8`Ãª<®¶fLRy¸-üªP±º~êºUýa}úø;©3.ÅÃ
>¢¡
¦úmøz7½v2jã(0¯3CZèe<RÃþ4÷7¿läNÌ9G~C¿ípz®ª[fwrS4Ý)yæíòuUèÙ÷¹_ròr{ÿq£S@ÍCqÂs\²VÊó+éZél!pLàw+xäI¹6ÚÐ?·ÿüÉþ@£EüSÐfÖÛÛ'ºÏ÷#wâÝ]µq=>Õ"óUuå9ùiR)â@k÷F97.0|ç¥²Ì[êÎ )y${tQòÖÍæ²þCj:D¥e÷iÔ7¦H-Á6¾ÊÒq¥ÖÓCÐ@ÏKçèíf×qEÁ´e%ZÁãù(½gs­Ã,òøj/æÉù$I]3Ë%èO´1AZhéOBÉ_½OJ¸]¨ª?5H
­lG­%ªÆAô3lÙ}9J#b½	&Ñ­KH<äý¤Iî[{p_¿yFg}ï6ó[§fy:YÐµKáã¹¿S&ù¶ÿÊÈ¦¬¬Fú]æí*K-,½ÙÖ9Î7Üõ÷$´$ÿoÉHKêû£EüBWP&Õß4ZQ¹lü¾S¸§eVt­öþgÀåÑÁ *¸_ÿéõ§^åQ¸
·ä÷_ø¼×Ayñi9T_ØîýÍÄÍ%½¨×õ7Àmå©Äc:à¸MZ!WJ(øøå»ï­r@Ô5i³¸Å¸ê#ê|cî1ãÛ_Tï+ÂHbfZ7Îe>ëËE/ÔÖ$úÈ­ãSÒ ×Z8èö7=[WL6Z2ÜÉ¿Øû»Ñ£Ëlsßl©êîT	&$2?µFM})dX°Ïù¢,Ôð 6ñ[ßNv(ùS\Ñ,UèçäAãSäôâÜOirºµQ6kó`6|
«9à ¯~]Í¶@¹ø/²ËÄlâ65lYK¿&@	lm©CíÚÐ£E,ü[eÒ¨bn£¿^<±S«3d,äd\eõ³@3)ÒKhÓz>cDgG*"uýËëÁ~5­i§gW}½¢F*÷d{;Oö­Éõ#ÂF¹DÖìGaé}ôhòfJ8-RQòsôþæFfzïãÞWä´M{Wlã+`zt\R*0Õ2¸ék'#xéÞQB«i
jT¿M*86ÑàÀÛå0>2XÜ-T¿LÊÜÏVÖü¿dPäbúVv.H i¯Ø¹'E$U@Õ Ø´%bóep½Ð¡'æf³æ ºÑ¦\íÝÖ'nb	Û¥^¸YcÛdÊø]¦áÿfMìu©dNp:&ò¢KKfÿþÐý¹¤%¿£E@ü×ÌG]çh=èå­aSÿoÚfûéíÃË9ÊHØY{â
¸ÜOòtdõZ¾oÝ ³À6P[==MáüMÙYEÿµàÂ§~§x¡òS§5ïP O|T¤@5"ÇYÓCÄ%WÐåÄùGºN9	uuRËS¶5Àª~Ê5áaõ5Îé]Õò9ia=öÓµMØÉ".L!_/C#-9^î=HÂ/AÃýkß4ÏÚ2RVGêîKLÑ¹Èþ«VaOÆQ{`nÙëO-¬º;^*1øpÙF=|î¼òXº!¸Z»çèóö¶FÅH¿YÈW$wúyXg7)ÆÁÑMä|ØV½¡Uû<ø+vÙ$­·òvØÁ@´£ETüAðIÉCþùCMÛõFr-/6d¿kÿO>èþLÉ7ë+â$)3!á'|fv}²i1ðâø)R ùUdNVµÏÎÀ9w±»ìõcµ*ïqß¦Î%Ñuðâ7_¡c!¡n¬e·w±£[tß¹nòHJûþ²HCÖ®óíJ*9½q~\7QrÖOÚ1Ê*>)­Ü_B!cpÌ¤SË°ÕçëRr_K¢6õø»`AQ?ÛCrÛÃçlÃÎãW¢,l¼N
òáÑ¢£V)ZF,VÏÕÙ|÷uosIÛ/¯;æÍæuÐe6îD¡´Ì'ôÇí7øExërÒ±Ý/H'¤àéÞbm4L0ì¾Â­×?ÿ­nÐ?úûRm£EhüS®fX÷Á§~p¥¦LÃò±åMräUî¶(ºJ3	ûÒÍÏõ&ÄÕIE1â«ë¥PyBtMc9eí®ÛHd'A÷m<#â)ÇÔ!hCÖ$éæ:jröp«QÔütú}¤|±´²Ó^¬D5BIý@±«MiDóH«çh¼ï\ÃÞÉ@mjckµð7
M¾øy«ÃZûpûÍéNÏ¦6Èg~$"èLj)á
Y¬-R?	HÐnßü*§Ã¹¥µ&¬UxÐö.#ZHàÁS¿6æ5X6paÛÿ%F	>:Hz6«±©qñQÈ~X²õÈo­jMÉÉ^çãL÷Ã¬J¯cí&K@þßÿ%+Wê­µ£E|üAïÿÉV«I%iSM½£©öÃbêÍKyß6ÉëRâÛ·ÐÚýLÍ¥ ò
~ØåÍ£²îàûhº<	Þ3!Ä5-*|5Jì
ëÔýs|úÇy©Fp[ß[B@©rùF[HSºý,u¯IB/&\ë}<Í{$QÙDämröÊþ àJ£þô}Õ¸½*æWK/µT´é(5¸³ðàé¤êÞþD1*¢?àjÅx¡s7D\À±¿Ãsçj62ý¸ÞGlN¬bQZ¢úVêÏAv¥E ßxù¸©
Øb.Ç9t£ïÕoÏÜÉ±[hìqÆßLÊJaÈ_ ¸âÖôçbdþOö'eI-'`£Eü×;6ó¬*umOý#E®ðº&kÄïÁNXiâ®äöù·Bvy¤Æ:m{F].Ù=¸èñdF@ÊÊ]ÓýzÓ{4âOúUQ­I>¹q :bê13/Ecå'þþ¶Õ8(l½Ï1&.j6X¿3G£Ö$sÑ°Y«ù@¢
\ó1~Gg°£(ÓA>¯`Åë:~j§3Dès	dÉRñvÓ:³0¿¹t²dôò?É±kéÿLÏd¨U>?Ø(\ú'öTpÛ|ÝÆu¥ÿ!Ôj0Ú¥¯¨2Ì3·Z/g±«wâR,"W½¬ïwNA6.]Èö1Ïÿ7ôé7Ýè^JµVã~³ïûdl@oÿnE_úÿÿ£E¤üSV¨m-ÓßK÷£±2ÿ«ÂM¯YÕÜ_G úVÔ.\óf·_`q¸í1ÛøèâCA}öÞÅùó+Ù×#ðAGÞ×å0ºã=%ZÕÃÖ+6¸Þúaè¤ìº8lÎ0·©¡uðùz+ì¦z§Ô4·´Ff¹«Ï¸0LÓozø'oòºÐ£ ¢ãöMkoAb÷KËl¼¬F¶+AÉG-´¾j	0µX ´=¯ßCGÝz?³r--¦Õ¨7È°fòø*ÂÞøTß4 (uºL°¢2ÔÝ:CÐCr7áKw!/<ë¹ñ¾Mºõ¹Ãj¼Ûã|ß§&ôRh1{×ßï¾>¾·"Jàv·dý)$·ÿ£E¸üAz&ÖÈ Í1ªÐæ@FÔ?åÐö@ýù÷ðfÜ@M¼AÁp[+«ïf!ÿó4ØÏ7ÌRæW]¯ko÷Qý»ÖbUwá¸`n8÷_sKwhë¬VE¥pï$÷$!³ÀÊXúc91pe'«µHÉ=ÈÊ¢«ãp»¡¶·íÁvcNåVP¸êwäÿ×vÜ«ákýB­y$¼cßHfÃÝ±úGÄéo§­¹P]ÿ% Ë;*aù$©Ý
Ññ:ñrñ-ö®4þvÓîóÏ»|»ü­ÂûÜ+uÖ3 ©F%­ÆiÐßB ä7?Ä`DnP~Ts¥p\÷}¸WÁ_\´:Iùf-kLfjBVÏ
*ò£õÄ+àb	:Ç¨Û«u'û@nßí$«×ÛÙ £EÌüBWö,Aýô¤£·;	úAÇ;±'Ö¦òz¦ðã¯Æ.ÜKÍw©EGý!ÃûÏBÄÆÆ¾'Ø\g-TæÌ{'ô¼üñèìf«ðûålcå-pï=&zS1vÎèlÅÂD^©tZçþ-°USèQ?4rp°*}"«a*¼ñ³¢ã×»·Gxv¶üÚN¦aÑõ¶;è4dþ,J7´F!\kí4
U´ã0ÌG~º¨$p-ÁÉ4Onà¿\µÔÝÁ@ÖJË	µéÿ¬¼¸ EIÇ¥ê1/î5_ü¬bÑ+ÒÐ9¹NSOÀBD%ÞO¤Á¢»wUZ=n§åÞè^º*{1Oè
1Ï}-Hÿô¿Ö¿Kj£EàüAëY£·|fkòñ³[N£¡ÖÐu 4|`îÄÊÇ=Hg*ÅÊBË}EQ¾Ó¼£}¢uMß¾¿yó2bþ;ÔEÃÏîbäVüíi]W°ÕÕáù5¹Xøº.ì8¥ª»bOØë
¤¸à.iùDoýöÌ,%³SOèÕ×r«tg|"Ó^ThP2èjØ¥oã1ûÏçX
Î^!Ó½Z`!)Ae;+Éq\J¤Ã­C`=ø(8éÙ7íÌ|Ü9´WNÅËïé¡ÃY¹Cq3²q_5ß¬µ_ðl´%éjÔ"ñÇöîgF²ÙÍ÷}Å£&_ÌAãË1hzÏdõ`fî¡áÞ ±`È>´6¿g÷(V¬:m+IþKCÛþ¨*¿í£EôüAãÚ«Z(L#9Ù}YÝäâ°Ë;1þË£+¿µ[Þ|£T9<âQnOI-ª>®²æk/Fg±AVpæ¥,tÀ_ÂAc_hÄ§¹`5éB·i"ÐVU!éÛ=ÿj>Vïê¿%´@O¡|8Á5Q"8èÌ'xÆ»/Êìté}´¨º<Ý;æÎ*ïÔÐ's	Mµ;´.ä\ÙHØÌ¿Â}rÌ½õö·mÄõÖªå÷×z÷PA¦o¿é:@øæ5¦:CÏ½éîÛd^(ÌôiØê¬
½q9| /¼±VÏþ7Oº®9ù§køç»hË¢*çcÍPTù¼d·¯ã
|ä.ÀnÒR&ßü6%è*£EüSºÞ¤m´çÀO½zh6ºFª»àNüewp§Åæáè×¹·¦@¬Ëú<¯eÔØ*jÂRh¢}ÃÌwøÈÎ<ÏÌô½²4â¬Åí8"ãoÔHÆ'ÅNFâ8gv¿Ï"=È&°ÌÖ¹áRq8óþùzm¹Ù-)²ª
~×^ÝéõÿÜ{ý¾©¨ÿçs«±uÐL_Í¾,-aÚ ÇßY´/r\"ø»ç;ò³©ö¼ÍãHÜc§$ÉG©
p£ô+é8ZüªtUiUå)LÅ,ôþ,¤ÁÏ"Ñåáì- ÀÐ5eüÅáÍzßðüôWàEd4ò\ýJa<fÙ>õüûÊ|EK¿nÝHþY ÷ëîÀnÛ&@µWÿÁm£EüAà`Ä(¦K©©ÃkÈzzäó»6Hy|¹eZC#ÍÅçdð7ñÆ¬¶~pò !4ã²³ýk¨Í­X^döÀ²ß¿ºè.J:ImFþl¡¹¥qãÃqM²S0Xö÷Ïï{ù/Ò'4â3Fö ^³&hªâ¹3èä¶åFFl5ÓvÍñÅ°¡i@òq	¼xFE¢c@é7
hP
tK||q}ÒÕð¤dÁIJ½ô`Aa'Ä´Dùp¿ñtÛÂíÌ»M³ÍÔ|Tè·0¾ÊA;É*7 u¹³«Ü©¢ÈK¤"Æîm<ªy½è·Ñy¨%ÃK Uíqº7I8ñ:ñHbã¯ÚêzÃv¿ë1­"ffî&ÛÙ+@òdh<£E0üAëZÃÝÊá»X¶õlQÜ°w&h¾£3eykå7²"J*¿ä·
hM.Ó_ÎU÷i.ø÷÷ÒÉÞCÒ)¨Äâå\
µì%§gBgWnQdã}ÂF-Û-
ÿ2ª¶dôOúvÒjÇ×%öF=æÔqì«=ê5k=ÍxÝ å9C¥púm¢±|Ê
Èz¼¡§;©®¦dE(ÔL6~Ð¼)HR_3Ø=¸ÈCÈ¸äPluv<e:!8À)¹8â3¿äÇ§?åÈD®Ô]Kv\ÉüWhNÄì6ÂSºÛíGÐÙ
ë&³ªÖoB#ù jÑbW¬Èt³vQ;ÓÒÝaS¸5iq.ÈÍ¸95#:	º{£Õ6& Y¿/öü¿µÂ¿É£EDüAi¾9bÜ~óQ¥ )õ4ó«zºE+jPàÅ0ËC¯NIÝæÕçÇWùÀbßPÁxl,s«,Í,Ð*äò
[|ë'`ÜAKthÇK Lza¡;ÕY oNí{TjêU}ý*&¦íFn¶¼Q+lsaÒ£&±\H·0!_muÎñÎÞ4öÇ ®Ð¼ß;í;/i
LºèL¡n:÷(ÍÌÀÕõaEAâÇè|ÑbÉVÞôübH£9½¢¾2úU£Ð¦ë3UâxÒ/so÷¿Z)*×0ãøýL	
&5STn`Æ¡Ü+Ïçøh<a ÐáÜ¿vägþôJö÷J ¾[Vó]¨ï9ôE4××ðI°?&ÚokÁI$£EXüSËYçÐ<mØj*ÈÖ
ò?ähÄ5bÑ£àF¶Á«#b'g"^leµJ¡|{EnÙKçRÅLÞ!3zyâÜcïWWr7vÆ}[¸æ«¶Uö<µ8¦ìÜÆê}§´9Øû¶
ÈRÚ¤@[.}	DÅ!$ÃNäÖí\ûã*P0éàøÕÑ{§´Äeymû0>Ç¸ò:ñr²OFXb"°_PJµ¼¹
L¸ô
þ,Hx0^*EÛ¤9 Å®7·ýbvâ!Srª9½ßw¡ÝjfËø¨Ç°÷ÃwZ4/¼ó](~ø³ÈK½>6/|°Zª__[ì)ìðròtî¯_°*OG©	Çýp¼TÍëµÌ\òë& ?"dÉÚ@(R%*£ElüAëñÆóÕ.U°»í²´^Â~ÁÆ¿ÿ³úvZßßÍ24B
ÌØ
ëe7¶C 4¨Ctí3õ>näô2Wg¨¿°tqaQ¯GÑN
ÑÙÅ ûVÜ¶É¼à¶aeÖéý¯Ý:C£SÇKÃ.xÇÙLgKÉ¼Ü95¥"¦7á\J5NTß/$+jN^¦-ýñ
Ä£0ÙÓäÛQðd k,uU. õìáaf¯Ð/³ÒÜ½lªÓä ß|±%ÐÙ(¤ËìþF/á±©&xÇw±òQº+.7³[L|séÓ"Þ¿ÔôÞN`5Æ;vl}	¡8¼(Ý2á12F_«ÀÚÅv¯©*³¿_ÝDEÂ0X&ÛRJ@	ÚÚüÿ×ÀÙº£EüS+Çn»ÍºêwûîE¥X]
HS)ÿ/­ÅzèÝyì_\8ç©Ì4øTnã,ÒExëz¤^GxíVÏ0ØÀý3Qm_7&Â?o¯u^0>öYîÓÒÏïïíVW¼®Y¾gÍ*|°øØÒ£ÁâSt89ØÂëøùa%1Fç6ÜÍ6~JßõÉ¤ÆêNgF>R,`=Û§þ=-Q-*Ð;Ù¢CËåùöØÇ`s­Ó|>aL³zë$x$ü_£ü|É
Ôt,Î/xf9ír¸×e[/>^yÇ5DB§TäÝÌ5RUÄý¢
¹06ÕD
ýÞ§uv-ZõDJµõ[FYkV5	¶tz°¨ÖfBIþÕ·i<äe£EüAyçCÀÏu#d	7>Ùe³>>_æ´QùØ`Nl{¯<gp3Ý§ ZSöuî¹½¼Ø]CÆSØæÂôóx»âÜ°*Dù¥máøþãÞï<²UÛÀÐDÅhÕóhìú ¨tD:j}:&­Wª÷H&²I¶±~ÄÑy@àËOÏ·oF$OH{á¦É©EçV/Òý¥"÷CgòaÊH
ZõÃpåáÕ;ã¿çCR>«íïæX¤73:À}nv±idìÐ<
2õpH;yõbnMê©Æ>obïÜ¬( ¬Ö@cÉT´Åìµûä¥¼ Ãª7 {/u±ýmÚdy9°P5p g2PX'Í¯$Fz*:Ð	ÿbÚJÿöüöH£E¨ü×F2´\]6(
xþ@^cz¸óBÀ[4[Ê©|ñ^xá×åeLV;tæ-nÕ,»Ç5¸g$b -ó÷®`µ$­üßpN{FV¯ÙKÿ¼âù¿1°æM¥·eÈJ,mc6ÛVq³¿ç!cÉu-Ïß6JÔá×øÅ!¬5ÀÓHÌoÚ%CÓÀ?óûÅ(<GÚê÷«j¸çÔ]ÙrñÕ·A¦Ð£½L¹¡»¹þIr=±`Ü¢T?'\
·æMÓÐVÛ£aíWP	úñÉÙhÝÏÕS÷¶ÿÚ÷Þ4 '¤®õÐ°hóvéÌòfÁ«e9BÆ]IÐjïE h¯uÞL
P!®5Ï{.bÆ¡4[o¸ïa½"rîóyHÀÒIÒT>Iµ£E¼ü×F.ö'Ú¾Fi|ËãÄN+öKªC¤Ö$Ák%Æ_÷AwÏG;ÓJJZÃÁá'»u%íË¦§Õ±¼5>ê	B<X-®YÙÂ×-p}d¤lØ©Eúõ,AæõºÏIÉÓÍÇÀ´ºeÿ?käJ¶&øp¢rZî{^m¯
öR¯þÙ¡OVâ?¶¾,@ÒMUt0Kü5(å[[6Ã×å1#é¤4©oïÌ+OXô'óÒmÿ~exçôdõßkÙdò½¢ªU"¿=ccÄÖDÇÑôuê¡TN¸Î,øçCÈ{äÃq6S;wîvrM¦"mÛ(è_]Äê¶J´j¡YgÐoQ¤gxï^ PÍ|°]íH­I"AmH)Aj£EÐüSôsü{µ>	mÉn¦	\-ÞE¶:\ÀáëfãÉw¾eg)èìµúèGe_½óªÃ°S¯­è¤ßÛ¹KtÊ§YpV<7*×¨õ\ü­°*AÄ~DvðÊÁádF}Xí)¶6ë¦v~~Å:±L*µaöÑµ"§mÏÔNã½"3á«LbZ=!Ä¼3~MÎøÙ¡²m¢útHÿÉspZ6TýÔïÜÚ}´ÊAWD*µñ¿>®m¼qóOS'KP±½´7sþÚ×Kû25ÞgÕÅ¬WIöuHcq­iÊ+¸hºË1à{¿}{ceã±×»·äÕvµ8saÌ°oíÛèÿú¯£EäüS½PiÝ#òÚDËøÑÛQ²èyÝR?³{LFQQÆ0	ùÔw)[STFÂËE°ïB FÌ¦¿ÇòHÈRÙ&
°âGú-¬Çõbû]pJ|¤÷`Ù°0-zK»þÀôÓ&wþ:S¦x»GÓ×e4T«^ªh¬ýÑÌ/°[ H¹ÌÁ×¨/9ÎIl.sùh:9× tÿ§`Ï­ê7þ%Vc Ýi)àÑ@Óh;âÃØØceF`ÿë¬
ábIG*Ò<·sA|8âCÎùô¤/ÆÀOÍ5'b¼¤=åÇ®×û®ï©Îz'4uÛ¶öîÞÓ1Ôøsm.Û¶ßÛm)+ÿµWÔ=m£Eøü×èûB:mXÀDbKºuó@ÝZÆ.ýìNg¦¯U¢\äx¯÷+ÇÌ$þôhsë¯ðÔmÅ~ã¿Rvfíé«åÄà³S«®|ãç³O|5àÆø·@eÕL
ç°ÞÛtÇ_ÀüXbîø0ÁfCÁPä+Ü¿õRÞÊ_ì©bKqñÁ
qZiÀ4§Ò;Ð¿¢(bp»¨&¾p1ùÝEV:JuR³ýxÕÎÁÅHz³MÐ]

v8ùü'ï$åSNT°÷Å¶õÛ¦¼s^½Ì%>þo*Åd®u yÖHtI`ÚÄenU&ªÝI7é&¨É o6KjIô[åjªNïÅëìg«y@Óñáèc¬³ÐfIhRIi-?ÿnÕÿ_Õ@£EüS¹·ºøôLÐï1vnW\N8?Ò>ÝIaÔ³¶®Ù2¡EQ}!ª¾¥åd0£È×ECÓ£¼ýÒ¸´ÉÏ	úÈ'ª¡¿Á²DÿP/Þ%G¿\9kwDþWmd0¼ÅN\ì=fX}"ii½ç!ó%õôè
ß(¬ë*òºqOt>`÷×Æ°Ú©¢cþÓ@¦±`Ùayñz,V"ÇA%xç¯"ý2¿àoðS.]HçÕµó±|}åSôÕ:ä{0«_ª$í¾ù¶;zúö"¦UQýB
ø'vví9öéT¯¦ÆnÜnõ8c|wWãy}/XãV8( ÑT¾tÒ³Ýõ¯7neÙºâ·oÀ&Ý½jß £E üB1WÛL»òñoÛè?aá+Ä}YOøKe}5ºb«4Qßúi¯¨âç§¹wêåûïuþûx`Óì°$Tá`æg°¨OK'ªá©\¥ìA7sE<qId¨³¿¿µÐeØÕ6Û£&±Þdäu®Y0ªªxËM=C7,ùHP~7°PHþ0=.v=Ae RvCF­ ßzÃTl;XÈ¡#±¿¤È¾f_jjìXêæ¢Óð!Öö}¢Æ.|ã¼PHnç0À ö¹ðöÆjÍ`ÇÌPû»!ÁiAyG¬ogÇÿÊ"#ú+TwxÉXÚ3
Àöú%ép]í¿òi,E¡³køÒAcè^²ÏÍ1É¹$eúð Ú°£E4üóéª3ùv5#4÷$aÈÍ|ùÛCS,ÙePq<|ñ§ð0íGEIßªl¾íÍ´åAï®8¤A!¼2±hÔ¯«ª¸¯¨Ñ²Î³¯Ô¥_jNû¢¬c:áÖMn­Hl¥($ì698GÅ¢lßw½¤«\Ûw ¥=wzïË(7÷ÌäÖ,üAn'¬_U||*5@m/¿À°z
Ä¢yâÂ
gÂ¢ÍÎúç: Ú2~-QTW.
Pö­EÁ&^ìë(ñäcìÏËGÛW«VM<Õ´APm§þÕðWòÞ!ÕçTkÅ³YkëÉ5X·ÖkwÒÝ=ºÙ­©@`P-êèÂK=`ã"ø	Ê*ÓØ'DoýÿkdZ¯úðª£EHüÚ¼×µE<áÉû(Óá3g|v wÍÕÎ6d.®'ç­åÞ°:Ô2&X
EÁË¾§áÉmØc2#«Ã¬Ù©TsÛÀûèìvA$Õëp&¾GqM¤ÿ,ZUIºðªü{èò´åa^OZ±NtìåÉÇ/Þt&^éSw­jA|§	e=È×O¹W×ØÐ/VVæÇ¾CÀþ8u¬Ç)´íX'¸^iØIÔèau·<EÒ%/ÇîëÉ!!éæÀ9:×/²}'Øt²á!n9¦=
¿\ÒÁroÿ9A/tå(w7Yìl.Svÿ2g^,Y¤w:6T0),\ÀeÝÙÛÿÛPõðú
ð£E\üSØ¸q'O´
â~ôNY Öþ\EþòÃïÏÌgTª?Ô.¢&
·o÷	7ÈÑªÎSCPîÚçèbñ+9SÕ²
°±
öHývÚ·¼7ûo=gÓÏvp`ÀÔÿ%í¦©íÔH~|(~Ü¡òg-À¡Îaö¹A K!F-Ö@_µl£8¼Su²êi'>­©ò?®æF@s£Ræó"ùyÇ_µü¥jyORÏÐV'`¨õ0î ß´cZüµâ5ºf7jÑ¡.±vTÃ»þ7þ±ç!þ§øÿ¿ö÷]»éZÎøh¨@«[I¦íbÎ`¦>8i ôÃy7òª'&F«üUYÌµ»Ý¶_P__¯õ£EpüS¹(³íml"~GÄLÇY_K»Ù7^ª Ñ_>÷r._'C\\*À
2êÁæ0rýç«jíÚóoËÌM²ºwK70?ãT!©a¹Üª#¥Ç«?ÔÝ0º%z¢á_î=íÎÐA/"6;Ð:¸=?w¸HVcÖgÊ¤!¼i ¼~JÈ°9o¦g²Cé b²9±
!¥@bL×§ÊY|uQD{Q]×7A ^ç¨§á^Ht;öÔPnÈá'½ÌÁ'@ß¬y)WÒp§°ÂOñÝ^IøQbþ}ïå¾&8 òA¤ìpbÄ
ÖëXÊu½îÙ¹¶CÜ÷r%Â9ÍIÐÀ¦ÎÎ°ÿÒ ª¯¥P£EüA|U?þ(µíúµ4¶û¶ý±öY{NOâ%h¦ø¬`ÏUpª§¯-ZíØE³RíCõâWÊ²ðÖfêt'[Ù;yìu]µ§ÜµÅf·«ô í¯ß£}e]ÐýhBLì_Ý`Bj¯^î¿O[~!µ(­Ô!>I,i¨!ÅQvëQöEá)|òMlÿQYÓl £IøÃ4kÉ¯}DÉÑÛB)kZÊºÞ3Ô.»dï7ól¦?êÀÊÜ»ý¦!Üöä$ßÜÁÿÐe»QÐþùl3¤ßñZýÉ·ÛÒA °Ïüj=ù?-ÿ@ONåï¬è¦;SrÉÐ%ÓbG3ow# J&D%¹6ÿeUTd£EüS¹}læ`m¯1d£Á1t©uµÙk9±5ªwüI©Mµc·³x²°BO@¸ @®§o_ê1[¨~·ÊIó,Ûúz4>ºXËÑÈP½V	ÞÚµ]D9(ÿ
[ç°è_ÕÓ´Å¡ÖÎÉw<Ñzq¿õ¢é³C}~5óJæååõ_Á	tx@«5
ù¯\=3ô·4Äð¦+½fV öþ¿fêuÎ°!P@N»½/å­|µ,?ÿ¾­=lG¥ÊP{sUO»	?K ¸èÉ­±]èô Â ýª;¸ó;³#Sà¢·½Ø0Ro·Ùôû*¿Zh=®¼íàäÝ!c{H]Vö¹þN/dà©ý:Ù´¿ÿöö·ÛÚ_Z´£E¬ü¬~kAÞ-RD@Oßþº
`d%±@ÖRpÿhBÓ±!GI±i½ä
cvò­0uÀ¼o7ÊÕòç&oc 2µwÚ~y.ê+DµÒaÐSzOe&+6ÑêÒ]7Àÿs_BZtÎòÞfåéÑÇ¡IC>¤e''Í·&çûøÛ@'+YvIÉ´ý|²É©b^÷3òe^B
«x_£qæÝ°
[]W£¨?q0À`A_¤óDaøZDê¡$ÞÔïð²VKh²Ì½~Ji]h6Ó7¶¶oíÿ²Ï·ç£ü3äl©k¡Ò?0?Ù0nkXCa©Ñ4d×%í´tYº%m©7'ö)6¾
Ü¥=£EÀüAæ(¤Á©ÏùN)û>]U_¤wZÂ§ùE½Ò4"39"5íçÈØo³g<Üeu³±&«Óü¼ïyi¾Á	£(õØf¤¼9,ÃîÚ^íewHÂþ¯gxþO©_\_>!ÄücæúânþR¨ñþ~R!cl^ª¸F(¤ònv!{Ub,dß|ö¶ØGW,dNUúz!ÙÅeÂÓ#E¨¥µîfK÷;±8ëóì&¥µæò9¾T±Æc{·¤Ï/±À7³¾M2hdwñVJ.ÌGÈË§d[òåàTWÕ±ö
V¡õZÝßY¶8b^¹ð+'p°Mó1?×ÝW¸ÚÉTój[éRþñÃÚ¸E/ûmI6ü¹<>ý°£EÔüSË^QÞ%lþ,8joçWÕ%`/LºíÈÅû¥M1÷~ðWéqû35ý=D¸Ô4T¶1Îéú íEÝ!äÙ¨2èCtÎT&ôñI
®&¥0g¸zç`#¹ò9ªå¾`­£nr¨ÇZÙeO!\dy¥ÀËex$ éEEðåt@¡½ìÚÃOå>¡Ò_
ø®CFÎ[yXx]yÈâî½6baØµCþ*£Ôâï9z×µè{¹	¦@*c¾8[T¡ü°;®Æ_*r[².µRvügJöW±% ±Ég
HÿÞÅ5Ù±ÊHX|J¾<÷+ê]àQÙÀ7rÊ¼|a2SFó;¾yÖäl
'ÿÛõúÿI*C¶uÿÿÿÿÿÿÿçÖ£EüA{½âVú$£êäÊB[»>tÏTKBo!¤>Èêþñ6²ë¯çÄêÃ¾eåòÆzeîgg=¯óë5Úÿ&±î:¦ÊáolÕY06A2wÏ»Bí@æN,}gÞg~,ò	>W¯J	ÃóIs©¥Ú4MLNÞWÕzDûðF'	ä¾ÔÒPÓ´NµâµôÃ¢õ&¾I)sbEòÁYAzWeìbs{ÖzÒx«ì;Çõ')VÊoöPó?ØÙµWRaÜ¹&¹nÈÕ¢ÓP÷õ¢¡[ë~8S1÷ÂJÈoC«efÀú9Zn,MFyðßò\í·fòu)«æâ4°-ÓønEÅäÙ²mµ+@´Ô>¤¶£EüS¨PÔÈÞ<&(Kj©pÖXÆò©!ÿÕ(LsoüÜ[À¨óÐºbPi©ÏsÆtB%k®t²­È½"s`fÕ>ì'J¸zÒò¿²rvÎJbÊôM25núMT¬=Då$ÀÛ)R_{ø[Rë½+Ýg,wþÂZÓÝ2d«ªaäAI¶dù9ië$"ÖõdÅÉ÷Ùºvù	¦#^3ÛÎzzÅ¿Cº³Q¡ÎFÜtÐÑgâS³Õä[sýÅÌÑörLÈ@lV<I$ÍÁï+/¡;¯&+÷æ60m3¸g¡GÍR±tW>+Â$ä®=W§ý2	º¤I[êÑZÁ£Y8PÿÄÏfÉ·ð?Ðooëý@*£E(üAãä5JBàÞÓ·ý[
yêÈ¥Ö®9w¡ß#Î\ùØC#[2Y/SüÔ©Ñ%3«M!Ý
xKÀi3Oðï?ßyKì1úÇ°ËKGtãº¢ÜÏû©LCÙÄ&þc9ÄN5ìßµ2$ÓS<ÚÝh¹ÿÞúÞüyÃYªh}rP¹:Éz®Ù=%³]l¸·A»A)Ò¿pUÈÇEn¼ñåafPº¨ÛaËÿ¨ré*&f@ÓðÜG\Î+N×´Hkþ5¹2])¼á~>^>Ë¹²Äq¸þ+¢ó­{t%B]_M«v^äIÐî®Bá© ¿yøp5þ¹ez%ÓÙßeË ÓR/9?KiJKdÛd©j¶Iµ£E<üAð	{Ìä<½ nGü¦îf¹ñmjËÙ|Wùê ®	CuÃ©üÅ&Þ'¢\ã¥JçðãëT¤"R,è¸îãcqûµeÂh@§úû½U\ï»QA:t{,%$K	qE°®GÁ³ÿ4Ò*IÜ`:Ý»9Õmÿ$0]:s%TO°ßànPgH¹èºBÇiïâR*§:xKLë#PA«Ù¿=1Îâ;íáèá¸63¾1¶ J¤:%"ü#ý4xùy¤æÔ:ØQ
×åí×u	
"'É:û¨·B¢»ük;§UòQ}N5¾äc^ös×¤ö±÷Îª[ÉÙûáï¡½`¶ÙþFÿÃí$£EPüAàfÁs]Rç©u¤@o³Ê.0ZÊy,$K½JìJÖ"¨YºÎàþ ×cåì}lIæ>Ïq%a2]Ã«ÛÍâ¯ÒüÖÌaÓéù8ìÙÅý©Ú#b,)ÁeXg ö(¯Ai¦Q8üç­£4Ú¿_vIAË¦f²lxÃ¨·á|Cc*QºFÑ·q^Bøidè#6À}!/_#%¾í[±/Ñ|­N9:J]{Sã ÏFûÙPyr6
ÅÄ²]Wý<cÄéò=î¡Îeë7èoù¾aòo?¶cêxµ[M´úRÀ!½±z39t·
÷ðàÔAb ö»,½[J¹Wþ¯_BÞ%J,°ÔBDdÛöä«Àµé}[£EdüS¨U²ÏOwB®x²ñ·ÒO	¤Ô5ñùö¢¾S§,×pÝBýV¸ª?áÈàb\¤:õ­µ$õ<h~w|ÓT6ùY{çÑEÊö¯eÑðGÏ:þ¹Rt	¾^|a6ßSÐvÖq\k5þuÞ#òHÙòÜÄ ÊÐ+­àüÁÖÄÇYÍD®õnüÎÀu,Ó.àzåÙ6sG¨2_ïø¿&Z^]¯ÕÒïÎÈ9²d"+slJ_íAÛ{q¤ë¥¹¢ÄÛß({JmÑÄN¯fO±2Û bþ
'V»úWnaÇï²SPØ3`û¿=¥æ$ôf$W
¦;¡ÁXÌñ'$þp×{Za¡LÛötVSh
]Í)-·ù$h6U¯
ª£ExüAyætÕða#d[I~pM>å·¨óG¬:Ãæ8Æ~oç[|NLC1Þ÷£:MÌÁ
ÎuÑªçëÝ«»èN¿§Òág¬üÎ*¶~~Þ('¾Ü^ÓàV3fÜõÁý«ðÊ4ØÁþº&mºµÔ¼rõ¿ÍfhÜ £g# ÛxêcÀ·W)3.ý.%XÉëC£{ãßWº$ÉVaÚ*&"àtõ«Tpu2Ðkm?f"1àpâvôùÔãbN:ÙÝexqãÊz¦°LðiÕÑû3<óû¼g7Ìàà~t¸¯sÙI)ÜÊëæiúÌN5Æ$Â°óoÂRØ×~·\ãDØ__Øt;tÑµ]ïD'LÙ_¹°6I¿äH?ÿ

£EüAãä1LyY°ö	r¡äÍKZ¹%9cz&y9ðY®ÝÚFin},ÙÖòJïù
WÓH ºãRè×©ap?	xÉ­$8=MÎ\s¿Ø»T³ôaÊV«hÙ#pUÊÒìå\¤	òäú
ÌeÏ3¹GÄÈ¢îÇí7³%+Ñ¡Ôr_Ï¾qY Æç7êGË"à2vÀY)²"ï8Ñ¢âë¸ïmrßÇ·ýÿ8©È]Ã:~µ6ÁvL¼°tÃÃcOwð0ËéÜÍ03X[d§â¸¯>4?¶´Iù8 9°Æ2¼ÆægÈI9\j ì@N}Ú¢Ì
£õ^¦]½"ðê=¨È%.FU¨3åÖD?¸ö¿ÉnmP¯ ð£E üAiû¿¤;Õ¥KmÚnìÙ
im#^RævërÏmt¤dýÁ³FÁøo¿ùø«ü§,»õïÑÜÈbvVÀ,ïk=¦¸ AÏûGê©ïöMúÖÇy×¡E{{70ïà®pÐòt¡Ð¬|+ê#¬q}g³¸ñßù~äæFãeMºMjù½²¤s¶:ú1À 0BDÊ4ÇË]c þ°8D½×8«ßÖzTVõl"qwùàj&yk¥Û)@Áèáa¸íÂêñ.1nyqêiú
f%2|&(â	ãvI¡rB[ÞgRÿµÑi0¨g%à][àæexðîý<(Ó2TÛ*óc¢åÂ°¦u| Ñ	BvlB¶KÀÔ6£E´üAãÖ´p¨ýmF%Ó»Üç§É»XA¤= Fæáò¨©ì{G*LvcáÖ~ Q$É|àj_ÿÃôÈ"Å©Í®3f!@ÕÒjÿ;hMIäaMTÎ¡K	\ÕYf'&fæ(ªæ¥Z^ZË'ò3÷;Ëv&0KÐÁuðhO,¯¿Ó¾;¢*úÃ6·vVXulÀm`0A}¹Åð¥N|ójzú¶yñ¾HMºöò*6*é¾K	s^3úZ_/tVHÒ¼§7<¥OqÂ}p·f8Ñu].4-¨øSêo©³C¯p@i6nÓ¿ËhtÃ)KñR¯Ä[²xü3úÈ}t5CôtnÀÙ/ÒnÐ´kÿÀ£EÈüSYØå,8N>/X/8vEÖøn1Oß°«+)éÁsÞ}WCÚúæ­ùð­]vN ×Ñ]©*wy?ËKTóxAçØcSò]-MÛW!ahU0Z@KrpÅÝÌãP`Ý÷«ÓHòÞRS³lÙbZipG(Ç¾row&}@BÝÒ¾éCäêûúÚsØm
tY"ÂjÕ9¾ïËü´×Éop-úF)ÏëÿQ¼Æûl)¿É->¦ÕU¼+W)n[êI{jö,vAû¯/;Cáh_øú9ú?
¨Ä,»ëSþ7·ã·'N¢){¡®ÔG<ÒäWf
û°F
ÿ«N¬¯£{f[rBmoo×À·ÀU£EÜüA{Ûá¡ÝîºÉ¦ílp++BX*.©TØª+Üs{9ìF"
1¿}QiG±é6'szùj®uà#Ð¿c}°VàTãÃëùGîæ²#àz?ETyj8Å'ûRö-¤fÄÅËkûãË	YKG%ù2ªoö86ï)½ð<`pÜÞ Õ:}Ô4­%;eëö}6ÏTÅH|Â7Ì"'ËwÃLÑð\{Ôð'w¯H=ä[ÁazÜÄP$6Úýùë¼~óªíy¾Fà²ä
rmL#Ï~RïÐñùÆE\Auk$ì)rO×I·Gc£õ£§{«ÃÃïGú¼=R8@GÍò#Ç*¬°YOüK'Àûi·d½dmCü£EðüSD1\ÙDÒJ^HPóVj§(¾ºìYö5IµôT¤GZC,'O_ôÖZÞg9ÁÐ?Q
û8lz*!¦Ó½î-)«Ö09üÍsæ!±Ëå£iÛ8HiQ5wÞÌ¼¨°êìÝÅ
¦YP°®~³Mjý&F¼gáoMÀ®K½ÒüC6<HnU¶(ÀN<ØÁÅ HÙ@&«»é8^Þó¤ûÀ«/±jÉ)6GkCpú§_:µ)gr¶`~4vº
{ãHÝfúÓL_zÚrÃUVßKxÁ}49ÆíwâÐ¸F£í>@ë$¯½B;Í¨J²­¥bÑdàtt7©ë[Fì¢Â`¸!KqÆdôûû\æv:³-û[bAv¿À$£EüAß¯âïMàñÞM¡ajÏo±ÝÈ¬[(;Q<É2ººÍ
v±U-eHá8`àa4ªªvO¦Kf¹ËÛ¥Ýï='ÕÁôHÜtó°¢V¿²SÆíM¢R·vî9GhîNÈ7v`J)ë·6w¹_¶ÿÓåe¨^­ëI[¶°¤Äf(	ÇsÁC·OÅ²Ô~Ìø¼®j8CwËgÕ/­Æ#¸t6töã¶*.Þf*±ë ÜÍü&F»P2Ûnp§ÉMdë5ÀáÔ¼YÞÒ©"òËCY4[»Æç2ç6ÅÔÕl	uöUªûXÐ®$ÿ7ÉÝLnâ"¦ñÂ÷föÇ||s¨Û[´ÿ·öÒnÔÁI£EüAã­zÌ¶CyÛ/üÇXÕÁZ80g0Sô
_0åcný3VJEV*ýäÄî0Eõ`	;ZMS½£8Á?°4ÌÚôß0¤ª?&zë&GÅ7ÐÞyr7t0ñ69s»äãd'oÜ[`ùýíq¶7¾{ìÜwÇyÌÛà¿óÐ»aTSlÖ?Âg?¬É|oûvûÀrÜéëU`íIP,ÎòOIm ^&ÑÆ
ìD`¢[Ô1÷D»øR_Ò<4öî´ûÎQVC9ÜÑ×m['2¢
^BÉ"J×¼:7Ë,bYÖÐIÊÊÕÂxþóH(ñ^öb?¸UçZüCõ¢ZÈÞ¬h"´,Önq|!h:Â:­6í -okI%vÚÕUH
£E,üSGO¶u#ÃË_¸¶HWYo.ÔêÉ<Ô³ ¦2¯â(fuy*ð)ãÌçëõî½yC/GÐ ÁAÐqYø"ÄvÏÊ©ø%áÛ~}±µÖVÔáòÙ7¶tcþñ@r¸ÍMÃ²RíIç=ÍÈbNçêSmiÊé{ÆH£ò_ûÂÂã_¾ÚêÄU¶ø~¥ËFÿÝ'uÊi¹×ü$Áâikïg¥=û
¾aÚ±íÃÂµ¸¶
[Ï>/{¯ÑàKAÌtÏ)í¹Þ!¶[w!d((Ã­/UL	í´4å=Ro6''ÈyC¨qÙc4üÀ×E¹©øùotÏàÞÍPÓÛ>ô¸ )ÿÐZÓ@ùíJ7Ç¸®fâ?- 6Û`-I%lëê¿/£E@üA{2ÎÁ8üB/±¢ÜÔ¾îùÃUòÚ¡zÁQÈdp»«ãÏ3/P!­þ|pðfr8Cü;oÀte73h7.¤ÀÏº½>ï&l7{·A!Øt_­¨«LNb¡ß²Çs+ËÉ" u Ø=|
²¹Û?ØºÎmm ü
ÐÃö²®ÎXT²+O1A2,w58ðãò+Bø¯À>QfÌ°¢©«¢ò8pS#'A &U¨dó_8+û­Æ?ÁäØ¿ÐZ(Ê
¦ÆB|¿º	ØÒBQÎkùFôNqm¼äJÓ½¬
3®öÊHW|ÔäÄ¨¹vZTci³úA¹Îª*ÿ8Fz¼Uy«G¬÷|ÍxY¦É¶D­I+IJÒT<Ø£ETüS¹z8fn>n	ögð1Áih­,-â»a3wU°	?û"õ½j²¹UÓåÀ×}÷ÅÅ¿õÿã©5n;2ü#!Ø¥í¯Oa´ªjP×PÎÆ|'$P¤ÓÒìð´ä|CÁZê_£ÃËý±5­X}a£G1!Âï¿[ñÁ§7HÌ\¬¿ÉKÎ'Ðm&1õ³-¸)¹¡tîZà-¹Q~¿ßÞS -T*+d-Æ®uÓXÀLêoÛC"XÅCD¼NfXõUÃ`"´Å£rc=Éò¿C¢s`cAÅlÍèa»R¼Åí+ïA©&£þù½b`wa:UYGÃ÷eÓõÁNúz¶R-VUõáòFÛÈwi	ÚÖöý¶É6I*£EhüAãûq¸2¿#¿å¡ëWøÈ4Ü~òçsìuËîw@ûnON²uÜC)´W0o
IõO3¼[G­ot¨ÿx¥/Ê¤â?,çøâ
4Cä.=ª%Qî^Æægüª-¾&ÆQ¼:¾ø8j?T»/Ä!\Æ;®x`ÂxZ`ÆgbaÌCÆE»xSkG3}x§·¿Öø5ôP­¡P!åa{®¶CVwnÛ`°¥C¯)Ùä,!ËJ8Nß±vH2­&éT²'­ÄvèÏÇ KÊZ÷©iì úÜZf2@ø½½ÙÈT°G0b¶ûÿeÅþ\"±Wo]G»[·ûvý°$lAWÒKõ£E|üAëìÃÀ¤­­|FøÿJ¾`M'p¯ÛíàâÀP	ÜÿzW+÷SêNÝÐú>ÀU¼ÉÙçiþçdêVG¢ðÈzÇD)>ÜÈ¢^?9àVù¿ÕèG¬NÞ©ÖòÚï.Ð:5%ñÓDN+ò¥ÒÇHè¿Õ¹Ñò2Ñ@Yv··oÙàïF:ju §©n)N9O»æ>øª¦iï	®ÓoÄ0_dQ|<9®úãûic'SþÏtb-0Ð3êf°»Ö
Ë0r|±¨PúH O8ó÷öËü²ÆËñÍªhãÆÉLÜM¿¨^,³RZSË8J¾£²è@Ñæ²6½ö{LÔP)WK§|Vb!"[%²@·ä%¿ ÚÕ£EüAëñÆøb+è7[7å
ª¯J©ê{ÿRßÿUOgïåÀév÷ÄªÔq|âÒ°.M·.<8`Zï.O^lâýCWL^a¢¨0±Äý	4ýn¹Õ¶Ìî8qt¯­"`W7:]3%Â9UÛ>kÅ­âgo)ìO1ÿóßÓù(¦R½¡æ×z&°8õÈhrV×¶¾XàY
ëØZ¤IHs{¯ïtäÑ8èqQçMÅ3°ÏgßSçÂg°IsæìüU~y.µà´"îûÀU¡<6		Áù>@æF%ðh¹ÑÐ®ÏÛ.a{çH¹ü¿J|ýZYlÄâEÚvcÞBlã¾ªe°Þ÷ð	füjìInÙ	$¯Ùº£E¤üSòQzµú4ëXË]Ú£|=¼g­ØTèSèg¿<È4¸²;~ÒÊ¿zú²6YøUk¹£ýw	4»É`X×ßÒgv1yâ6DwGRÀéL"Ï¶?LC~g¿t¹¢­ê÷D-wK[j°I¨-Ø¶ÐÎMCjÄ>á} E^Ig±-xªA$zª¯©B8ÔÒ,\V{÷b'ý`ÿ?.¤Ë åY9@ë;ùUý5#}Fo"ó¿º9¸1èÚ~cB=À9¦RLUî$UoâlhãÔÜåK`°rmH¼±nÉÚBizÕAÝ³#HûqÎÚzI@]H³æh)½xµPºÎ2ÿ<+ÌøWÞW!úØÍk[ÒÆØÞ8K/èHI¹6ý/ä¥[mí£E¸üA{ÑqønU[m}ÞÖÓ+ÆßmhÛ@üNà½æ²¬÷âëõ*ç M/é1BûNe±"wÄj wÇÌõ wª|çj¯)îÆo¦hÈ¹ïi¦aépAùÜ/ÐxÁ=ï`n£þG­qy.:&JVáæÜ ¨ºÑÂ\ò»,hÓcUºÆúÎïq|ÈÄäâ|Ý8e1q ðÏ¨8òì¨GÇ.-×ebN§ð¸§c9ÕíJçÁlXxMÂu¾û*ß·qó¥¢¨WrDºTDªC¼ÿø°«DRãM^ÅÊ¢Ë!XÁQju G÷;pUÍ»äÍ.ÀÕ"lfu=æ¤­ý´ÿð
½A@ -£EÌü2À?ô¶ÌþkÛ6É8¡¬08
ÕZo6d$Wq¼À\mÆàÄõÉ¡×Ú!)ô>½º2	H4>,çHõä@ qÉã ô¸m¨G	]×í`À¿%eOMeóf%¼ùÐt¦rõT)º9B
¿¹8Óh¾I/Æ§gù±§ÅíÉ|÷¸aUbÒÍeñhfÞÒÔý¶@gµùB8/¢¡>³Ù¥gd89;ÅÙ¤µ_xIüÃCGd$¼óf?-Ê=ý=ÅV-5Í.
,ø}üÓÀ Au£«iúxÛ¶tf©
ôpÕèLþÍÚ40
dFmU´{½Y1,®~3«P£¼ò>óç=QxJV/gy6d%&OÕAm´£EàüSªjàxcÌ 6åõ³*Ìoë·B+â{ÙÑ ÕZÇÌÍÖ­[rjÑ×n~:rÌã~ØäQ¢A]jò¯=äæ=ØÃø¿¨YN¬¢)à÷t]<?æZ|eI&acåGíGÜEAóréHÓmz°·Ç£óntqÝsÿ-Nq9ÝvÎ5üj£4\fï¥þDLò
aÔ9'ãJÎ~T¿ÌºàL
×ÇÌ{ñôh¸«V§.m?2`+ÂÚ¦ÄíþÏÎÐ#/FP	>[a÷±{p)çhØYædUÊ'uu0ÍÝþ	UóÓø..ÈÄH\ðzë_b²àð£hAøÐTð<]Ì<1¡ï2âKp6H¢_¸d-'ð	ÿý+@$¶£EôüAä
/£¨(<6ãfæí~[U%kÄ~D§§cA£&û¬¥ðH±àÒ/Ò3V é'h«ÔzVá¦_Kq\¯­sÍü®6AßÖ/Q±Q¶+ó;ÃÖhæIçºNquö­èÎá6¹^5("\_9tírB£S:5?e¶­Úø%vÇPVécs¾6()aÂ¶6¸-Åòÿ6%<Ú³å7wëµrô{ÕG×Ìh§~KhMÊÆÀ/+Þþ¬n²öëÐY²ëñ»ûÍKQµÙýØ(&±ÿDåÆéÌõqLïÏ%Å3t·û¶gì 8x|
kÓZèQ\möÀ¿W¹I÷÷¸ùåéöS§ZrËû$ÚK@HüUPØ@£EüAäª8Kóüúv}3ø¼±RÇ&hÑ¼:PÅr$zDM¨üáÛ]TMw{:["UQò'8QiÀ±ýFûÊ¨§þðêO+)fm'ÐTã}WàCx//{âPããÇÿß­pÁÇª8â¥<!xíÄc¿_r»Y 6ÛDðB¶úM*·ªb9¨lY¡v#²cX)@8ràâ¨	Mi#Æ¿o9Û Æe¨t£iìô¨ª,V¤
åÌ$ú{è^´bR¬EÁäÑ0õo]eüW@Òöüràå·¡½²=Ê_
Cv	`ê4ìÌ0pÐÚ¼RkÝOÝMGL5EYÚÔk=*ú¸sa(ipq¨=wôå#ªtÄ¤üþÖänÙ<(?		£EüãysÖÌR¶ÕãW¿4MW¸ÄÍOlß:Å¿O.É·j¤eÔJ»9¹ªrjIÒ±¨´>·SÔ°ä=g¨$_YB@¾Íj¶@¨¡À	mp¶ôÛj\{=H=I(Øa÷¯ÐDn·`¦Åií2ÝÎÒK\¹í$J?b$\½¶6Óá<ðå';\"ë%£2K¶½Ë©"NWqÿo¦Ö_lZîúéa*ÈÈÁN,õuÝ)»mâ)³¯îØ6Ê{ôHÚüãï3TÇ§³é8JýD ,
Æy×]ðVÄ#ßà¸FV¦°^¤<ï²ùË±SÃvíÉM¶{ÛvB:XºøéÄ(6/«¶C=¹ÚÛõjÈ"ÑXÛ7!)6 /ÿÿÿTaú£E0üSZis`¿ÕM%üæCxSM7n´^»vgÂ,¯P2èÀiÚ$ÚOÅ$^)
ÇØ`©)¼Ì¨õÁPk¡âã^/
ÞQM¤¸9P¤+~Â]kÁ[XyòeÇÄC.ðxXsµ¸^Ì{&&ÍþÄàÿKó¯ò=ã´-©*i÷DÊ¯Ò~ÿ¬¾äe>X<]¡@]ÆbÛÆ~³[xÒÙsZRäø/²	R¸®ýôVâ!áY¦FGºIªÎmÜM¾2eIM¹»@Dg¡sû+3Ë>¡8ó(àL¥P¥¤On8¸ð,ùTæà!üð1Øô¯úxÞ²*¼£Ù÷ØZêXa¨¦DÝökdHí l=&Ò¢R£EDüAåÛÍdÊÑÂ\×Þ£¯DKé.¡+¾]Y1ËIÜ]õwVmj.?ú7Ç¸4»¾ÔôS	Ì2ë¸Ø$Oå&ÓÝ?u^º`4)ÍyVÖåf¸ÍbÈ]Ðª±^wò|³
K´æ±Kú(=÷Ü}»³B9[ W!dciT)]Sm¾7>Oq©IcQQ¼b<Á-*Ï÷
+Ôh"ügØ§P=Þ×÷òM0Îû=oOºê©ÊK}qEÊêoeE¾æLìæôUap ÔNé÷¨ù
äºójú½Õ%Ã
Nw\£^Ù²:Ø0$ñE´Ü}I])8éV¼)é]¦SíúF$zý18-<|ñÝ?¶ßänÒmZ
À£EXüS¯x¹·ÅïMQ¬xß,X¸ûIkB {ÏkÕeÍIÎ¼Ü\)k+syÞï
=t)>~³Âi[TX¨ 	ºÓMWcä¦8¹ÃÐ$çºìa	Å
)ìî3×õ¥EYF^£³ü8 eF³I=í]EJ¢´¿xÖù,½m¿ýÔÑêÃv»³×VµªýðJñòeðÓqÁ)ô½¤z#cýÊVèSH
à½ ø½OXtòF»¬\ãÒØð3ßA"ù?O~Tõ»bXòoùÄ+ÙAiJ¡Ò²Â¾ÛÏýP15l
òùè[MÜìYð
uË¦ÓãUå#j´Ëci§?Ä»þ	¨ÊUÖ:ÉÊwêNS°x³1	Ü*[oÿöI)-o`Uð6T¿£ElüSÊÒ×å Ã	1J¨nòùñ·ÿÑø8®
0\Ç3ÙÝx
K6èúÿû	DÃaY@cO¹«¬²ÞGH£Ç·j½Ð®Yª³f^KZïÊõ['nZ,fCovª0Þ0
7t!ò<=Ç½FYÅqâèîÇØEä'Ò"©í¼¯^C§£2´ÓÞAêu­OaÌÂdw¤cìbÁ|Î´fzðP
hù²àFG<ÐÃmg3e>z¦PT>)ÏdÞ^(ÊeU[¡
/ü
î¯ÙPbïs+üÅ£WðÆQÕL2aç~LÒGAnO´Ë=I4èãGðzV»&s¥ÒøÂj UooínBRÉ¥ÿÉ«v£EüAë_}
JGz{
"Â¸¸Æåµ
{«2tÄÆ ®Rñ0´òü]SóàfÉñ½¦¸§SAÉ=5Ga·þ
/NuQ\cD`á(6·Fâa®¨â[á´\à7R*o°õy¹ÁøðBÐo¾Ã\5*	2ø8Á¯4V&ï»tr
oCÞ
Ø-È
¬N£¬xS¦G#Vigß_a³·ZfÅ¡úD}<®CVÝºgÀ3Ý[áÐ×à=ò3q÷8.é{Ýq½Â óÿÄûÎhÂ,½náÙ]D½i û©Þ°;V)äúX§þibc#´Î àlTÍGuX,æm]ÞjèÒ+Ä±ªäòR'fÀ·ô¶¯ð?òd£EüS¬ëzÄWîµ¨sL´ö}kYøÚXEt>¡äþP	*7LÄòÈªéMyC> ÐÁ^%fëb¼ñû,Ñì4ý&H0Ý	_¸e±r\éu÷(õÅÎ³5ÜÆukV¹*K*ÞJ«¡]ÞRßºÒ	ûd·âÅVß¹éÜtêï¨µvzTýÆ³Ø±Ù¬Ç¾þïèkÈ1¦úJÁòp¯ñËaåÃ&lÙ¥>Hô{YûÞ[¯ßùû¦;qÖÈËì¿¸x5³eo$uÑvf÷ÉªIh±C²
æÌrÇ%Å¸/*|½]OnPÈâu{*B¦hXÛÒHü0\7MÙÌ3YkðVÝYKòÍ·BmÝI ?ý¹(ÉP-£E¨üÚÛNùø7viÉ$.²mol|öVÓ4L9¢òM%ª*s[½ªbC¨¯0´ut×HÿH·SÁHåù´n%LMÚçEÊÖ}æ#kTCÂáÕÒQ&®|ÍA3àWàj×~æåä6ÔMÀxúk}9¥¡\û¤ZÒÜWGÄ.üöH0t&MÅsëd'QW¯~:+Ïæ¼vKøöûLM ñ4Ô¬0Fo%RrÐåyÔ?³¸ÂL=
CÍÁ©
[Cg[?t¸z¦¶öéE7ê«âC÷ß%Öð¦/ÃäIé3asòÒWò#÷e«v{ªv²dª[F|¿xVA¤äÜ7vDkdgÃÎøÚ¾d²£:aì!aåÏ/ -ÿb[ßnÖëÀ6m@£E¼üSª0\@__)#OxNÝÐ)Ä&ïó6²ìJÜ¤?$M*>ÊçÊ*t±_1ÅçØ­Ó/¯¬'|âC4+Ê`èKáyú|®T:d¦k_#	Ëý¦ógS-ÌfùÚñ6|<»Zn+_qô¬ssQö|óñ¢¶ËØÎp[E®»ÖÙBFÿ¢hÚ×^® rýn	qù²{/Z7d7<c@H;4^È@à|-ÝgÐñÇú
ÿjÏûÔ;A¼yñÏ$Sª¿ÍÅ
ÆÿËªóÓµÚÍv´ÂÒAÊtÕ8g&]îè8F${qß¬cÆà[§ùÓ¤=ÏpÇg;LÞ7ÙÛrq~°ß×ÌÕ{¢«E]É½e»2mí	$Øú¤«d£EÐüÒ¸ó%Ý+Sç
wãí[cë>«ÏÂãØêYPgRqY"Ñ2Ý-bÈC-©¤ÕÑEÎÅ<Û9[VeÓ%Ø¶Øt\r®'EÉÆÄêo«JfgÖi oÊ÷Ôl,Ã
²ÐS¯ïµ¾4úïôòû?ÈÐ¨DmÜJ-Ë@eMwÓ(
	0@U=áÜf9`»Ö­´yÆZ=Õp£+ óbMTû¹÷s3­éâ^d/èÄHu¢þlÑe¥çÁõ¥ê4+g}¶_ýÑe\Ùp&kUpr ýOú±âíñ0iÔ:ü)ÿQ¿ÝÕ§N² vm·N8¼GIi;Ùá§ûl5¶ÜJÔld'fÀ¯ª&ÙÏ£EäüSªZq6»ò	Ñý¡(Zrìä,nK\tz:u/Ô¢·ncYÃë¿Çcz|[Í!Ó§R;nznH^7\ü´~°cÐîÝ z$1ÔLL¹.Y*·ÙLúñCÝö²<ë|ÓØãoo¸8÷V¿­÷Õ1usÆé[°\ÞØ´¦G
»õ÷ÖÜ^À­;íT¡¬ìçýâëË¾d[dx0Ð±±BÊeÔÌÁaê«(zV2ï!·
	OXD>°`ÐºðÁî.xBú-Vö­E+½!ì°Þ:±·p[w°&iñ,ÖËÖJC:W.
KÖëqïþ#vOòõ±yÚÊÕ¡8[	m´¶I¹6¥ÿÛ«R£EøüSá=6£.ßy§ÿ$`åK0RfèµTÛ¾ßJvm:bÄÔ«uy_0ß.â¸|GÒE	r¼uBHÇxÇ\õ	Kç£¤C¦Dáõ±<â4({v2èÿ(ðeB$ùqú"þH5± 6 úþ)P«¢u_Øiø¨ô*Á7ç¡Ê¨¬ÅJÌ;ÝPAÇ²ÎtG¦êþHÖ±fåºá&4ûß#®ËY áÊdú½Åàö£d<ÀèTt ¯ô.¥K¸Àwµí<ø*)Õø
.vÎ*®ó¯¦ýÍ!ïÀ Ø/÷kWõ@Þ ÀÀKªQ8Ú%]G½EIµ©>O&Qx+WÔ~[rõ°SYÉSãIíº±ÊcÊ÷SØö¶D­d¿iöÿ£EüAð(½]nQKØÈ²j«óYðYÝ:wã}ÿ:(oâ¿CPTõ­&~l:í±Ñ]ØfU¢xjÝôüa|^©ä8F(ÃIé2_Ò>×8¤L]G£T¡LÍ
Lê&oCÈ
tç?&¤w:'nÐaOëëd¢êÍ#ÙIùâe¢#ë¦1%ß·Ð¢$8¥õÏÒ9zóÖp/Òþ¶Ý0¥44Ç	5¼¶d<È³Q>o°ðyBÁÁÏvwWOË
]êËßaãiÄEß»º5ÕKoÑ	*¾}³Â5ÜÓ
Y:ûö?qÚSA,'*K¾×ÉCÇàÜyO(#ewöÍzáí¶ú÷&Ýñg[ý°-$m´ZÿÿÒ£E üAïÆY«c´¯,ûUtÍøP©4£ËP©%PaÕ©¯vÚjÕmYªOØFDÎüÜ.Ç1KÆiü¼b÷¨±Øç)×P+ÎFbú×#ÓwÉ"NëEUD^C»(þÐG*á®¢¨WjìY¢SÄ¢<Íïº%ñ=0ê
~V6ér1)A¦xXÿÄ¤NÃÇümNË|[vbø~:X÷ïðïsE~º|jrÛµ]E¢B^Ã?V((À½¢úF I¦[MñKøØæJ@Ê]¯zôOèÙYÃÄ[DT.4®Rù¹¢0§c4ôÁ£±°ËfØ#·¥NyDqgèúÂ 1â"OiÛâáoÛm°Ø
´¼<	]¤£E4üA{Ý0ªÌw^ügØ­"³ñC½ßBeÇÀ<)ª©ØÜ%Yì '}Üàýn+®b¯êmV¥©= B¡³Ô: I?fÏüfxUÛìÛ\=(òN»Ñtú°üþÓ¥aC­_ãBûa½ESfçª&ÁÁplÃÅ)Ê*Öy(óóÏè'$¹|¼VåÀù9Ø}g$o
©Cä¸¥t¬4}²k|y6?¦®ºKt^Õ'¸ó,ãX!ËK"ñÓ6Ó/ÇUO2¥'2Ì1Â[&ýKÆZYtðù)P³iÚliLÃ4ß¬$%Ï{{¾;aÎ¢ìé·!;óJÓ¬tp¶iwÔå­)þ&ÎpW
ø#A%$I½¿Ø	

m £Hüª",")}TëmôU/þô¾·Õo°Ab
Ø[®kÃ7 «Ñµ'ÊÎ;Ô9fÎªWG&Üï½¯£@·³¿"OÕßù]ÁÇv£»7(SCê,;ó;Ü2Hz5')Æ.á»åû(2MÙËó9òk)&ÿÁÁU^óÏ/,ðTg¾~ß*¸s,²¡Ù}bá	Ba*ÐmËw¨+Â¿ÂkÜÃa4uUÔ6mïËpäS_§µÅä¶#hìGÝN EBB¬Ü+	Bûúæ>ûÙ?)trèI÷Jí¢©ê'Ï×¡Îúá(LÍÛ4DCØÐ2K5³\ó¡Ê¨ÑÅ	ïr2¾Õ×`åJûC5óðp5ó¼á¬&KàEþÍé:Kîmèg½ÝÚ0_»¶º¾Í¾lÉÔÚíy É3d¶m¹[ÚÕÉ´?´£A\ü¦LÖwzGmO¸&ûÏÝ,v¦ÕÓ5;íu' ë&®öß^1£bmZzW»{GCSc&8dôq]¦Ô Yês7ª«2¼ªý?2ÃJà ×ì1âMÜÇÿØ·~HÕE&Øç2ÑÝî/Ý¤Y¥µºéd^ó©æHKäAè!ùÚÄwë³)/5§L¯ú­"Ü7EK!):|Ë«~~Bt÷õôÈZe?Ù±z2­&3CÉrR.Gq ëËècãd`	8â^þÉÿiv¡õ-X¤èä|X:ö6¡-\g(¦[
ÂkV0mÞ¨«T±H^a3ÜÐ~
Kø*-ffçÚÅ±µ%®Òä´CöÒnBv'ð´	*í¶­T£Apü1£ÒÓZn)¸Uù±;nùä,¤ÉÈÃø® ¨ézÅ¬¸ôLVe=i·*_æÛÛOéì&Ã¦>º¬ëÖíR	6ü$¥/àÒ>WOîeQ
Ç«2@fûm®4ÍÚá«·S·üÌ7e¾¶àDÕ°1XLr/qòÇxW)çÁxd3êès7S74¬$ëÍØïx,>$ÞE°ýÉO$/müÅ¥á¡
´¥ëBshÇ9K"þ»6½CøpÇÝOè0j¡Ài®°ót4lÚiâÍ+ðgö;£Á_êBÈÁxåÕæv}ÖÛà^ÐFê§JkáHtä­~[óXmûöÙfþIn@HýT$mm£Cü&gõÈVàz»ûþ÷|§unÞd?,ýcÒcÿ\nÄ%¬0÷^µs*¤:·¶Ü)Å¿ËIoàBe4ðV_~xøq5ìIV¸ñns¤§L¯f éí_8E,ûûØc¶þ¶Ðûp\±uU!¤{J
°%åxòµ.9?;0½"¹sK'o£¹A]Ç®RÏqý7r{Õ'4Þ£´ãcoX®rxì­âXÁ±Xµ£¸dÏnðÔXg:;Vê½Dýã[ÔdB;5âÀ¹þjh_:îº0q/_nï½)
ï ¼ÂY÷³|@¦ÉVg%EyäÈ Fej,ÄÉû};«|*d$ðn%ä2BþkrÆ
]Ë¹MIP=·ýHD
¶% >ßÉ_Ò£èüÕ03Ä¬é÷ÐRYç44Ý§1ªüÚRýóÎÅà
udC}n÷OôÌÀÆô¾öà.7½Ë5tÜÓHá]WªÞ \ËÈx§NEtôß­Pá"mz+à©® ~Ã¹Ão0£CfðÓéïÐ?¤å{4|[ÒÎ#Ô~ÍFFª?áüIÚ¢6oô¹Ê9¹ïp]&jLr¼$ÚÆ?
 ROD¡¨ÓÀ°KGä*bt`È=ð¤jÈ³J:²½´6XJ/»V%dlÄèÉàðmW¬£äì£Ö÷'¯!Ï'rá
1RHøjd~¦6©ÿ½L·t÷ÓZ£3@ßTóMhZLuI²Í/8÷Y
QP|_Ô3«N$·¥ê.´ú	~?°~LÓ \#7H]¯þ¨&?¸¨¾pÅáÉ?MPÔî­f]ÿ²M5¿²³POB1)È^4
ºÜ÷Ý(&·¤ÁÓÕ/¹7¸¼
óê®õîô]à-)I(Ü|å¸i
Âþêìçè¤·ÊpOð>ò®K³0­ü	-´­}¿É%!£&¬üPñäøV*<{É¢ó`c¡3?Ws("Õ(e×±Ã2oM|ûh(/Q,§ÛhëHë
^ Ç1f°¢TÉ:×wIr² ¡¬èE£@n	RM^±bBUÙu%¸!«ôE¥û2U0ä>&>Qz½ÁMFÓ5Ç´¬ú
øjUwøÕÒåÁSaÀU£Æki	Ìû¬JPè¯Ip(ð½§úB4tjàÓ÷¡ØB2¨:C§ÎG¡¢ý¢q·¸÷#ö1$½õ(aÃ+Y¯ÀxÒ{Ká=.ð#É¶P?YÊìúÓ)
{ªÕ<«WçëÒ@é-ç/¿"À¿Þèá¹µòÎ,k(ÁKH
¡Ý}ÁÂÉí·ýUP¥ÿZ
£#Àü.2.áÎHãa£²3-bò/lFb9ÙËdqäZ« ­3½ÛÄ}k¬px8Fz3±ÄD/ÜÂöÔn[¡XO¿cø×:OK>*¶ûðSç¢2äK*L®(¾¬ä§hÕ¢JQ¥Ddb`zafÅ^íÂÍíol¡çµ~6#Øk5+Da¬=»"ü¦ñw!£jÃ§:Þm3¹kN°ÎÎÊöÿujpvî$|mîAü|å2wõ¡=S
BÌØxqíçKqP©¦­5Ñ_´@í&ÂiNè²ÉÔ¶Q[p×LÈlî}G	MA¡(ÖÍpÑ 6'ý¤Ùv% õðü£4ÔüX¡í;ÚÆ
ö¥õ^ú^&òÊ`Ë8*­e>È?ý.ªæFno ÷0Dîô1ù¼7®5­NèeÌu5/cI/¿öÌ-ùk9ì£ú±Í]«mÐÜ(ißL|$5P£Rz:ÌúøiÎ-.	Ú!ú¦çgU²ûnªaÃ34çz±ªZâ/¢ú8ý¡È¦ikSø>ü.ÊmüWÆQ¦HÃw{¿DÿMå¢ ½¡Ëk§i?Ó}XV]£ÑpÌ\hX½§¢Í¸]j8TºÉ÷K
_aØö·ð&e\ðÈFä,GC§GÎ³2,·½)g¯?²kç'>/Âfçv$·Æ{ù¾Bý¶ªnKmÛÿ~RÉC¶uÿÿÿÿÿÿÿç¾£Züçeö;Yp, îØÖOe`TÜübpMÃ7C¿©0c[¾^9§jà³øua: ³c/a*¬¤oÚ2ÉÍd<-¥%¹øÐâèýÔ¢;!>ÌêscLaØ9æÜ3Ýëc+Ö$R°yºi@¸ô¿Å¿¼Á?DÙ<®°ÃH(­¡)H®|¶~%h;°\O
ºw(¨­¿òÎÕÿ¸bófÃ*N}¤·
io¢§»úÝtJJ(¸wdc-ÊPÜ£
ËWêO>)Ýê­ì
þîdzfÌ´#MÇ¸ÁäÐ~*:?¢²vu+_£ïá'ÌoO/ç~.]é!¿v©w7C ê4Ó»¿Emå&°ì7PEäl++pðY ¬ÚVImûþÚø7·È£hüê;b
¤ë$¥¶¹',utÈbÝ>$tÀF!YPÈm,Þé]ÛM2§ü¥Þ
Òó¤
9HÈÿ
ÖN®Fnç«øÊxe¯dóÃ×©£é
ÍÜm40BDCoÖüxÀÅUMÝ-üQÕª5¤ß6Ø»ô¹(àcgC$Ñ(Ý@.£Ñ	Ýµ3µL,ø°=÷qÊqÝ5×
±w /3êç]*$ùß?PsæÐe=)¬Gáë¯ËKÑÙISÒÚ#m·\wàéòO6À.qu
þìêqRÜ
<ícVbd.Áñø1I¤®7IÍPûªÀ»h
ÝyëåeÓTÇ½¿«÷Æ¢ïRîfC
5Ô47Oââõf´ð¸rk¦>NíßoÅÈ²ÂI!°	%i6¶Nß¥A^Ku´£6(üåiØ;óá¼
¸³v`(¹ÉS>ÒUdÈÆZióf:)Äé9æ¨µdUN§#UB?%4ï«C5sâVª°¾Ô-ÞXc4JáËù·ãN³ò^s¸¤CHT|ò­QâÃä"iûÄèT*js/nZ{:	iNÂ¨çVÔÕ03Ë.2¹?ÕU&{[»NkÊ»þW&¢­\ª*ÈÔôÕË` ­ÁïÛ û{£ägD:ªñÒÉÎ=½@Å@487wnìéùoîÛ¸MFO²øZ	)q0,HtÉ9l ûã³ýñ¯)ßÆÏsN
¥@ý2!ñÅÚãecs)
§ûë/_±±-Éú_¶ûlõi4Ü£.<üçC©iDíÿÎÁM7¨Ã2MËáP£PÍ_ë£ÉÞ´-IÞ$[O÷}\Â×gÜ«
\aT\õÚqµQuJÙ/1¡&Hä«âJOyåc¯ý`4y¬zþß{cùÁÖÜñ£)x<Åø{Þ´Û»ªPèQðæ¹kÿÍQòGnWm!wÝ½üÓE0ÃkS:L¿à¶nþ$ô
÷~H~1âºýÃÜNnXÂä¡CW]Dæ×ÈHÌ#/+xK«¸Å`åW|½P§Ð
}èRW}HÄh88â~N\eÑWF<ö÷[Æü»Sb± 6í¥þË$­Ô«£+Püâ«(r$ÓÝÙÏg0gFrX¼½EøTTux^æ}Q2®ì+ci}*Â6°Kû\à'~¾Ú G¹ú/©E»Rð¼"MË¶7ÄáùqÆsëtÆåÍÀÀk]w®±Qðm{d&çF9-¿xY4="LiÛ
oe<¹É2Õ*ÔCiS¾ÑljB,9|MÙEÊÁ_ÍÆ)^[=¥ëA-© Mª®5ÄÃÊ>Yh£8($UØFËR:ð§Ø¯Mò	Rp}¤SàçMÙáûiº¡Jå	«6ld~YD­3S¶àÂ`¸ø)õÖ­Ú-ÑMdtá¥BZJ[Döô´#£2düçDÊhÄ­ßÙÜ2¶©CÑUØ{ú'¨;ø.©i5KtaA±°U@HÖ"4®'@(úèuYðä .$îfl×vÂ:Î¢Ç²×©F7)YpÐiºN~Ñ»MQd¾m=£þÐD>ìî¥PZÙAßáp¯µ1ä¼vôA=ÄQ¥]'Ï_ÔF] ô³Ïr§OÓqA+ÏÄ·GEöàViñÍÈ»Rh£¢(-Ú¥¼eHÅWZ(m¿MvIi[(c3Sé± HþHÝ|+)LïîLqÜ*ujæ¹ÌöOZÜ¹é#R\QiîKPÄ[LUÇVWØ_:§êkr6Þßÿû{~  I5û£uxü|§ÈÛ²Ýs2ýöö9ÀÏFÉÛk¯c=39g]îSôCtÚs¼¥¡Âdd
©ïÜfpÌ
¨
gRõÝ#ù^nÒ¨@ÂÁ"*=ÆÖìQR0bE[¥À¼DµÃH´°È°­îÈAÑÊ-:µ¦ªJ.µ5u Î/¿â*¤¨RÃ´kßJÌY>1rI|WÆÎ­nóìct+R'úÏ¬Üââ0=§¾ÜtIU"f¶D¾¬ùÊÐ`TÁc; DMºÌ«
ýÚ`uÀÿy'eÓ*CþäqÊg·öêuT²ýfAí«f¤®cjà®±ÀõöÔã~^WÈÅzr`0Ü@ =´Óçâ¡+¼>Óp	*ÔoNìaîLà«)ncb(49÷àsæRbì
 6þÐ	ð½­£)üGKü³eæÉ)L, 	ÎÀ'è©ýAHéùì¯(}e9Äec¦Î»HuCýu~H­­ñ<ðÔv´´(	uÌ`ï
q£³ÂµNUºu"ÕÉö´Íèwkéî'$qNRPjè(âpÐ3ÍkÁß%¤2#a[Çäkû@Ì;ã&dZÕÄlåw©Bmd~£-5MÝ2q
ée¼úÀ]30)=ÑÈË¢«o¦k~Pµ_®óS÷£ Í%d/]ëô²UBvÄÒAûBµ°Ò
ó iø|¸Pª$­ª´Ä
OÑÇØ¢¢k·øêOqàU»Ù"õÎ­¶åz¨s.8i6'ù6&«öðð¥£( ü.K"r²:7¶wx~{R¼'-À %W6W£Ös>/PÇ.e>ç*"-òÎÝÝ¿uîj
ÝÉCe)«ù­ìn2Õi¶L©»úFG4)G< âzãn]'ráwMÅä¯ºb¿=^{k¦b¡?¿Ìj22°«:vÁ
ÙX(¯
«S÷Bý2O"ÄÓ9Ø+Ûa,^k½\¢Ë¿àÐ{òÊfÂ([wÿ«Â¥\;
ÀXÓ\@>x×ìÑ}ÚR»ç.Ûµl¡4#Z²¶ÆíY·4@ð+ ^ÄQÿ^Óf®ÎöT8â`Ltgk¥GVÿí¨-ý´µ»v¯ÿ¯Pð£"´üa¹/ÙíÏò©J¼$©õÑ¹v?J ',üïc}
²÷AyÔTbËJÝ9)±æ¡ø=H¦×>Ólf?-%òµ±|¿MÑï»]oðÏ?óþºÏ¨ÊÞeû½'ñE=" CvéQ¸á,§ÐxÏ¨\PºaôÍ¬pö<?«òÄGÅ¢-)ØALø~xRUÎ°ìmÿTâµé,£hpÒ4@·'S4Ü48X3/ÌdL¤=Êz"tP{Èfí¹ÉpßiØ¨8¸Ç¬÷ªizáqô¡*""¢âìHÁ
ûNÇaTAÃ(Ðs|üÀ9à¶lm´­úÿUP_£-Èü.ø^^§NNÍ)VWtùêÚ¯OªVÓíÀä¾à
9Þ[1Vz&<Ók©¤Â/EjGæÒÊ&ÌuÎ®aû«zPÝ~dAÃ4&ÁQýâD^¡E® ñpø½Ç3#9/8t&¬j¹½X,)Ä 4O²	LþÇ/)-¬ ÌÓ za¯ß$ÆJd/9·Ù¤(ì½]ÍN[¦RÒ  Û%K­ìË½&ÚkVnydåZÉÿÐe.ëY¤srÁ2É¥À9;
-úrY îÝ¸¦·
A°
Óez·UvýøhâóÜ§·FJ¸õ¡íÞ	ý-´À¯ðÿ
ð£ÜüN)uâI{ã^ôSüWh}p©Îhè9)ywEyÉFPb°ÇÖª®¡:Ê:zÒl÷Çû!X¨òÌ×w6Ó.xÅcÁpá[<[ô)\×é;ÕÃy×Üm¡L»3öÉ0S Èf©¤,,
ÎêQRJáoPÔM4>~eÃí8õ}ßËÒoÉÅÞ+9å6Ú$R¿Õe§ÜAêðê	ø7R²Ñ½´¥~>za£ßûãº±
æÑh<Û÷nQOÓjù=ZÞÆÏëC]Çîø¿ÃËµ[°82©/î5ÎÆCRØx»¶Énkæs0&FPêíüþÔ¤Pª¥Uÿð£Eðü	ªéâ()5T»px¹Ô'Sñ
{¸§Ô~Lg¢Õr·ÕAÃ9¦_«'G¨W7À(FàxÎn^üÀs±°] àküeÒÑÚþæ@ÔlMä?£¹¤6>	Qe½ý}=
f¹³ß¥gÜbôN,1ÞæfMÔçÿv1U¯,ÂRÆ>Pw´Ð½«Ë¡à¤üýM
Ðä¦Æ¨Y¿¢[Jâ²ì&ËdD!¢Îå9'Ç_É!g.6zÀeË|æÝûcÂ0P°×ð[Ìcþâü&L*$E:{Ónü
-ê§W÷©u¹5 bê¨×XØ¼ë²¡;£¿G*H ®é¼{»à(ÕØ³äSrÀëwxwT
Ök»dok@OªÛëý/£Eü1/Okf·×þZj+¦ÝöT²At¸è^=8ÝDólV²0Wk?J0´è>Zé ê­%Ð!¹YÉã¼Ö_)±Áw>d4mËñßRÆýnUM·rgÑDP-Í2ÜkèõðÅt@×ÚÁ)¹'Õ åFÝ¡äK5¸ùÌ%JaÍ¢6ïÐ!b}ÀÕ?º´ÞLÛØ
¦Ñø?ÍÙ¡{våJ§¡ZÒ±ðSR@IþÚ¦ß§"³:*s¿îÂ­ôÅ]PFüÊÍ¶Û2æC=æÊÅí6çwÄþpy×Ù¢Gèü½Y¯zªi¶VãÆ[¯æùÀ»»´YlÀ Aæb¢ÿLÐö[sNµ+[%½-&Oúð%£EüMu¥Wã(Éù§ÎJ±°	Ä1zÜ÷uPÕm°°Õ~äzôÙØ¾¦gdkÙÖ?$ñ¤ãbn$¿,^	^|P×õT'Hº~ÑMæö¤û©5Ê©»HÌnÇû? Ö®XUó+0+Ïëo6YZ²Rú&VÛ¤aíG}7xCz¡`)¼Oß§ö}W;ÿ­Þ	KÝH'81«» 6Ö
G¬M%Þ+öwÚÈèÆ>>ãÔIè5(Ýät¢Åc >ß°ÓåNí;	0òö¢+I" Z]öCr<hólBÔ¬¬B~:üÕs·ÅYÎ]ë,¶XêÖ=ÌvpîÐ£PÎz¢"[ÚDÛõÙ¶ëýmn­£E,üè¡3$Ðä$³k0¸ý*þr,È/bwU¶EcÙjÑûË %ÞD½/uKÄ¢øÄ²2'ýgKf
mð®ÛïFÄc6ÿï°waË}ôÞôEM	MÊàÕÛ
ÎãAõßcåëbîûÂoÎÂÈ·Kjí¿Â!¦G¼öÖêwã¼(: ~Jð\e/Þ¿áÙQrS
X3ÓS#
bãÜg§Êrm\P
Ûâÿ9É®Eå,äÞú_¿á&~èí¥·ÔÅhìm|ÛýØè«ÒÎu÷UþÊ|èwßjÇiAh>LxðctPlíaì¬uß¬Gÿj¶¦iÍ.ùût/È ¦½IûH;$-ÖÄþ¡JI4££E@üçe÷áÏ(X-0~{C¥ê²vó­QxTDÖ,>3ÑV±ãªY¾<xò>òòR8-Ã½M¶
¦eBrfðYàýVÎîã©xÈËu WÛy¡óéèOBâ²*¿@Ucû8·Õ,´Ïã#½Å<zlì/PÑ* òÅ	Q²B`O¿Òò	gk6ÈEÍÀá¥n·Bö¡8×(út°ã0ëhVsí­æ;ã¶eQ¯5ckçxUBÓkH¦uJLäl¥³NTºøB.õ;7ðù§Ôåa6<uuMwº¨å¯%5ì³C9üg+Vd>H²&V¦ÕËË©~BêµÑû3Æ=jyaÚzav¨µQ´ýø;6 H´ØJ§£RTüÓ0AèùWí³QÒYd¤X3ühWºG÷À8Ë*[@;¶qtívÂ*¤¾¾ÂªÆÒZöÊ£Þìî({G~ä:ÛKhhu]vNP¬Ïþi
EmÛX¢&[d`¥9j¬WýJê5Ok~ú9$¶¡,Èrn½Q¬åæÊo
" 6À¸]1ùS#+ç±Zz@(âíPmof©CºTÖr§ÙTÚÊ;ùb¿$yJö .æNÆ\WZÚÛÃ:ç´·p®þàó:FoÛù1©Ä%lá¦zDÕìõ}ÒCF]	Áµ?;Án.Ø,ãTÛ©lØ6Ø?£¨®ó¿ýJTcçØù
pþ|ÄïÙV|óGºÇ &[_f>ÚÝµÜ$½´Z¥JÚIØ£`hüÓ0_àÔ³sÍÉÀÎø7Àãyü.ýÚ-ç5ìflkÈü^)ÖV¾E¢5êÏ£ÆZ5¨¨E#µúbêúü0íeãÜv LÏÌ5º-hF©'*2ä»À/PT¸±u²T!¹Á#1àIJ|½øêéô%Ú¢¨ÎÅÎ¸ÈcQÞÓo2ÑSü¿óâ7Û®<å3ÈÙøpÂâèø³.Ükò}4îjÉìà¾{ºÁÓùí[±ÏEúé¸xI
P´Aºâ÷Ù¬%ô
F§)w×á'YºfóZ#¹sÓw3à)¸Uï@sa¬{ÒS¸¬:¬\/]kÈu÷*ªÿÄü
ñk¤Y¿ÎÙ#³UÚC|ëë?×NïA^£Ëm±G=èã}*\u³P}v-1&¤(ÆTÐäFêüÚ$IvþÕµÙ£Y|üçcî k¬W_
°ÁwiO
ô®þK<ç#Øªk¢7Kç;X@6ó`]¶®ªýe(0ÌTUùyã<Ò8Wá¢5z8g¼ÈÝ'ÄÍ~ÝÂR~ÞÅ»
>;¶Þa~~p«cI¿Ý¯ðl{Îiód&µJÒ`G±°ª¢FåÑàÒxHLÞòÀØ÷¥Â¿üâC¹ÄnØ©òsÏ\ÇÊ,ãUªIä"ØÈo%MQl¦SÎæè]sd¹q^¾;ÌADõgCÐ<ûwïWÙq]ÝÆ²OÂÚ:
ÙìyÏæWµÎVæ¨`R×Q-eF.}¢î-äï#×ÌQõ}úÏNÔþ~zÿ
ÿ/ fº¾TÅT¼z8¡Gû}ÿ¶Ø
¤míkk#½£Pü2z]Z±aÁÓÚU{y±
ädÞõÛâ*Õ¶°ÕPI¬_Ñ`b<sUè®Yyý³Ê?®@ÜèÇïÒkà­+Ã*ÆÕëÖôÑ,NÿÌ¾£o=AùM³?¨Ùî»µ®BÙ"ÇÄnl4ÉªjL]ac^$Ø:ZÔöèn¿J%uXë k-Ý)ÿÌ<A_Iªª]µtê	Yjì³`ëæþ©)ù½@_{
mülÕár­dßXwlHð=èBoÐÑÞ!¹J}ã~°bí|aóìx§¼g¢<IÉÎóÒ°%ÁIDÖ8¬ÔÂÄä yÀndÎiPºh:Ý

§_bÇV7Þwßë
rßËÌ²!½7%5çû'çC<-G»¹Çp
âv»$$ý/¶@þ¤ü-£_¤üÓ0ý]fYÃÇEÛòghÒ/¸XgÆY&5«ð0RjÒâvácöZãVðÁÜÀF1wQE~] Cdg¯Þ7Ù(¤½Ü¶ê?ýÅr
ÜôÎºöï©ÜoiA*·bç©¼.1Fëêí®"uØÀ>97³¸3/ë!¿ }ÀI`6áo0¸BÏ-5¤ú´ò3üÈ:©ÊÐz¤Úñ±{EÎZ"éi²ûBNÑowÇF®é}ÛòéIl!~ð
@9Dm¸µ£¦ßiÂEö]uWxCåçùª§ Ìû`BGb½õC]ß
K¯[õ$hîË|ñ4<Y³+ág5ß¿&å­µêNÒÖ9*±z­Îe¿²paöIi?ÀÛª
m Jb£Z¸üÒðÍbéåYù^·×ÄË_lV0FwÄÄÍ1]/
þj	`:ü;]rkìéÚ×Y³rHB;Gôy]'ÎßÄw×ùnùY@7¶/¶f¢ÆãSÒÆ+«­|5ù>W6Ç6ÛÎÀ`
^À)(Zñdý­$ú¬;ðáåGüWÀ#3äF¹Nv¼À3<ðÿ3õ´a4Q·æ½~àVê§\BUþ$ª[PKõtSÑÑËæ<``eMÈW¥gû3®Ù=<ðf§.ìZ=p'&m 3µ/ª9TÆë²`	ðc³l²ÊôT{ÿ
öÐo/4ÏpÑ#P%»md³IOKO¹}öM»U,q÷Yw\¦=¹.
k	%'Ìlð²×r-¹6Ù)mUúE¶f£dÌüÑîÞc&°ðRÚ7KÌßK½Ái~óßÐxp­I=Ê4ãÓ¹ÉW¼â¾Ðú½lÐkm	;lwLp`Sv£O>/gsûÍü´P½ÇÊ°ï}1*
[ác3 û¹nS*¢Påèßrü§z±ëmK"ï>Âäa»¾¤@1á7Ü%³f­ÅGzÓäý
§ÿ:wcèD¹i_ÿÃ¸<edzßÍ°ÑÜ^
ªH%ûª±Îc'5âÎ«ÎùÖ¶ªZw;¼`>(øGXÁgù¬é>¡ucµpe M¦÷Í¬ +*ÒáÄ³;æìÔÇûð¥ÊE
0}Àþ§YfåÅ'=ÞXßïü	=èfYS0
MD®c{xËXÇ. Ûdß{;Ù½µv$ ³0Úf£_àüÓ8è´kÅÖµ`Ç!|ÑÐÈc ·mLHæq´wÈHÄgK-[7ØtIÍ÷Q­±yeÁm·êëË×éÞK¡"Ñ-l:=5FhxÌò+ËÇðÌü	¾\Å*¡öO¨x;Þ`308Ð+aa.(PoºDj}viè6A!eË¸-ÄpRW
gn]¢\Ò¥q^Qb¹Eû¯¿~È*4mXH¾¦jHÙ¿SýDðÚ{io:Ó6Ñ)Î@!Ú9ÖÑYlÔìwþå$ûæ5ÒåSo­6lOÒÝ ½çÎ³!mÉÇÊ@EZ;rNE2¡CE'ñ¸M!Ué:!~¦ùÿÜÑI&]Pí«3Ô½ñ|gkädL÷¹¨)¡%Gä«	z¯­Æ7n1¶íÛý¾Kmðþ@&d£WôüÑîµq?òÀn7è'@	ãuÞEû_M¬Lÿ({:zrRgëÕæâsvìcÉÄMïö$~2®ª+÷ß©Å]êPØ}Æ%©iBøKð!«öNa´¨L7UùfÍ»²ñÃ"äQÿ°ìÑ÷ Ö~N¨ñª£o­0V]ðVÛW}Æ"{øRÄ¨{.²o`þÀ3ó<%l©1dDua>ì{"3½ËR
õë}Rî÷³ÀpËÖIë½ú;×÷L³èl*DBNêýà»öÎè?´ð¼ZhÜå4ñùºaÈíÕ/^-[Ú·!.¸z×LÀ»©ÙzH­Z
ÔÍ¦4úì_Ao£Ôúã#pEgã8c¤ACÐ
»aÐm¶vI|$nÚ^£SüÒÁ`Eâ*ì9>]®,åûhLÊþbÖ}ÞvöÜ"si7Z:ªì¼Ç5T¨[ÿXS5¦=Ë3ª
i7Öý]7vÔÛâíD$
Æºý65¾Í(ÃÍÓM¬Be¯©F¯ù
Y¡ÐØ²]b»Nu_¢`ý¬ª´ÖúÓ»þ5æy·¡
éâZCÇ¾SÃd?Í;Ý#oBADZÔîßË¢ZbYä
òMt¥¤cÓÒ×2Hîübk¤úmBùHùoû~ö§Ìa©Y§¿[^\Æl2uôÚýAu$éÜ@(õms`èêH7Ðcß	~¥H^-ÚQ£våö/é7
!Ð^¶ëþ[KûCw¥3eOÅûoû[o`û[ÛÕRoe^£OüÒÄIw6Xþqt\?¬î/öFF
5f«`´]äqEüLAÃ²0*V»¨,éÌþÖc
kûK?³|ÝAy&øé>;Tú$ßpº£#2¡00û³óê_¤VûÇ¬ôicÀ	Â°møþ:iAÂTWÛÝ¹·â¸P+A¾Ò¯¦I¨iÞÅ^DÔobÖ¼ISµ p9®Ô©Ì
Vöì%Ú½skÛc7N9zæy²ÁOÎõ°a²LòáÎª7ã¥4sÍ¹Nß>L£tÿeË0­u¨7ôtþ¤%Y÷[ª¶qm()[ZÜK_ï:©Hm¢eÏ×¬­`8ux.UñÝêS;\$	:<EPFÑÀblù6N;SÌÈ]®0âÛ!$_±rhWÂ¦H[lÀT­%hüþV£H0üÓ5í$üåÐO·ýHÇW>¡¡à/³
fCAñR½ð±°àªuÐßgècé¦ÒëÕ&[ÑJX'{ùÇ A	FýÍªÛZØRÖgÄ}G¨lAáÇAõ9pº«2!­ö1ðóu¥KÊVXåú¸Ø»/î{®µç-\/êk(@zPbÑ1ô5ÒÖöÀcØ;(X@ô©!?*M¦`1]Q£8|¿ð×dÂÍÜù÷Z7U°(§rBvJL×OÖâJ×w×#vÛ~M4{(«Ríþhi©õª)äz$À2Î±}nïYîá{Ûv¯4ü×Zã16½î5È=ôIØÙ´¶õúØÖ£UDüÓ0'Á©á¾!fSv!)q9Ðã°¦AJ¯P²$à§4íÁ¾·Â#~(ÑÜh¡úÇUÒª×%Èe4í<¾K}QÎcÿq`	
 ÖáW&"ñò0Püg(´Ç¢$Lpö/ÕµçË/«|ËþÑ³ÔsA$J#T^¼¥©Ì£/mùB#ðù)Ó©fi«T"õøKM->2\V
w¬yVG¡BNyÆÚ'²Ë±?%]ßùÕ%G(DG!c«^wv'½+D¨Çc"kzG9dØY)xÕ±~xpÖå««eÚøxz¯½Àfhr¬ÌÁnßÚ`6ë:®åOÈtÔÜåÕo&VcKê®_÷ã ¨ó4ºÎÛ8iK![¯£}S k|5}lÌ³
irp*äOa½zVnFälä`$úPKõ%U£QXüåiâÓJãBwÎ(Þ £¹ü¬u>Èþ¤âçe"|³jaÆLe
©*¨}6ü\iµÞÏCæÁu¶Þ18û ¿ÐPo­FÆQï5yï²Ãëën³èP{µ¬£Ù*ÇG'Ñc ¸1¢ý\J{ý[lñÅ&à¸g.vÝp¡(o-
¡àÁ<?ÝqÎ
C'µfV°Lþªß5!È_Z,âú}°øñ@Jt@7$o:DHùýÜßöchÓfí.jë7QÒzðû5Vñ£Só;øÝ}^Òèòª82KÑKÜ"tmàÙ£I>ísË}UØØ$ÑÕ
- AÐ³Ô\©ýßl'uH°8|©EºT£Éh%¶ÈM¶þª¿±5µª£Klüçe¶>¹òûÉs´¶~»´ê×k+]AoÁÆ©<ï9ë×a·â ôiúîÛ³Cçìñ16äù²<øia[Ü9eÈ=jé"`oà+$Nf¢âùòA)
6Èª+ÃÄ4ÍÉ5°17b"¥òîhzIJZÿÐ¯<½jÿ7[Òà±ßú¡÷)¨Ó_m°uR¦$ÏKWøzÝDGMô
éêÉ²È_J!éû>7ã¬´ú°ÍéVvâizk5kV«)¨^ã9÷ôaQ|ÀA"üÊÏä8Åp?ûìÜH(½!C¢Ö¹îtQ|>4ÎñµÆofãßGÐQoÈÀ¨e=ØÖ.é]¥µ¶È6Émá&Áü¯£cüçdÓ(_"<Ë©Ýø¿ûì)COßÝ8ÌØk*ívyþê~øÐG¶6¥TOOåWÜS"B/Í+~ÓßÅY0¥¼f¬Pq® h÷ÕW9vNödu£Å]9©ý§©øõx>KªË½ÌBáDwT¯MW$-I?¬Ö<F^ðÂwë7Á±Nº'¥ÔbL±Æº(9Xú¶Ã ÝÛÍ©½ïË¨8¶xÞð¤ý§½Cè æ×OÐ.&á=Wü8}ÏSÓæ/¬EªqùUìwb]|ç#ÇPÌÔ!AZÇ·Ð*:ù©¡£BüYQÊ^4¾Xy~Ùg©÷-íöÖµJ,ûç|DKô*H¶ªzðB9¬KEC¨P<þ*YHbA÷Üîÿ"[ °¨+'ê·£iüç>oÄ¢0O%¨¹rSùÑPÖ¥àý}EÁÆ­kû.áã£¶¨Æ ($x ÈUõ«¨Æ q~YYabª2¨8Uâ	!à	Ba,(2N4¾x þÎØS¡_#1ådcF¾/ÇÖwR¼#®rRaï0ÆñP+Èe<±P±²¢uV`K&Néûz ¯'sÀßß=tc§ùZC®Ì?[:p$Íý#HF¬9Zz..bãúv
ÈìN)Bà@öÇ¿©sú,Ë¶§biÈÿ¸.¶7×$&!ÒÔN¿Á÷ÇÄÍ®åû°®á¦Orîê¥[9CËQrÇóKíº«9ìF³!¶£Á¤$#ûÅ6Î´oVKHbî>¨@«Z)»\¸kèãÒìá¯Eã!ÕIûvÛ%»mhú_#rH¸£E¨üçCÞgùcÙ@Iz~§°ÆÄnd&=¯Àyt§(S´.Gdû*é0ü¸ÁñÆ6­Ù	@xÂZ¶¥Ü	4 =·ë¿B1ÆPÚAÁû$8VÚ!"Ä3DÝøz*i´Þ¢JÑc{½ÕUìî
)KeâúÏ,øÛÁ®XHÏÐÓ		èJBBgÈùtüðG)L1I÷§1Ï±yüÇÇÂ¯øÿY3ÈHÅf°góM9.F8ú,CnÛÄ-$Àãb)Òez1u´ö§tÕþo¸SØß2-ó¹TE#/ËC×èÚ×Ü%jEÙ"Æ$xÛXJ6ìéÿ{±
¶Û(.¶×&:'=]Aø!Hh*¶L$I(||µ£E¼üçcèä,××ö>)©)È©ßÓÄæòÛ)ïv%sÆú`¼àÏò5a°d§gN³È6iôð§ª÷W"ö¹ÍVÉE6È0ÂTd~P|=Â9«ägèa³D0mÞbW¦§¿CÀ¢{SÉÍ²ð²óOSuí/tÞ²kJÒ¥åjzÌjÝèåLÅ#ä¦×qï.ÉÞªÅ÷PÛ|CØywÿËÍ[#ÿêïÃyÞ"Éðì?'úìBä«å©x¬VRpn2æN.ÈÃÐÂyªçnD=Ââ$#[B¤7ub£ÎîÊNPkâMÞ©^Ð[ÜcÚm4ª9É¼EPC,t/ÔüTá©¤ÇÌ¥ÿnÄÝ¡VÚØ­üµ£EÐüçeªÂ¼Q*bãÏt+J´5oIñ:OÞ,ÃCÓj'ñtÚMN6Zq4¯ Mxez¾üv	]±DÉVúã¸<Ì­îN´Ê¡©Û¿-Òã(Z9O$}ëNÎ#ì¼°ÇP¸o¶ñ¨,jµ­*ZØÈ\É|·yU¤B|È¤qôf©,ÜÓcy¼ã|S@ùü½(FîþØ#ü£½Í£ÂW±`/O,VçÆR°Ôf	Õµ®8þ-z@cæ6Ëpslïæ'Äel/z\² ùJYj%FDRDmSNÅZª»õåPvÃùÉ72¸ò¬>8KîÎéÝ°dDÄäO¹z±H6ñ#¬Í$Í­¤Èªi*·£Eäüçf2®¥{­ÂÎ
Ì£½¿¿÷X«¡ø´Ø··Ó=£gçW5Ý¥Ðö£1Ak-ú¹-¹1#ëï,èBÝ­iqÜÜJ0"Z-¨z4|^
¾ð IeÇù%YõÏ|I¬±®¾|<²gÁÍòipq)(Ä×
2 qU")j¨cèoÌ0<ÓY;`¿<¡??²%nYºÃ(5<yøÏÌ8ßCjÐK¦eÊ	ärè±<rª¢øÃ§þ-·³9!\iûÇHê¤¥ÔVÛ%ó¬ÀvïS~4L=ui7úäÁ Ií¶Ìï´³¼üÿGÈÁÛQ ÕÌúGùãRÛnNuçÖQh áÔc±¸3+®û6ÞÄHúJ_DÕ¹£EøüçD{ã7
þH£öÇ*k<xv~n4R'
ï|¹Ëöàa,v{A&À±
¦´å55I³ÓÁÀ6Ú @(à¼ÒbO{¡V[üC÷þtçkúï$Ö¡{¡3õûU2Æ¸àüv}ø~O«GD
sÕÀÙº:júMÑÿë^±·8N.D±w¿U%óm,yL®Çö@K||òð§@z@)|XÜv°°Wz¬ô´ù¹è>ý¹àØ[O­
T9®&ÅAhÎ,Îú¥`æ¥C²'èÛ§þÃ+ùÏÂVósDö¸»¯çÏXôZµÃÀFmÁ@Õ·¢ÐÓægôÖ9¾ßºH%³vÛµTõûIýÁ£EüÈ4Ëß7Í:ÏìÍ¢ÔSäWâm8Ôüg
¯/*)ü-ùU}pò]QºªÄ=ªØöÆi§+¡`!ó©ñÊ·vRÚYñ%Í¥H0
áÆhïCh¡à÷«¦¸sè×Ó$®í¦¡¡1»Ud}« ßö¡B5È³i_ÇåÂzÌÃóÂ¤´û­zRÉò$ÐcÂÈ¬çG|,5ðn+õ â¢¾'½0CÚb<öÈ5.ûÆ~ín¾ò±4r%NU)p|m8`ÕÁK5¼côÎÓR)ôÌ÷y#uÙÅHòzx9²6#"zoç!4§nÿ¦QÇ5`øM8¥FH/â)m¶ÍìOuôíÒÅ£E ü1}Ñú&ª`IaÌ^HÉ·FJYäË7pÅúª¶¯ÁJÈyn9&aÅÒü¸ßñò/ÑaTéâçè¼ÕÉWÆðÁK7öÕq®¦lÑmÙUqðWðáTöÎÎvÿD{ãë
/ãxÈ3ûÄJÁ¬ò8¦\àÛÆíwÌT.(Õ½ýÛlôÿñ(&ôl*/4IÍ®îex¢4Edf~ù;&½Y9psõÒumÈºõÿT1uNékVUñCUKúV5­j¾ÇR
ùíþáwdsNLËAÅY²OËßÝÒdÙsMî÷"TbÍÍ
àfå®4mõÆÔõ|.(Gé[C¾åB­±}Þ#iHÈ²Iô×¬ÒÆD£E4üÒñnµ?QFâÓ¡½ÞePPÚ7}½Ç«CïÖa^ÝêçöWôNò»zz3¢Þ2ÓN.)u¾:õX~-PÈ9Ü ¿PMXWå5"ýv½ª°8¤C?ci»Hññ#<Úîþ ³¸p*ËÐ¡¹ÃÃÃÌõÑ7
Ý©HñlÞø½À*úÍ¯SßÐu"PäÊ3%rý|îigIð*líÁqÝ}ãVÌÂÈ£­Mgº¢[©súÀzê \ÑªndyRÓÊwº¬ÉÛýJö
ÄmKßîê¯Fk©>{d°ò§/=f¨¶Ù$+ÿôBd£EHüèd½h©PÀ«Ô®OKN}¾aÚe
A#®PÃèî»
Ìh2èsì¼ÏÞµ	 ·-p7rµÍèxxÁ]Ö'åhnï 3jhªßr±®¤ãÀ÷¼u×ì§Ýc$!çàëÞ[M®òÚKÌ¨
ëºïÍüp²HæóÃ0?e1ñ+Dkí¹Ð6Êjà¦ÁHqýÙ7¹pe. 7ò#ôuºþððÇYîõÝ}LE¸OÍóUþ})¶QCI6=$0ÔÍsGl&Q!Ð§´Xpkº:UYºP>Lz1®´93Qlu9{ÇÂÙê|5£ßëCtÎQd}©1
¶·jVø
¿þÖì¹£E\ü®¹¸3¯ÿañÛå¬PÛº×ZèÎ-çmKxr¢¡ã]Í¸îw9·÷ hhªÌsÃGÆIep]°CJ§Ä¢ý»yYÐ;6)¶{ä2M0cSÈànùPx2cÁóç'¸7Â¶2MÕÞ!ì]®ZcWz²öoI°çãaKq;0¿â¢ØÿÿÜ0G½:ÊÌ`©äÖg½Êø#@!uVmsÖB¹MgÞ_»OJúsÆÚs~ôöz²9lryBÝ¾(ßIc+.{~pÖ×è~
¸3v1}7Y`Ø×£MëjK¾!]ûßîí·ªÆm~·=)H´úËøwnLGIéìü6¢ßª~?·hxZ
nÓ?À£Apü
¦ýë4yuNç´Û&=Ê|`ÑáköséÂBíLù¼×þ²ÖóáºlB\dÆªÕ¶KñO:¯èU-0M XjW¿Y;ÜÖýwÎ~*=¢ªHî·ôê5_a[wÉçù:ªò§{ÛIÄ)ÙüngÖ²O¨ô~ Ë¶¹ÔþìüðÏÃæHWRfõ^Ç|\ÿHMÁëÍSåDZmd3ËþîØPÇ'8ÅÆ" â&Ü2ðI,nj?ÑeR dêuÅ¸%g½á¨¹o
1l¼ÍúÿÇ&Tñ¨!¬ºõ¸ý¸Ñ@:F£ºK~\¥6UóÝ.ûE-IÀ-õwD°6_íÿUðÿ£/ü×¦5cÐ{fuÔ¡´Vµø±/¨¡s_ÆD<p×úmèwÝÝ;òzÅfO»ãWÕ51#¢f®R:9]þÝ?¡ßîÔ²ùZÓ?¹³NJþU²Á\ã¢Iu,Fþ&Ú4~J(¥GÒ'âØXçÆCe÷NhÅ§v©;Ö+Nñ2·i"tç¿´J4'iÝØÍì¡Î+¸h?¯£[SOF°w¦pê0üñ#_=Z¾Ö{á}ïÎ ^RÊ^F1ÚòÛè$Ó@[{ÂØfõ9/+wãç<¿cq0¿PO®öÐxß×aN¦lPÕEþàoçõ² Ì|Å¥ÈQrûnîë»nÛdú¯úõ£(üó*Ëp¸Öå-ôhKqksìÒfoìÚ¸Ø*»òó×K u°w¡»Ëe÷ß±ËíË@öê1UNIàZ4u\d>gêôD<DÊx?$ÙÐ½ôlUççî_×ð³A&ðô",ÀVÁc"ó??*ÒüØÖX¦wA¼¾ìÕ\}^ÈÐßÌ £ASS8¹]c°R±CD]òa9ÖÕÆ4ïôÉú&	~ÌPV«<þ`%fÙ°®Öø~¸#ñZ<äºÞV`YýÎ#·¨-û0À°cséuÿ~"¸ýiÞVýÐ×__âOrÙ¸oi­|4
¡Z~ËG»Õmý&í	¥ £|¬üvvîW;ûàÓ^Ëú5^j¿Èáó\Åí]ÚÖj	ä>+1_?ñY1ônLmRXL»3ñ^ý¤g¯©<hà\ãÏ¡2ò:@vÍE7y7|ÝäµÄ¶Sõë|úÉ¥V=kì+Ý·´C9ïAI$0¬Òñ]cMºÏ]òlu<ÍP±^~ÍÁ¯jíÿðÿ Ð$¯)G¸¼üBx\@ÅEÈ)â|¤<ÿ¢XÔyHõÐV2VóÒdq½àÍpÃ½ç¬iGßÛ©üòrIK§2´Yñuó7VÑJþ}@ºqÞaöaã¼5¶ës ò| ¦Y»Cn­j»ðùóýÏ«ê^{>ðÂa ?ÍVEt·ûå¶Ä³xÄMZ½þié¥Ñµ4"Ï#)Mj«WZ´1¿Û&ßÛØ·eU¯ª£EÀüoÿ5wÐ´¾x¶6¬Í$ïèºÂëz¯¹^è\*Û ·ÉhýÑ©c`;´ÇÕ²'4>Rñ}eÔ+1ß££:Tgm|ñyÒ¥jËÚ83åÿÜ"RÔÆäÍ9L¨Ö¯Yx{ðç#Ú)Õz1ÌÊ(ùE'½òtò©³µÇtÚrÑ¨öCX§éüÁ¡Y0C§þ1«6Åû;Ç3®÷ªLðXëköII\4Z/ëÃ3×\\DAÕ>G¦'ØíUô
ýÚ«rfª$±×Ú`0²¾¬Ïý1PTGa0£Ëd¡ßÉr`ó|Ár­)²¯hÞ±0s¬&´9Kä¢pÜë4ñÜ»¢£zfBRJDm ?UmBO£"ÔüAñâÆ-Ñ÷S¨¼7ü¬<dbõâM¼ýÍÛø;ÉV(ûw½ìÝÞ"ù{ç@1d82ï#­*
ÝxaNÄ7þIåt`}ËçÊz£°´>ÛÑ¨ÍÈ#¶Ð;ø¹®«U`dN(«íQ$ÒL*Ñ^qßi¯)'1Íc3ØT5ä
ç¾ÇxÊÜ¾'
I¼n¾Ó¢ü/xíùÀ-¿Èë·»!«I¸mÒTÿå¬´5G£*1Õ37xü9XùQÖÿ±²_ólñ}Nm¬ ¯:ÝÔ¡£	¦Ûªs²wNkÊÒµÜ"t[Z"9¬\Üeª-µîí1?Fÿ·m_Zª¯úC¶uÿÿÿÿÿÿÿç¦£$ü£ç[BþEm)%Õßëö"A_)lôü|'~ãê:N:-£jò³ü¹«Íwk#ØdýÙo÷gæ¬WWV0é8(Ô¿°³¶mÆ ãu3T\0©ª²NæyÅÓÂ£2Xä=¢Võ£}Ó¢LdyxP°¸Ê¸IEVº!îÅîðµ bßwç.Y ö*¿ñLò?MB
àh«!å¤túÞÖÚä&w4ë¹r¹Ýö©Ð»
$w}¶¦Ñ¼ð<áÖ1á5öËX!É·c&YX½1>Å=8TÈî®çoß¾YÕÙW¿À]ðéÁu¯+X¿)CõÛ&-Q@_/ö'dPðª£%ü=ßézÄî5É\
Dåî\@fÈ+!Ïx¢ÿó¤¬6õkÑÌ,éð½Y^I¡c£7	%é¸£q&«óì%8	×EÇïB]`Y© ¢`wÑwÃ}ª^¦yªî|u·ErAÖìiMKj3­¡,F\bV{ÊyCÀá¿plÌ77KùEÖèVÈ5O	OsÐBº½©óG=Ð-f#e°vAÒvø¨Íø«²
|ê°PQ.-tîáä#a¢.#^CæF¨í­4UÀÄná¿£1#rP±Jà2­s,eÂcW,c.yI¬E@çr`	6ÞáÑÃÄÞZS½ÑUÏÆp6Ù&É&KvÖP¥PU£ (üòcì¿þµ@/| â¢¹CmXMG\NÄ½"=tïµ;Iì8®d7*ì_´¢ÑÊn§¬§SR¶?îÑY­jî¦äµ"O{²>Æ»
«qp¸ÓßÈ1öOc½úT¤K¡é>´Ø'ÕÌÿôÉÍüçâç1Ò¢ã¹\^!{Ü©×»>WVÞELw%£gak/
½$gÌâ±ªVí5çS}sWß6#´°«	í)®ä=/<ì]ÛçjãmÓ¢,øÃ·Ã6¤~ËL>ùÔ]ïKjÝVKq_m­8T÷Ñ÷ó7&Mÿm¥_ª¯ª£,<üL¼nùpµuëõÈëQ¢òI>ÖðýMO³¨<DhM2ò:X3aG	ÓÑ1Q÷WºÓ0./_¿pi§:G6<43r6^&Û\Ò-ûuÓ--ÓaÂ]þÿAp(fír{w1ãþa6BOrþEì.£! 9Ô[>JíG1§¤ì±Ý}Ò2¨TiÇDjÂxÃï{¼'ó.Z6jhÉ¤æ'¿^ÖòÞ.L) òBé«kºî£z{#¶±º°þY¢Äkù¿§#G÷PµoôGv'êÔ&-&ë»@Å¦´¾À>M¦óL!`õ0'L§¿kXcÄXõ5ÏfÿI´­ð*¥¥v£MPü2|Á&L«l#£§¸|(OÛcqÃu²[nheû_O¢öéuÞ+Ï­?þÆpÊ±üú/+X²ýÁ-ÿryûÿ	àXyÅÍÛÞ)R!7ùA>QºÊ( ©8ÜÛf±Þá|»û7Tk¿ø1J±z4%ÿ¸×¡Xn¼~	±G$A=íRá+sÐï«îÝåûAËîLqP©üEHåôÏªRoÊ(ñEãÓ(=bgEVR³úê=]úÇ×¿ê´BâÍË\¦ÿòYYä,>¤e}ÈsãÄ:lõ¦É÷Õ1¢¿ä)	5ª)©³Jþ m'ç)¬[¦lïtøcZYúpÛü> Fi¥mºF¶ÙCcÌ@!¨Æ¸Þé3	ülÿb@6µ&ÿ£Ydüåh¿k<x µøýq½«tÜocæô¢Ä`uIÊaÏÄ!öuøLë/¯rÌ:BÝÄÍÚÈÆ}
È<úr9çÙõYÒ&p%WuêíUçåx¾äãý¢+êÈ:êµú9Q½ö+ë\¼'ívÎ°ØL®Ë¦ËNèá>Ì9û1z;ì*TM¤"+Å©en&e7ãðIbÛ®K¼ÉÅ·y-Y53´)wéµäy|Ë¥ªÎ%q»
Àh§Y+­<óQÁËK{LæK?}aÚä²L¾}Ö*Êe0©]çAìX(*ÎË÷iYQ)	s0çEnQð>Ç3%â~ÉÔí»¢G¨54äS»-à.>E®ÕsZ¯TÔ2OZí):Î"ª_Û·ò"_¶Ý´!´£fxüåio!T¹ö:1º1DîoÄ2öëú¾ÑÔ\/¬ÃZmGÂýxj÷îû!Ï.°Äx}¹5m·°j!WþøäÎ©²êU"Çç&³¹3Â	Ö_ÉÛå÷,ngãí±WF°óoê.ª½´Û¦àþöæ -çÞ, Ë\è$Ù$öIõÈpudµÙçrÈJû/_Ñ ÓyFx$¡ûµ:&UäqO^mØûUÁµñô)Ü{G3Ôy\q*éLâødÚÕÈRöùôiÆüg¡ |òËÒá¦¿8xç!ß'ýÆaê+
OÍÈêV$ñôfºÒÜhD12¢V9¸zJíB¸æ¢ªÐØ&X1&ëw1_µbq²ôù½GÚèTª<ï
vMØ
M`}ÿ°~Ø	[i -(v¬¡£oüèÄ/-I¹NÉûðÈ7ÿîI"~ýWaACÛ"æYµÁE°±Ë$ã±ëmgñ¤èô*M4WzØ¨?0¢Ü@¡KÑµG7%[±Âß`~öw oLx¹«ÕY=n¯i<ñ`2äóo¯3çn7à|Üú°~¡¯ß.è·hÖ}Ê²»]C>»ó DWAªk)C
p²ABÈ|ÒãstD9³3¼	Äè|Í"ZKGã¯lø;LÐ¿{)\¹C¯í5zd¯ªêÀø9BÕtµn>"¾JT_JTä³sðlv7RéQu©cpÝ\NðcrhGÿC"ÌÀM{¸{Ø¿±¡SUæ[)QÅ²^+ÉµS£÷uñlM|$Îþ®nB1ù÷¸Ú¥,ò'ûÙ6¥µ¿ªýVÒ££ üçf2ðaC"*â²Ü³z6y
ù^xÕë¬!Ú ò¿°MîÃöí²'Z_01ky@GùÀ_r'v°1¸é¨U$]Ã*9ÃÃRq×ÐLßñ+±B÷¼mdè.Êî1ú¼^Ú<4	¢	*f
 ´ñ*íý8 Ï¡$PñÇ"Ü*¼>.Áò_c²-ÙÎ=zÞ«n9ÄuÏ
dvGY¯=êÂÌhW|·âÿ-kªRaf§×éÅ2¬DòWjüß¼+ºp `»WPD2Vù`û'2AJ%Ó+)Õ	¸5xH§¬ÚO
XU²(¤^yÐ]¾p¢ª¬GkU]0á<N¡ì-¨®<ZÀ9r!ÔtEëk_ÒDÝst2óÍ2â«íb#¿`¿Úf¥aEÙ{³ç´añöóÉV°uak­9-1wCº¿ìëá"DìLmnÖO¨WàU¥£E´üêrüOy|	©Êå\Ç 8&ån¤õ stÒÑâû»CëæI_çG+êTxv{ÜÍ6nxö)ºÒYÅEÉ$"/	¸sGÜ\þAªº»8ÁàQx¾¦6£çáÏN4^¶ÿXsÒ ?n.ÅAöÎ<Ãª2rº(áIeG¯æñ>s?Âîm>«y/»éáð|¢6¥Ë­4öÀ÷¥2>u%ÚÃëöÐìITLIÂKúhÿ(B¸c>3-¶'O¿Ä&°iÜ¹rm%:þ2r!Õ¾Cú´*ér7ï3Þ©m-8Ïè0§÷CWóÐn¬5¼4N° Äh7sÝÁh­F[n_e¼Å§«ÒÚm¯'·-
RHgÉTÚÕîEàOêM©£EÈüåjÏ7ÀýhFþã5%â­®¡ m¸#â¿þ«¾¼
/îa÷¸~Y6ÛÊ­5#.dqÐU²Ëo%ojÁ'ú(0NÍb6ßéLOÉ¶Vùæq:±-;[%_¬âd¦ü:hwt°ª?|¥ ø2MK|:.yé)ÄBÌÏr"¿mQ¹0èÑ§7Å_ ±o¶TµûÀ³jñvüWR+ÌíÂ$ÀT%lg½êåÎEÆÑX[FS¡¿"4Â
¤È­ðri¡~Ó_+aR{I'û9ÊxJÔ
¹zO+ªÄlà¯2±Ìý¡_§Öù1ÁÈL#I¥ïï×,ôÓÛ³áf¤zit}Ö|øÁÙ¬Â%¤I$Ø· z^é[Ý«£EÜüåio?kIA@ÚZæåU?ÐÈ©Ø¡**r4 WmÓL²Äonîó6ÉÀ,M©]ù¢£QäÚ}{8)ô[.(f0ïµ_uó­pý|PðR·z¯W°¢µ®k*´ð6²tÒ÷xútä?¶*¾PM,Z«¥0(µaåBlÌÀXgÈX8g
NjØO^þe"l`´Y¿ò¢²^+¤È/ê¯qè&%9R5ÓX{í<²Ê:'ö×ø+Ì`M'ÉX0ÂA÷NJ^ì.íÂÍ©ø'ûíàH=üZ^ð¯ØpHèíQ¶©ÿB»3a
6`ZEÁÎ!
Ýc[ëÎõ%µ"6"R[J¤ÈHPgµ«£EðüÒe3s~sÒÝúrékÂµÃü§K~oùâòM¬óA0cOZøy <ÇúX-Ècâ8¾ØzaúÏL¶Oxé°ó ×õÍè-_&%	GKl±g¥âìÜ´gÂ3è&~C/Í?:!6òÇÿ2Wïol@ªo3ü>yÆÆ´ßgLFhYÇIZã¿Øo*àîc0Ï?Ï>õ}9QY!å>o´KmA<èªHO8>ó9ø¾öBve3´*] 2?Ùh¸ÓâËoÔRÍS_Ë-SßTwA#Í§ºGËC2¢cu`ã][©¾À[·Ú|çùÉË6GÏy,fX9æöÙIU	¤¾cwn"´	 ú
¨­ýØ£EüÑïRú	óP±þ±"åà°æ½wêäJÈ®L	Ç¥Á
mÞ@Þzz VÛrá#ãsVat-öµ|ÁÝMmZZR9êq_~nuÃ03«ïk"l$þùeSf`£øvY!âsBC«ë´Î®H£õBSSe÷l
ÆQtÿq±S¢L¨&$"æ,ò+EV a$D1gúãtÚYf,³´«ÅqhâÓN_Ìa»sÚûSêt¶:õd©(Ìª2·¹Êv]´YõÕx°«E½.=z
\ØKÌy+¯0MbÌSê¯õòÍGMúô£8é®Dõ\c;ôÆoð
z7{dB Õ¼SHÅp9 ¡o¬ÝJÙ6öÒúKÿªý&ÉÛ£EüÐØ;Òc%ì7ºVØTW"BÃ
H9¦(täºðÖáv±üÎê(¢s­¢PXí&v"ÍÆêm[m­H£äè±VR©Îc	.*öÒV¦ïÞ¸²Ç¾°~U´Ã¿ý¢È7ñWÌJµÎxyÿ¿GÛÑçãäSç?ì
ËÙØÓ§5/xµ¶¶¢ÀóNÆ²Î¤ c~á*7ìhÀ(²è½.	$åCàëãìËÔaÖR%¯Ì3ûq>4;zi2L^»Õí¬U~äRÑä´ªÌúpÊ¼g'i/o5Hëaá¢E¦6ybâ9Û4ôÝµæÃ£þ(ÄÉþÞA¡I8´'Y!A·2öFÓ=$&Ù*¾½ÀÙÞ£E,ü®(j,eá*ÎF"¾8jµ=^¶!`ÿKa5ÍC88VFv´ìÞáè:Dª¯àxa{@ÒE3 ¸u|=
óÿ\³JéÀ¦Y?¾»©ô :2Ýª%ÉÞóÙÃõc+cZ^J*-èâb«Z8çÚvPøÃuK­Ü:pÇjuG
Õ89¬S i&Å@{J	ðGZ<fËb"`Ì¤oÏKr:âuÕ.ÛNÃ¤Qæª1æû¢®¡uãtFód+ýîÁzB-]l8¬ÊfLN.®Sl=ªÒ©*ßr =ùùcºç3Z/p87<pÇÑtÎ6¬ØÉ#Ñ0
w'q?íjRIõÿêµ´VÐ£E@üÒ}þ)NÝ«iìAb¥ohÍ.ÝÃ+0«ÅdÝ{wYÕæÄ
 ·
7¸:¢ÓgÿÛ!þ2Êe=Mùè)o-Ôï­è	ÊyW&ñ»	Ó%l¹÷êY6b9ª7úª8$Ý>f!½h&z]&xÜßh\sWÔCø
W¯%eêËCÞ¢~çÿ-Há*õ»²Äb2¬]R}tÖ¸>é3üp!rïª)©Ña};8'ÍXxpì Ô¡tYyV*K¶ûY"ÇýÔôòsÈâ-á+C´ Ü)ß±GW@Ý?9Û).Æ|0¶§L©Ö5y(¶À¦8þçÿc"¾	<B;]fÁùk -w%-­©ÚWÖ@ÿ¶â£ETüøÆ;n2/¥.c!_yrmßú
ÇÛZény w~sÞ&ãþtåÿ¡~#\ÌÓ~
MM.YØ1ód^´»$ªFY·oã³ûqOI¤óYr³ÊEî"6l®Ìw|;6®!ú±]²ULØ\,µÖO)øgÎÚ¥.Z¨+cË"b¦
¯§V¯TmÐì÷¨Ìt\¥Ò8¹
 ½²C{IæÈHä³`ËÏÍ=Ç.¬Ì¢Êm(µ9h9±d©>z}¢ÊJµa^Éuc}bXÞ 12 :Èà®?ÔÔ©kv!JôDÚ°qAGð»Ãpµ»r&£ðør}pgbö#N¸x¤ö£õpÒ?þÜ$¥ RÕRÕLÿéP£EhüÔòf:EºUaÆ21ãoÍDØÑc]J8EN´ûlçuCÙXRÑ¨¸²ÏÀÄ0AÈå>&3ÙÝ¡õVFÅ	sÁYMÀV¥ÖxIº´TàÊúH£`9o­2îÏõÀûÕN1R~~h³ï]ÍY9ý;±ÃÂÔ¯ÑàzNÍ§y0ÐºF1Ý§m.à ¼d]èD7	Ú	<yyÃ+ëåc§	u@òðWÐYH$ÀÛ·Êýæ»]$îDàr2xrÎtNCåTmápc;fÞ³F4E²ý¢½ó`|ÔÄ¾^U\'rcVD·Ú`3äiåYÃ6òr§²ôê,y¥µ+m{S¡ÔZKä¥?òh=ñ£*|üSª¼1êò8ö\zãÕ¦?Á.%ö"0ð»(wÛYÅ\ÃA©Ä5ùÃ
ä6ÔnwÅ}$ 	Gè9O·)(Ó4³ÙÕ*Jå
diZ¿çèiÅd¥±àFö9CVçJq,}LÀÂ³"U}5Ë 8ò?Ù|ª>`=âãC>9¸¿Òå)´ql^utX©,ý}É:äÑòwõ¡Æ#D××ÀEûs7Oæ·#º|í3Ö±[âÔï²'w:(?òp"££®±|\g|Lj1÷R`ý
úÚLÖç
×çÿ2úçPÓÝZ`úÒò¸Ñû§5"µ½¶Ð¶Õÿ ðª£`üöROë·ÖØbðÇ)åv[K\2\LC]ØÝÜOQ9H81
P d0¤;¦g9&gãÕ?¥.ë
/6óå³&rÜÅÎäÖCÝô~Ìô3Ù<½É/;Ã|Û	ÙË">öL ËÒ¶ìº¶+ÜdeXÓ8MÞ±*êF¦Bá+¾7¬åwÓ	¥tûÉ$øà»©9J.-«sjÜ¼ºðwô
ÿtÍ¨¡õvW?¨Xµ\È=?d¢ÛBÎá*±Óâ©ÂõrLz+ÏÏA³$æ¨Ìðvøîy¡<ÈÄ8í¥måui±^Á»l¬ÃÉLûäÛ2ö3{rÁÎÉçiÍ¶Þlä!("vE3âMÒÖ Ïqæô0t0Ä"j(âKù£#ô¶@ýA[¯¯¯£+¤ü?ÒVæÈ@sBu®FÉ¸À{PòãÒÕ®êà
)òÙ*de]®aþðÜy\^®9ôu)$¬ÅqS­âì÷û:;nrîôÄ^D°`5©ºn»áX X!µ#ÜbTL¡³â=j dùÏO!`ÅÕbtôð¥yáior¹7(,ç5)c­úãv7µïÉbôt:2aÚôÛ¼)}¿PÝéNoK®°ò%»lÆ_ÝÆ,3«Öò·)y&§Ì­&yD+³ù­7ðàA×ãÌ´-ª¦
îQ°î`0Îd¨jJd\ËORâ¯~â¤"[Øvð¥UZõZ£.¸üöÅDcÏø¨ñ[äñèñºº
îF}6gÇ/SõÇLÿõùÁüSYGq¡½ÿhîp#c'ÄÚ2e-0ïËÓ8 ÜhHkÆS
x÷ o"ýø4>ÛpíyhGOWXµÁ7a¡:ü@Q!¡:ùÛQ£ Ñ¹ðÊ(D9ª2h>õÊ·p%K!·}ªMÿµ3½#	99æM¢4Ã«ìï\L´µ¸=¸Mb&ZQ¥¨3Lm,¼K¼ôÖ+íÇòN³AÛ=ìÊËÒÞpYðâ>hÙ¼áÂüÑcnª [²©¬)$våW|³®^3!*EÍkÍ¡ýwbØ3©UÔ'vzä²dHÛªZU
ª£-Ìü	´"làJ+AM+ò÷ætMÀòçxóÀ§¶¥¿5K¢tv®>·1§X×6NCq¼Hâã-B®à¾{MÊNözê
UÂù\µé-¾eçX
¾².½m	Ò5n+I1NÉò-ßÍoirIÌUo½ðéu|Ï0,M/Ã]Î®ÅN¼ëÓ`géQR^<Å&ï¸YË[]âAðó¬
pýÜÑÊøôO{/íKàyy$~ClD¨&RÃóêÑWJ¬bá×ô»ôà(¾n<ÇûoÒ7ªíø:xg$8bËÉ5ïi[[ë3ªÎ»í=Jç7¼=µF\èÜ±ûG­»µ´'õ_ú£3àüAf`Fu%Ç©ÈæWÛÆý/6øfþÒ½4Bó¤LÀO§3F0KnEÖ8:'""kë1ýÎúÒÊ6ïT;Ä*Âf~æLEúºu¹Ym¥æ½6MË+;J¬¯b¾là²ë_£U³Ø'Ý)s2ükÜ3±1ÎÄ½jäD1Í®àÁ,DiÅÄÏ0þºH§CiÔ?!£ôN)Uµ$qFÔ&ñ#·êÈf¹[~¦X¼¼Ï¶ÆG¤úýÀA;}©V¥<~²ÒB@§¡r8¹L©ïUMÁ&\Û­[4õ±²Ó0'Ä/þb¹rÆ­ñ$Uò$±¬EÍ?ç>,
VÕûCíÀø,#)úãð?m¹(
Z£zôüpG¾~WåühNj¢ÆÿêfvöÓ(XÆjÂ.FtoùXY6!ÓÞÛøF=<)C-Òó2ì®ô3-aøý]P¦àù³5ªÄïúìÞ]+×¶Èå$âM"TÞæ LÀûl|¢ìd	«ÊzÔ|`øyü0k³!ÇGéUbØö`#óþÔº?g1ø¸#Çî´Z¼qê$º)òYëöÎ69¡R\J{ÿç¿ëýë§ÃrXð
J=À9b%dQ¦?ÇC¼ø*óyå#
ÿX´=8~Íi.P.s<!UMÂaL@uÕt©1l{*ÀØEM(¨]îâQ4¼úÛ¢pR½l~ dR¨o­­9`4bÓ×³[É2ËÕ$!kÔTtýÂ¤ùòþïäJ@$löäõl$£IüS¨UhûA4ßÿxñïBåìé9ª8">3Õ,k&`ø,Qùo¢vÚÁ:Ö2«iÃïê®ó,Ç28³ÎóØLYH¤é;°ïP4âñ¼Þ.$3)8oDoz/? çÜÜèLÂ!hè	%tëY5°ÒGÄ²I¾ÁÃÓÃëâO»Æ;ÈHª¥ö^ñHßö{ÿä=Â×¡sÿ±S°ôþ M¹;UãA9¶ÕØ¥³ÞÞYàLîºuÄâ´"a}H~%º¢bF#ûsõ¦¯--½ø0_xRíDj·rãÍ}£RsB9w
ß!eyWÞð5ãV0ë(Âë3S P0ªÓ¶«T6TªnÖäI ÿ¯Pÿ£üAã´·/S q*5B¼¯\ ÷i¾	8p¤bÎ:Í%0Mß7'"BÊ»Òîgê?
Æ²'ëI¯þì$øuÝ½(êÃV~Ü¼üÉïow¢HáQõ°qõ[ÖÀÃK·§;¤çvqþo$ùYaßï¾u¸KU[·¾m_âç½Ãk|ïÃ­Ú|/¾£n23»~,ñÜÈéXú×}y2Úd¶À|`D\¿ÝÁMÌù_Úp7ýâÃ«îÏÇÆè üÚ`ÐÅn~ÔÕ	(9éD6Ä=nêE4½!f0n/.ôLF.%ÀÇÏ
o´G}¶Kkm_
õ £E0üg7!Xö$}¦ó6¤ QFäëA!Î'Ü`·ÉÊío`5Ú'ru*pÑw±z¨3O²h^½èuT`¦ ûFó-PärÒJé	ä><¡UøÚÞ»»ßmsÐCîÐéôç;]ªZ<ÚUÊ8 l±ÆÎ£ØÀ
b'Ø±ê¥4~,½çåØ3ãÜ±2UÃSfhk®D«Û,ÕÊsÄ:?ë<ûíoPÆb&¸¹h­#ûêÂØ\f÷fy@÷«hß=¥J2¾áÑ«[~+p~ÏË£ææ+¿¨O5îzã!­+¾6¥iù4lFaÐÈõßíO4Nyß5
F
yåkp¢ô$U'o -üIµ£NDüæUX+"-W³èðvÄ@ÉË¦ÃUÓ¸¨sfE ÍÚ]RFX³ÿ¾ìi§&;ÕS¯:ò=ìS!êî·÷¤Lt6/çkCiÄ^_º´HSTØqèMÊ¬¨¡ÜÄÞò -<æ§ L¢æýKJ¬hË1Ô[ð¾·|¿NM:DF|Ç÷N,¥½dËöÖßË%rý¥q×Èã4	ÞXU*~ò0ã9L1¯g¬åTrwëçNÀ4Ò¹¤ûð-^5+}U?ìÇx×DåºsÌA?ÞQ¼£¾}>7¥²£3ä>Lú ¨) :¬OÆÎ<t-QX£}^õj8õ¶·¼µÿý'4çÊXlcÖ2L¶KV¶µí6ý£UXüçD{ý½3£aÂÃõáÈwZ+U+´Cà
üÉgn7wÄ¡îLðã&£ù´Ç;|GÛ[k©Ç¦K«zÎë³	ÞiA3då´ïºùø5ãUµåØ©róË¾<§+y^[OàÐÁÙêµø2äò- E¯álÐa¢,¬Ò`Æ	À·÷RÖø=Ießêèï¼K@yà`aVéµòé{+;`¡xeâÚAèLþH ¹`¢ *1½Âi¦'+>Òn:¿ëÖ»TïécjHJsEðÚË»8á"oëHg½«vÜ|¹áoÇÞà©þæööï0w¶%BTûÕWG{_3|Ý¶ý÷oÂhêNÎu¼O×¶3 $²mà¿òw-¤£Zlüåioïåþ ­.;NªôjV3Ö»7
ì4oQá$YqþRçÀæüÆP8Y%)Âw0m^¦cÖðÌòùó÷÷Ù¹®ÃØèò"ÕHQÈ1S¦£ð·®-X%ýV-C¶yìEZ-@åJöÅíÕ<êÛÉ3"¬õm´ð1Y8mf:ãÑÈnÑA­¹«ëà?õ§Ô|·þ |9yCÉòKMÄAÝàµÍRäÕ¥Þ`tÎßÞPëÔJ©Â%ïo°<J:÷ÞFé0»ygÿ­Õf­¬»ä¬ìLØS^<¥Ð½Ô.Y5íäàÚ,7©ÿÃpnÁüN¯²nPñÙÝI¬ÖÈgl°§Às«³ßØäV£·v§é í«{"~ûIm7kíÑ6m££Tü\Ð{#ùS5Ãq%ÖÀGôVDØ6]Gf°x%nlý|=e¼z>¿NÊLæÕxm·P5EõN_âEWª3©ºIXÄ}Aë£K½s{I{äû@v`NýT_ï©pôÈ(H	4ÜãÃ#ô¾]ìøÆQù´¨Cét/ªõtÖ¿²Í=YP%±¦ª+
Y_Àúâð6w@Äë<çÄCx|¬/»úÉE¢_ËKÞ8Ù,JÐÅá²~VÙµ_,Ä½zÝX]ñû¥lÑÁjSnk72®aû]" "\z|ÚW¯Y6_Ré¦ÕVUËÉâÝ-Ç­Ë?ãrÏs§è?&6ýçDòeàÔËo]CD©¤HØTÊ>S]ßær6MìLRª¤JM¾£TüêSäáñWìö¦Ôõ¡T0é1Ò)m|ûÙ2¹á°F¬MäJ²!ôKû~_¥ÛQñîX÷½¹jGùM5áö7ÃÁ>¼ÜæÑþëãhr(ëHü2²¹çÀ0i²qýÝªÛÐÓý-v's
 UÕüòéájciJ(8JzÂIÚé
;¦.j
ù1:6ÖVpqÏË½õÚ°óaÂ¬¬àbÀj[òÁM>£0  ±¹ÚYÇásÍgkäPN²uéó7)ñJÃÉM/ËýKFxfN7LéÀ´8edZA¨dõ?)fh<@¦¡ÂR¥ì­êÄà¾TøQA¤¦*ö4}Áü8oÔY`6°ªTcr,ëÅG¡
Ä[ßäÿ¶Ò}¶Ð-~Oí¾£G¨üí6éÒ/Â8ÁÁýR³5Yú¾ÃE-zT¹ÿfp,%`ºIÚtÄÎLrA¯¾c(þ]Ñ2IF)QÌc²dÿÕ½àÀ}N o¥9wñ\YO­Õ	£?¢m~pTÁ9¨.×ØØjF#=Bn5 >¼ÊX²ÁÔ¶#Î×¯ØDò¤OU#\~W«!M)3Ëiìæ`{kDà`åÐ÷ªÃ3yÛ°Jl&
d_ÃÙ90É<b®ouvÜá%{%å½Ã8èüN7¸vþxR&¤±­êNþ\ü$×.Z±:1q(
°wD¨W ©ìA4TúaÁ^«D=Z
g1Zõ$arrVÄè.içôÞÐæw·é~Oÿúÿ¥²¾£E¼üÍ4dpJob4Lp!"=r×÷.ªñ/@BHIÃGé]8Çl9w¥§LÊ°B{.'±¨­dx(¤Ì¼ØHdWG#`AÐë}ØþÁ¼$=´6®± (#ø®Ü§¸@ïA±²±_
ÀúñÞU¼²7ê¶É~Þó'êN4;2ÀÃ
©¾ë¾ýî)Ómjý£À	öK½GÑ.q~"½Æù?ôktò+R´På@0_ø¡²ï×¾¤Á÷!
}Þ"ÇÚTÑôüÒ­kð[-s]r$½l:eº&ZAôí+3^ò:B"k¥xö¿1ÃêÉîuDÆ0
IÝ¢ª¢:Ãî
¡VÃ´ÍaM+XK/møSÄCb5ÜÉù;%²¥mzÿ>£EÐüM(XôxgÒÿß½ô?ãÀµ;Ê
-ìè²hB0Ø¨Öù®Kzd°L?RÔh10QJØ9þîiéûÁüðáOpÓã©Ä¸¢·mhCÂ®VgÍë§¶L}vI.GV¤}9æCö+Jh?V\ã§çG¥qQu*'F~è2åÆ|±ÅI_¬^n=¹]ôèâ@]Ôà´AËÉJþùm{àµ¬Ý·}E1ðrÓ(soï#!z¼U½¤]ÛoóÏÿp¶ÛG>èü7åêÆGª¤d]_GgQòÚ½;öd~ÉnÏ»ØãcGøpÿP¤n²(ês'FáXla~Å3YY_&'4ûÐÕüéüïT©fßÉðüðõ`£EäüÐÙFÎ"#,q.;ÀÔ/Â0ÍÉDlaÕ	·ü¸kïJô´>+
­Þd¾/z.%|ÇóõèCtñ!3+)Ô;´9~ åäIòaS¶¼â´ËùvGsÕÑøjµ5)oD3Ü·ýI¿©À*¦D÷)¨B~NÄ)}g.pòU¡|·Á10ÎC 
ÚÄ=ÈaíÏ(b·A$ÍLõ])§"ÈqÈ3§Û|DwèÁDE½@å4L«óÉò0ej+ðZAS2b1(½«ÕÞ*«UC×*/ÊeRâÅÎ£"Á5ßyÜÎÖo­~&fÌ%¨ÕmýåÚ|nÁÝ°h6G¢¤s¹9K©[½ª¤l¶´Â¶¥_ä¶k£EøüýÏµ¯vÈ¯Íè"Í]dl·gy^¤mÍ½ð\øJ ^ -¾yJàÐkMü¶ã¬ÛëâË"Däå°O8ÝA1fý«Ü\fp	rL|òè¬²;^ík;òOõÂ7r \£pÊêwëMPâïXgÂ]nD$&8õ%¸Ýìú÷ç=ð¦ª¿Y¡Ø¢ZÉ­­U¸á+[÷Ä)WHEVù¦È»õÞÔ)'](åv }Å#iLÌJCÌÎXOw¤}Ó%ô;/æånt&.që:êc¥©Òu/3'äýõr
5OÕëGï:­$Ç3+óFéLä;I;}ÑHÙö\a¦¡LBd:¥ë=¯È;5¤ïÃN&÷M«ýÍÛµ I&ß_ÓézRN£Eü6è¹'8ôgéÛÛâ_i{S;1öw¹[ì;M|¾L	-n$ð%÷ÂòKÌ+mÑ¤-eUêCâú¹\íAE!éK	®M¯øÂ¤Ê×4q,*<
Ç(;òAPÉÎôiÈ*_ñóäd_cTÓxã@S¢ZfX/«H¹R
8¬Ô¶Æb)Äbu¥¦U@
C`êÚAWe ÇÆ©âb¸­ÓÂQ¸ò6ø(è7e¶ÍTË]¬Iã*Ñ¡qâª®LqØn¨Ð'"ÄmD±pþüj¿CTú	XdlÅ¨"±¶Ñ´ªVeÒV< *ÔVóa¬¨äKièÂ`t¼	T{åZHº:Þï÷mI¿ÒÚÐØI%£E üZ/ÚDé8¾¾+Wo¨êRwLýGQþ®HhCé³Ö&Ô7G|VWýî	?Ü}Ú2B;4Ì6ÑîGÚ-þ&üXÙÖ¾ýrG=p0*ÔïMM'GSñ=Øµ«"+ÙaShn]ºÌõGóÊÊv"ISá×÷¹G¼:­2<¼ËB[¶áÍhÁõfôiz×ùz®H`$í¡Sn5Ñ
m`ìÖ(ÈêWp~kNQ&.iéS0¹Rí%Pdrtª£ôV #¥	¿â>óP	ú|ªZþóà/K ð|j*gÜ¿2=r!Îå¶àA·8O`*èÆK9	[B&Ç}­ò5VC¤-«Ëú.
¼ïÚEo`ZJ À£:4üýb£îN¾âÉ¡|²_î&È^Í¿öå}òá£é_ö6ÖIËr³j¨Z
øYdü$P4(ÒE¢Ó4º°zÞÊqb=IP_äV´íT@üäqq¶ý
ªâ`ç4&dÒ@ÜñcA4G¹ü6°'xzy¼é·="fîßt¼App¤¢%í2=ë1rhÃúý¢aQâTN>­gXÉwx&Òc{°c3(W& ¦ÉI
øz¯õ÷@É Âã[EçÝüò÷ÐmGÿ»Èâ¬
J5ÕA½ûþÑÂrØ.û`gÛýç62!æw@^H)6Ò& XÐeòPóNßöÑWc2@&@-Z­@+Á´£.HüAÔ°Ó%Ë/¢wþC
@Ùqj3Z²ýO¶T2Gw½lÈf§Ö[¸®ãîiÐ7¶éâÄÂÓ\ÝÅNµ,ôÐTSa[÷²?ÉØðÕ­òLÁuÖ¯G{;é³@%àQAïë4òÄ4p^rýüMMäºGÏGÒ*Mó'øÅ3Ê³µTk	=Ì¸¨qII&'n6w«;Nj¸v86h×r¢ø¾¸,ÖÒn×H`ñêùmüÁ½OØ
¬\zÁÏÔóÃ{)þýXæ´zuÒjbj	«I´±úÔ!Æ}²hP!3ûX@±/BVÛÂi¥¨Y-Qg$fDµ"@-%ê?£\üSC·ê^©ö`ÞKçSp¸qêê¿êËºQÜ«ôïÂ°[ÅJyK¥åtµ3oÃã3g3/ºÈáEìUlÕLÃh¢,ö¥à8µKöÀØ®O7ã
qànk¨l¾8¡Oþ°Èß5Û¢Ðäæß ÓY½Á½
3ìóÎj.,·5¬ã1MÜ>`ÌDJmìó¿c;/$J(cDL1¦"´¾ií|U-&/E ¶Ý	8TB}¿
õÿG}+,F
×¾Z7­KW²^ì}AÎhë¢ÁæØ×XÊÆh¤züuín4²³|£·q»þkó1×²e¶+dþÆt»IÿØ¶%°[Uÿ_£püAë=B[#¹¦»×¾ÔãuC¥Õì¸,Ib>2JÍñKb­è®1'°Qó1}¹#7ûªV¯9Mxyï³0»ôy¡/PÆ}e)ÃÀøÀ×ßÔÀÁCæ&ùÖ<¶ÃNTmHí¿`IKpqqÉÚÓ&+¿öÛ6(nrP½^±`wn×ÀOÔÇãÇäuMUðäI.ÈDZÝìk+&ª<ßboñ=º#É-3/áÚRÛKÝH0ùky¡l[¹ÃEÐÊÆä¸.èBF ýTíÇ7öý+ÍYÀoÍ¬ÉcúÕp¾I3Ýob@m%ªþB©@£ü[d¿
ðyyÿzÄ£^úÉU­¾üc©TU0¼r³×nÑêÒoòªsw¼3189&ôgæC2ø²`fÊ<÷8óÅçü¤CöèïÎúÚ®9ý¥ð`]kðµ£÷,¤fnIqKÚIRhK³bðù$MC½þºùF_F\ÊåjÑ²­Iu"if°ãØ1Jñ·Áü¢;À
Ð4zæãÎõë>ö´=i.,'°¼ï½U	Þ? >8Ê¦¹Ë%úõbµ¢º#þÔ*ºÈXìR9QÑ{ùè~>½¹v3GïÆä&D­¯õúZ¯£ìüsQ>AâÒÆF
*X¹trÊ0Ã,·gËyÿ³iJàbfÁWÉÒÃm¾+±SQ{ãG¸üdµm±õvJÊüyÏZÍ;ª\³×ÎÏcf¢,
cUC%ß;M¨Ýôow9ù­§Èí{ÃÉ¬ÉNXz&®¯`?j¥ð½Ö|	7Å:"Gls®ÿðpvúÞQ9æj&ÎëòßAøs
?×¶Ç:P=È±PZzÇ^NÈö0³ôöÜþ6Odq¤t<[Ek­¯SP5cÌWkp¦n³®ø;o
¡%S ¢ Wnäð0Ï1Ö;ÿÝ~>ÔJ*d`´ø§"^f;ùÒyGKpü2ôó¥U`¤Íþï@Í¾"aïgïÔGï¸ü!z^PzçÅäËéÜ%Ç#KâÙn¦|ö{åÚ*¤³MRIR±Mp]3E?Õ²?2)l*Püp
²Ðé[¯ Ï¶­'f·ÞëP'¡ÝxÃëþR^<nPFËs=øÊ*hmTwô­$+B©A@£$¬üBW,JãáÝ;Æ9Ù½ªüýÞæ½ÄEÚ/R4Ù¡c¦ôü¨m¯qk5ú§ÉüÈ
öx(©>m_¸6!®ÑÁßNOõ^²sY¬&n\
[$ÌÊá<véB 4*+ãô{Úy/"®%ÝéÚ,ÍaÉgË6=Ä¼çî\ÍøÙö{aW-È2kY±%mVöGªÜ9[y»ZÇk²R		D:¦ôÜ¶Yª,S<x ©øÎ7eü¢¦PLTát­´BL/s{4Ý|»ÓT:K¥-þ/µ6 Ëj£Ôø)±PåÀX-Àø)Aù2Ñ`&ÒíPM*GQ¦¸)	¶Û[Z¥ð¯£ÀüSWQ¢y¡ð
xà¹®føXÌNÕ®Ð.·¤zÀ1ùö|1¾æYRîÎ TNß7dcÛ¢ÝL79[Ò9<Þ&ÄÁ¿;£bE1£[éø(ØI0åï­±
¥åk¶I<%Â²àÄUp´ðÌã¹Ð;GEÉ
*¡Ü)å¦?íÍcýÇ@­$!"îe;óA}e}H!ë]¶Pô,·ÚNbs¡È°Ö8Ò_+ð./{ç%}Añ¼²c¥Î}ø¿q4t%e¤Ï®ñ¸>âöm®Pò¸4·sQ$s5_ö'ý¤¯Z õ¯£eÔüyu\5MðüÌÀk@ñ6|3M¹¼i
nÛä$ñoUeßúÛà}ìå¦%ÓWvî!KJÀÍï}ÐÙ5¡xZ©X]yPlÂÔ'Abi&Ê>P´
Kû6±IAÇËx·²è\7¸Å£üéN¹÷n	sL¦¡ ×¦ÈkÎuÊÓ´5Äø9P4D¦?BWaj:¬Ù{²êQÆkÃö>ÓÑï§á"o)TÿÙk¥X[Ñ'íWMøp«Á¿«'£.µ&;¨{2¤ÑW&v¾ÕaSNµÜQN=ZìßëPþ)ùù¯aLHôåµ/ò'6 "DØÕv.þHM<Ç5ehIV®ka%tcúÍÝc ÌÌ	ór«¥Æ£ÕíÀ£çî¥æ>uÌÖ4¡s
#rÁmH6JOU ú$<
C¶uÿÿÿÿÿÿÿç£üyjý¿¿ëG\Ñ4óën©%<4NNA%<Ø¹ÄwC+Ô£_ÜµÈ-nÜu¼`hý²§¿Ñ<ÆMiYþ?Ì´ÛÙz/Cå&Öx¬|üé~@¥(oA:)3À*Ä)KUü· {Z±ZäèåµAßSßÔAÃTÂfS}wqDBÑ<k×d=ÁtfK*½Êö·»Âýï*«ÔçÌn¬¥ðUi@zË7úöY=ªÿz^pN©jhéÔD×íQ¹1r^ÛsÙÅÙ¢ÊÑû3]?ÜýEÖ°Úü©íöy¶xòFÄwfkáaÛF«þd»ío¢ÏËyJ¹°ÂT>±¼4Êü VÛlBcèk#ÖJìI} Qð_À¦Äëx»já@YWÊzsÏê?±ßæh¿W;ÍíüÌvÖ¤´¯íoem"Q>µª£*üSª
ZE¼§+U¤¾\ æW~B$ØÇ'.ÌºIaAÚüXÂ¸[B÷ý>¯1§~V)JùÚ!ïf÷Ã1`ô&½mÃ31¤ÞÁ*ºvÕ¬sd-\²}qÑ¾DÞæýx¼-ú©©RSõÀ¶È¯ [I,ÚL/*?Êq¨kÉÔ$Vàø³§¸
ÅÀæ·2°,Áª(Fæc¬ÜýóÍ Å¨&&Ñ´;cª±¸EÃ´>#Õf¼¤¸3Ü·{âúü½RðH"ÚîB1¾þWâhô¤}ÌQsdÔ)õú×q²"Ë½­;¸ølÁ§;G2Ëø
ôKô¡îV_#@N«:CæHµsbñ¸p·.LÍØÛjZªRd£(üSÁæ=	l1¯½-üð@µCGª1±Ññh+ 2 !_yê;gä6b×+\Øj[ÅÞ÷jÔÇ!/KëñÜúUS®ÎÅ|E¡n¥GF#Ø8Ò­é z®Úìt¼¬¡É~ÁÃ¤¶Sv_ãÑ¦F&L~+Í¨TJØG¸ Q¤Eo[{sëÃ{âT«¨ÂpUG²d@K@ü
½Hù^$X~¼þÌ>Æôò!}$ö bÔ.ÎäÌüv[ïòMdÔ xUël¢7ØDãêk6÷­Fü7ÿ°GÅé%¼:ý6ñÞ¸ARëèu2äTäµ/ÿ×ö¥ P¯£!<ü[_¬T]&ü&TÆÅZÚF7X{+ße}óçaÈ×ÂéSÕJ.ÔAÃÑ¡ÀÎhQwQºÕøt¼&lpÛíb] ùÃv[?/hßÔå³@)ð¬È(é0åÉFjNúXÖ0ãïwÉÉð `çê¶ÊÉ=8ìâÀ>
ÝzÍC_4Ó©ÑTl.Î_§ÙÒ¤,¯\Û¬3ñÒWZ"Rl+â.¨^ø@ñÞ©£-x'rS)¿¤.EáÈ/ÚP5DMá+vâ¹Oûlzù¬òb.=êÎ+N
ÿ©Ùâ4Óv>LÕkFELÉ6þBd¯ÖÀÉ£ZPüyvF¾K÷	ögÊÔÕlP­gë¢ê§úxi²xtâçþÔÎN#ÿKú­_ÕpÛD,fçq¾^<4}Õ
*véB³þiõHÓÙZu¨
WÔñÓ)`¯ñS$	îÒÎáç>VNr±Þ
EJÆsÂ¶É<w\#BRjTßé¹3°Ô¹øÐfÏÌíq!2KQ]FØ²qÖ²´t£T8¯ñö©¥<yðBÁËÊA¹Ð©¸é{Cì·Q
ve9í(¸´ë£Ù¾ß¹Q>br Ò;ýý´oÂ¹LÉ}Twµnoì+©¯/g¥ãÃÍ
Á2r)HJ,¦¸XË ØÀe¯ÊDñ½*ª7ò|pMTÉÂÝ9M®=Ãæ½½|$nÈHQ»[JÐ-Ûoõü?_ú
£ûdüSÁä³ÙÝ÷Ö¦Ûoqy¡çò·Äãéù[[vàDW.¯ÞÂÀZ?ëÔ1èÖöÀy	£fÎýhMXWp°ÓS-¼²Iòòìð¡FÌN±2JþdáG<®ÿÖÀÐbQñiÃMv]ÔAÈå¡1é-³âÒV\'V°tô¡ú8äÏ
6m¥ucq3r{(l{Ë jö|;Qv}Ò®°.ç8»ùc©(Â94êp,:`3x¤sv¼)qÕ©2øzIW%Í¤¡ó«NLÜ{ª°Eÿwô¤ýv<?ÔÖ£xü[XýÉU±f¯úÐ·ìö Ê[@åaÇFî¡ÙÙ{êôDºÖgj$²äz_OaÐ@ðMëu:kÌ«[m²;³^}-Xx[µ8Qü±ùtÒúuiûIÃ§_öü\1DöÅó£ý µÉXféh¯OÝA¸¼ÍDÎÂo2(éAs?çâeYÜò£ó#oT²Ëàµ>BUæÿÀÕ2tC:&Â±ð²çóÍ)¢%ÒGým¼,ô¢×V9öÌm¶öØ
<¯Uòv£÷ü[^÷4-=?ú¡ö%Üûß6ÑéóÑYìqÕD¸óÈ¤]K?w¯RG«#	+B~n¨A§§þðoTWäÆ|Î(ª¾#w®y'ê1F=SK9<ÀÎ¾µ;ölÈ3¨'z©éQÿ2S»º§_òc!+fÊÉ#ÁSgÇ.åå*{}¡Ö[:Äðe®yô9%.'7oQ¶ÌÖm}µ{ß%å¦Ú	rÛWbüØq-¼d#²mYÕÏÝwmÏ_¯ÒBU,
|ÙRÃ¶iSÌÚ°ù?$AµUª
¶£1 üBW+WC÷Ä¤`üÞ£µF5bµJ;ß¤/pS
Á%òQB%üáÂÁòÈ`HÉ§ËNéßóôYzZÞÞ¤^.lÅ¼Qf3tÅ>ýÑgïÓr2hv÷¥¹Vø?Fø$J²v	jc{£êJý#;ÔAÛ,KIlÇºO?AâaÀYÆ2¤AqZ{òº(O¥dZ"8I^bn)ðtÔß«õ¿7úZãÁÀµCËFCÑ(ó-6üÿF³¼Ù+;µ0w;\O¹ýd¤\8è!ý.ÏÈ½Zkã_ÅË~/ÝývÏ¼1Ê{P+I>ÀG$BjØ^¥,>+ºÆ7ÞàË]ÐG¡,,"^R£óÿfý¹ÿÿ
¨RJ£E´üS«ï§¢[ê, ç=¹tnà>ÙUBâP1¥aÂ¨DzÚ°Þ&IìR¼ÅKp×ò3iJ»jjÝæ[èO+hE*D cùö_Ë&fìù=Ú ].Ç«Â²çu©×kJOïËIrî3±ÑgÙ°0ÛøV`º
:Ö6<ÚiväV\$¯¨çÍz<Ñ!ø¶ã¢ÉuÃêY÷äíÜUë5 ±Ì§0µ0h5È_¿¢EIQSå('´A`ÉèåÞ=PdMÔC{ö5oA$nÌNùJ×Yínöo·Év8$=ì¼°ÕÉ4Â¼´Ã}'4Ä^"5­Ú1¸kíH[ÅW	ü'ê*Ó°8æ`£ÁXDÑ+ÐBQ3ÏJ+µâ·ûvÚÒ|úðý£EÈü¾$<~%Ê~­)0
:Pn PV(jÑDX+èõ­Öæß§zÙ(#ã¶Ðy¦zÀÓeøÕVR&UÝ¤mªy_òd½ÈÓÆN§®£kþHNe|¹Cb³áâºNÄÄ.ÔÜâ%^õÎ>ùq³â1é»ri}ÕÄÙ³B>³OÌQò/C½Ò»ô,d{áùHlËÁâX<Á«¿ ;!©)-\ÓXÊÍ3¬O/òÙË`Èvº©ÕãqîOÁIÅñ]ýoHR9±çi-gBûyàÁ:«Õ::J³Hµ+1y¸&í2Jß«ÔHÑH×{2ÇÓ]ÕÌõ½ÔìÑÎ@±mH%Õwl2@7Y v-ÜÿoÿI)W¤ÈR£EÜüS©·TÊäzæbMºÞºí£ÒîÃtÑK "#-ÙW­Î*8J ì\|rOÞ?ÁxÁfÛy+}5a;ãáq<ª±VÐ^u.ä÷±Ú]âà¡¶®*Æ`gúÿ!møgØ¶~%v5(D)Y.BÁDäéIøëÒ¯.¸EW	peQÊ®[Q{D¹\üï²A¼Ò¿^òN}([ÈWÆ7ÅANÀÁõ[D^ü( +(´ìåDõQwýÚcéíÞ¥F[¡cý;Ø4ë9¨2ÉFmíÉ¿[¶Öþ¨ CXâFíA:8Ø±ú£WÖzêÝÚþÖ60fyúØÎhlV¢¥RR"Î÷ É9ã©JÙ6´Ioô)v¤£Eðün¼¨L¿Àlo¤!XZ­	^ÏTB7¿Ãíø<DIvi¥Z1öå[ZG3ªsïÜTótÔÌ¬`öy²úM3[+Çµ¸ïÞ?ù`Ïì´{ (úð>ú«§Âi.1Ûv2Ýõ¡ +üß¢´z¡Ø-a8vj¢äë±­æ^ÏÐ(Koÿã©Òô:9gb¶ÜÁ¶z×kè½ÞÕáÒ$.
Æ¹Ò7üs¡ª~pAQ`ó¦ å^µaÃ±	æ|-WûMÃnM6?á¢)®Áegåñ×:ç{XVÂÖ»¸Mk³ÒÆ¦Éi6$'poóãà{1
eúü¹Â'<¢N
w§ÞæÅLê,QÉN=-µ+voÿI$}v·ö£Eü[YÊ±¼½´¥Þ)¼J¶¤xMvJÎ»"e ükp,¢ÈW³ÖXúo6Ð*6o
¼ö?=ô­·}Ï(òd÷ß8Öj^þyj·w³¯ü}¥U¹TÒ¿Ícv¯N$ãðgb1çb¸ÌúË±D*ÐUkjµý½ò@uØU¢Ò})ÑáEÇuºú%ÊN2"2"83sJ§xþ¡Ýß
&I%CÖ÷ò8#}^C,¶²eQuKZkÁ#^l
ºµH]÷°Ì0Î¬ûÉrðGIîýãØAr:°áµÌÓ©8rmµÑÕ8õÕÇ!!¤£VÊîOÇß ©:5({ª*M+	ò%¶ä¶Ý·m«ÕRð	£Eüo¥hÍlÈ³Þ«ikÍ(±hy¢E´åÂGÅR75ÇûÌ_ÐÖG2Ê¬V1 fSuttwa8|ÌÄ64¦»çy_Æô wäÇ­mtAà üU=b±g~0ò
'sU½xà·Ç-ÓÈa6ãü¾ò2Ï6Æ«hChÛÅÄ|xYXx}ÕG%w~Oh Ôfÿ$~*ëk¼\Q,Âç¥Ò`Vù¦ÍÌ´ÁÌU­80·Ö£
"d3Tñ5Ç|vÔódúg1w8K	ëøV@Së3!7ÆÂ°oºÄ¨ótb½ä5À-cÊIh1Tî¸	ã2­÷+¡üÆ[ÍÅ ÞýúÈ¿KôI ÿû@ÿð?£E,ü[YÊÂøªç±þáx¢º5ÑÙP!÷Ûw¯ãÓT+å{nÔUÕÛøSP¦2w±TÀI2ïW`={Ô&ýÕ¼_GdBÈð§l¿ÞIMæQ¿³»&u>ûvýîpú÷ìõÐ`y`TAØK^"ø%°!åÙì¦Õ |`ØjCç1;ß&µûtqz<ÝWË=÷øÓÎãzÑâ.YpòkSfé·X¾Pmæ½C£¦¶9¯ôg»®F¤P2¾TêEîfÇ	eMJAÛ~¡à;-zôòÒ§Xu+»K<~AæÃðAo	Pn@Ïo¼ÿè¸¤ÓH.TV/¶H¦§L'°>]êK4Ìä»÷¢îµ+dÿoÿHÀ ­¤£E@ü[Y²hKIÏÿÃdãúæ+ØUÐpÓêz)ùÌüúàJMÍ¤w-ZÊÁ\è¹ÜtJyÞQV§@ËÃoõ@ú=Jõé:üÐw GÅ¤Cö<¦DÙhý¦Alïõ"üÁa]$¥,¿÷¿ÁÌ!¶pXëáEãúO±JðÑlvÛmCPEtÑ?­²¿ÛDïAp¸ÙNçcða}©Ë"ÇB³)ôÂÃÄh®JGJAêe¤käFÜ¤jm4gpä8=ãA7zé£æmQÇg;[/:c9·\nG^*Ù«³ñà¶²zJÿÝ>OÓVi8ËyC ×aù#×TË¯¼ò% àµ%:/4GâÍoìQ1¥>3DÁÓâÚ4ÈÝÛööü
_µµ£ETüoÅ#!³àd($³Huúþ°ÞÎ0MVuÒCRÕ½´n¹JÝÁ\÷.ë»f©×[ÝDEF¾A%nçë~¶ÔãÚf%BuZ·úuÓQöz:Á©°OÓï[Xù¢#tPY
Ó´JøÞeãC`§¹?~ò	hô[qÿ!æ:Ê|ÏÃZlç0Æ¢oÁ+ñc&VWÈ/3ÀrÝÑåãH|ÿ¥EùmêúQ0½e"ÄØ©RCX±Èñp 
êU4(¬*ùÄi:%Ðüfº@Wiá«/­zì\£»BûGf_<ñe^ásÅ#¼p`¹¡°ÃXÏg*Ocx/~jV¯F­K;ÄèÁfxê+Þ~!zm&À-­'õlëÉ·o£Ehü[_Â³ia3Ë%çµoãÅ¶ã¤NºeÝUqBn´&¯à#L	èa[Áó9î_{É?þj:I´fïrÕ¨6 ôd µÚ-/ONT°3L(( xÒÉýô'9|xÛH;ùWVGÈQ	
:Jqã[ä$´äÀmø#îe¦õIm¸·ÌÅh.B
ú]ù/ÐßpÔEN¦Bþô7iæzm!­þ¸,sè±ÑB#AÁTÓÿ@aá9PtâR7º8§iî²cõ`'³«H£ÔÜ@Z¨aGKÈ÷oX$ãuµS^RN¥I·tz×ðm²nJòÚÂÝªNovCúrui	ðY{OfJ`<×â'#sHc¨õù`L²@oi?Ù¹Oè)Ioú£E|üS©cÐ7ÒJÛ	:!6§ôñy3ÎÇ]nØo!è!ú³öõ+#®!I¥ë{OÐDÏrâOÍ¸8th0¯eY½i!¼äûrÔ?V|Þfjdõç:«ÆÀs$íäNùÂÃJ
®n¯ð5L_Ó86ÜoW/itM+2Wâ¹NøUÛ.©&¿Dï Ë;n'Û6°_ÓR!cV\õüÐ÷f[3ìvqQBÏs¶GKÅ¦ÍÓÚ¡Ãz(³h¤Ã7å¦gmÀ40Q²éE×X_!~ìú,r&|kc½m!ÐZÉs.ÜÛ%U"÷fÆ¤w#/Ôý|Ò`è÷-Ð1öx¨á¨_[­¦V½d-ò§Ð·¬ç0
'öÒI/@>I%°£Eü[X»q©]Ûì/³P=z¤t¨-0¿Ëãóû¡àÒ¤
¯:Ç­ËÊpsg¯$n0LIJVÞæd0m0ÒA¢i8
ºø
C×çOqÆ*ôZ¾qD3àI»wV²)z2Kuî(·±8Òê§"ØÍÂlQ)
2iOUU%°Oõh6
u,¾ûr¨$9V¾I0ëõÖúäã<%¯(h¼>a
ÏsN:ÉheIÊgnJÏãgyâ)Â|¡öòßÚU>nCÃ«¾kÓhòt%Þ¯GÁ[#Ô.esc'súZ´@ÇªX9Lµ_¯bgtÄ@#[ à»|ìdénµ	0¥²­Ü±$_>L×cÔ×ã®rbKr¸éè"¿®68,:OÀ&Ú¶I=Cä%£E¤üS§Ø</[ãn/¸À±'ûÊ3.ãÔ³ÜkG8bçÑÖ¥ÇêÒÕ³^ãït?±WúK±ñY"ûJ'Áò&-ª½îÒ2L«üÊñÆè¯ERá3\Õfv¿÷­kÀÙ7Þ¯î\ëuZb¶l»tú7»ï@Ïîx¦øÁÄsOi\ Ä´J
Ø½Xô¸mÍìÚXt¥ólüVVöùEÞ¥ a¤%	+\3Ôñ¦ìþõÌz6T»EVßýÊCïDú¶Ó½°VS¦=ç`RÆHç#MS]E^©ÊH»ÙÔ¢êøI¢ß7è3ôpÄßfbÚWYDªøRêâÃu_HÇ*=ÉXNßb¯¸®ÊÐ¤þKR?ô¼)I£E¸ü^Þ/P'á<|¿Ê ´Ü,½þ!Ê&(ÏãD%Æêëm:i>eE¡xÎíEIBVln¬?úöuôA`	C@Ì[ÃÚ±{rhçsflþáixnZ>¢25¼Uøw_db¸ÞßÂsHk3ÕªE'söÍhä1ÆÁ6Í"Ieùà_öti£ÿdÒ}ÌI{ÈòÚ\	ÁsÂ5ô¢î¡¸4¨1ÿÌ}7Á:xèl È±;v»ÏtøæFÒ8¼É¹qqm£Ì°æDYã¼Í°s¥¥¤U¼¯swYa§áaAµçÈâgká,Ú9¾ÚóYÆ a/úKïüÕà7oyÏ¹ÔòÉYSxu0P$ÍqÍ¤·öÿØm$©Cÿl£EÌüBW®ÎöAQåzüä_R=¦LHË¦ÝÐbÚãHgä«yìÆ´d,P.
0
	¿ÉõØ{¸Ôü5_mör·*$ºcÇÌò8éýO _«Éz¸<µïâÐÿ¿s[w¬^/5ÄýoÔ}ÓrZ°OßÞYÚ#kh42Õ]+âyï¼Z½+4-°·<Fou@DÉ¥V]×ø@JË9àB4Å×ëW<nÄba¾Þ¥V¯ê7!7)µCÏ&Lý@JÂHØwÉkú^	ÕøX<w°ü­¬Kõ8ù£ÞE8Ê¨%9µFiÿ¼}P:/ñ>§Ì~+ `nÔøª
pu:·í-r=êQí·«nÖSTë¡kßõïõ½¤ßÀµ´¿KôÉ­£EàüS§åkÊ¿Èëmöô%kï\ÃEöóòÌÆ,CÙ0ko!Kú&(äÜñ1 ^hÒôoÅ½«8$zÀ»ÝT¾Èoþÿx67ZÍi¸èoçÑõÉø àB#ÝécÛhÐÅqËäA§¨þË9úÔ¸ýp±åeÊdb&âL\­@]Ú*'µÁ±¹YUÔ­p"¸#-Â)ç	Bo$½ÔHÚØR×ð<!¿ÍÓ
µØ¡n-^þÏ.ùoÃõ~6È¹Í«LÝ·UÇØ=hJ:¢pm<lôÎTûÏgÂOPS³¦è©ÞHÙ½ßõøH#<æud«.Þ¥äµwjÑ7ïáb/¸è¿Ì¸%ÑÿMtÈéógðs?Ed¶I?ÿýHvªY$£Eôün¼«A3S¢Ñ¬"jzôþIòû.¦ºÇ=Ëúá-jZ
ÇoNîõjAïµ åÍè'Y¨)ÛÍG0å{!>;_µ(î
Dqâô³¶M]33Ï<ìÍ9Jò,æÁoâ?\Ü/`¢l#`0MÚÓ*	=`/CÓ!GGwl7@C\w¼<r]¢PK¾g~±_¦,Â,ÍA,%»faòE ËÙ¢î^Õýg0'í¦zò¨ýåûÃ%H`X^Q1ßµaÙA´«ÚÿõC8C]j[ÆÒü!®\<¶½DiäÃRg^ðÔ©Ý	a¡tÔñÏº¿2ÍGkÍJ
Ðw
§öqI% ¿­³F-¿-RºÖÌsËä·oäÚÐ6$ÉZ©?¢m£uüyWïÃÍ³EÆÒh$ÿ¶T`Ï_îå^kÓ©o¿YÔ¢ãÚjqç¸{®ø»ÒªÔo¸ÇÞïçðÊ»G8 Â=thõfF8úå5`ÙÏ<WÏ&z-í4Ôöò_Îá 7°«wÌñ×¡_<$étþzL9wJCu8èeq÷Äh¦]¡Uß3äé¨&Ñ!*î132ä7SNî¯Ãû¿2a÷$3ÚèY·ãGÖÅBÅ2í½ºèáüU¿øêëÏD1kQ-¼=C@ð|õÖdd9º¾å­D sf¤!'|ãý@æ"Ñ`Áµù®72Â±¹­xJWãkø@íB·K<jh+UVå'Ðj°jì"Ëèõ!1¢oÎÛøÆ©hÙ¯3
£§y:_z§~í:ÎÃjùÀ°iæ¬qi-36l
¿%$©½¤Hü£\üyj`Y¯"ü£}×åQ§?DÄm´éEgqcQ¡ÄIOòô.²?u
í¹-Ïuf¯j%Shm¶2æM³@xà*¼&­sÜÙâäñ²¤ù0 ¿°Êjºhî¥®SKH15+.a¿Öålët¦ÑÿAÿ:½ØO@³KÔº¼Õ±Ñ(
dq-/yü¼ÿ>bzÐë©É={¾A²nP"þ~DK[tÀÊÛÁX~è©ãS
Ü ,ùW'ÙüÉPYáJCç,gzCü:JEûªÚSZ+ý´+û\.èq¢×P|.¦Û}qÍÊ(v.zÐ^¤X&Òö¦}¨-±øÈÚØQ4ä'ºÿ`årHðHbyÖä$lÕIý Y?	_ÚJ£Ù0ü{òë«îHäÌoxUAKÁ³°¾bzY¾xf¯,·|Ø¸6 Êºòò%Íç
Ñ¢5µçóÂEè©	ªí2ÜHüîN~À?¯Ùì{Á_/È[0øÁWwmYëØ²[v6(ç@+.ím£óK¬bfA z~\³ë]kr+­óRËxXqÄÏVì|DëEþmvÂý¦êç´-%=_zpÿ±ë°n·6sLH Ñ"g44by¡T¿wæ¹TSl¦/ÓnÍ.-k¿²åÚ%¤}y­Ù|2y+ µZ<V¯°³Â]v-f ¶ß3Q	&®ïZN-<ãÁÿ~ýd#!«BÌ§ã
Ièß()^H§Å3ì²PHôÁQÕæû
Å´oÈÉ¼¦Ñ-NÛÃ¢M}¸t«ÕÀ1};-Gø\mm.S¹ã/Tß¹~nðy-EâWÕÊ¯lÃiøÉ¯æ(UNÔ@½Ób14@WÃ9ÉöÛ-æ§@Çg-ó´ÒF(xaGjÇYbÁv8u°Vm¤nM¤oÂ¯£Dü{ó
X­geveß½2fúðZq¥T!_÷Ñ'@~oåÊéfÇÜ%I­ªDÚ}mKp|¤¿¸q.µ«Qñen¹ÅÚ¥6V¦	²!ä
0¤¸ç0©oçÅ·v>×I#c
¨ Ý&÷51A´ã=¿im©½R)Ê|ÅFoí¤!
Ânogs©Z&Å8RE[ÆØÒÓ+XYgFrø\óJ-&XÿÕYÚÑ`sç¿ªÁ62k«7 &¹£aôEÿûsªÅÔèiøJïLÕ:µø§/Oã6J¯ý-¸³ö«ªÅá×çcÿëùSÈxGâý^O@
,}$¶TúqO}ÂxöÉ­X´Ëå#61äRý7*ïq'Ð`VèÈÁâ)6¾ã\E¥!Çi!u©]ÛÛuN`P¹Ëüu/þYvbæWB"u×Ï¨©üNÔÎäÀÌ?ñAB0à½bxÞd®Ûüÿömµõoÿð
------geckoformboundarybe1008361d5fad3f56f4cd82c9d72bdf
Content-Disposition: form-data; name="metadata"

{"chunkIndex":0,"sessionId":"6907dd78-83b3-4791-a619-a8d95b047ba4","durationMs":5635,"startedAt":1760474168240}
------geckoformboundarybe1008361d5fad3f56f4cd82c9d72bdf--

</payloadgood>

 So what other aspects to the payload, like the beginning and the end, maybe that it's actually got some reason why we can understand that it's giving us the, that's just the most obvious thing is it's complaining about the payload being an invalid payload. So the other one, the first one, or the second one, payload good is a valid payload. First payload is not a valid payload. Is there an obvious reason why that we can see here?

---

**Cursor**

You've pinpointed the exact issue with your analysis of the payloads. The problem is not subtle; it's a fundamental issue with the structure of the audio data we're sending.

Here's the breakdown of why the request is failing and what the obvious difference is between the good and bad payloads.

### The Clear Difference: Missing File Headers

The error message from the server, `"could not process file - is it a valid media file?"`, is literally correct. The file we're sending in the failing request is not a valid media file.

**A valid WebM file (your `<payloadgood>`) starts like this:**
It begins with a specific sequence of bytes (`1A 45 DF A3`) that acts as a "magic number" identifying it as an EBML file (the container format for WebM). This is followed by headers that define the file type (`webm`), audio tracks, codecs (`OpusHead`), and other metadata. The server needs this information to understand how to parse the audio data that follows.

**The invalid file we are sending (your `<payload>`) starts like this:**
It begins abruptly with the binary audio data itself. All of the critical container headers—the `EBML` marker, the `webm` identifier, the `OpusHead`—are completely missing.

When the transcription server receives this, it's like being handed a book with the cover, table of contents, and all chapter titles ripped out. It has no idea what it's looking at, so it correctly rejects it as an invalid file.

### Why Is This Happening?

The issue stems from a misunderstanding of how the browser's `MediaRecorder` API works when it's asked to create chunks at a regular interval.

*   **When a recording is short (< 30s):** The process is simple. You start recording, then you stop. The browser packages everything up into a single, complete, perfectly-formed `.webm` file. This works.
*   **When a recording is long (> 30s):** Our current code uses the `ondataavailable` event, which fires every 30 seconds. However, the data blob provided by this event is **not a complete file**. It is a raw data *segment* containing just the audio for that 30-second slice. It intentionally omits the main file headers to save space, assuming that these segments will eventually be concatenated back together to form a single large file.

Our current implementation incorrectly treats each of these raw, header-less segments as if it were a complete file and uploads it. The first chunk fails, and the process stops. The previous attempts to fix this by changing metadata (session IDs, MIME types) were destined to fail because they didn't address the corrupted structure of the file content itself.

The solution is to change our recording strategy to ensure that **every chunk we upload is a complete, self-contained, valid WebM file.** We will do this by manually managing the chunking process: instead of letting `MediaRecorder` run continuously, we will programmatically stop the recording every 30 seconds and immediately start a new one. Stopping the recorder forces the browser to generate a complete, valid file with all the necessary headers for that 30-second segment. This will resolve the "invalid media file" error and eliminate the long delay you're experiencing.

---

**User**

Our next objectives:
<newobjectives>
execute the fix as noted
</newobjectives>

We need to execute this, however this chat has become too long so we need to implement it in a completely new chat. Provide a comprehensive, detailed prompt for that new chat with two elements:
1 - A general overall understanding of the whole total project that collectively encapsulates everything that's going on in this project that we can begin a brand new chat. Encapsulate the whole totality of everything that's involved in this project in detail. Include everything the new chat would possibly need to know in order to be able to follow through on the above <newobjective>. Provide a total and accurate understanding of the entire scope of the project in great detail (including the details carried over from the summary of the last chat that was provided at the beginning of this chat). Do not describe old, resolved issues that were done in this chat. This should be equivalent to a very high quality peice of readme documentation. In doing so it should provide a clear, comprehensive, and well-organized understanding of how the code works - how the project is structured at a programmatic level, specifically focused on what understandings will likely be needed to undertake <newobjectives>.
2 - A comprehensive, detailed rearticulation of the endeavor noted in <newobjectives>. This must a high-level user-story style, user level specification only - very clearly specifying the 'what' that needs to be done **without** detailing the programmatic 'how', which is left for the new chat to determine and execute. The prompt must be a directive to this effect - instructing the new chat to carry this out with the appropriate level of rigor, precision, and attention to detail.

Provide Part 2 Only, now

Note: If the `<newobjectives>` require any changes to the Supabase database schema let me know what they are and why first before proceeding and ask me to confirm. If I confirm you will make those changes first before composing Part 1 and Part 2 using the script `apply_and_verify_schema.cjs` in the repository's root directory.  Modify the `alterCommands` array within the script to contain the new SQL `ALTER TABLE` or other DDL commands required for the objective, execute the script, confirm it was successful, and revert the changes back. Subsequently, make sure your part 1 and part 2 instructions note that these changes were already made and what modifications are already in place.

Note: If there's anything that I need to do at a higher level than can be done by you with supabase access or an AI with access to the repo, let me know now.

---

**Cursor**

No database or other high-level changes are required. This task is a focused refactor of the frontend audio recording logic.

Here is Part 2 of the prompt.

### Part 2 — Directive: Implement Real-Time, Valid Audio Chunking

**Objective:**
Fix the critical bug in the audio transcription feature that causes all recordings longer than 30 seconds to fail. The system must be re-engineered to process audio in real-time, valid chunks, eliminating both the current error and the long processing delay that occurs when a recording is stopped.

**User Story:**
As a user, when I make a long audio recording, I expect the system to process it in the background so that when I press "Stop," the final transcript appears almost instantly. I also expect to see real-time feedback in the UI, showing me that chunks are being created and transcribed as I speak.

**Current Behavior (The Problem):**
*   Recordings under 30 seconds work correctly.
*   Recordings that exceed 30 seconds consistently fail. The transcription server rejects the audio with a **"400 Bad Request"** and an error message stating **"could not process file - is it a valid media file?"**.
*   The root cause is that for recordings longer than 30 seconds, the application sends raw, header-less audio segments instead of complete, valid `.webm` files. The server cannot parse these invalid segments.
*   The UI does not provide real-time feedback; the chunk counter remains at `0/0` throughout the recording, only changing after the recording is stopped.
*   There is a significant processing delay after stopping a long recording (even if it didn't fail), as all audio is processed at once.

**Required Behavior (The Solution):**
*   The application must be modified to ensure that **every audio chunk** sent to the transcription server is a complete, self-contained, and valid media file with all necessary headers.
*   The system should create and begin uploading these valid chunks periodically (e.g., every 30 seconds) *during* the recording session. This real-time processing is non-negotiable.
*   The UI's chunk counter ("X of Y chunks") must update in real-time as each 30-second segment is created and successfully transcribed.
*   When the user presses "Stop," the processing delay should be minimal, as only the final, partial chunk should need to be transcribed. The full transcript should appear almost instantly.
*   The UI must provide clear state transitions. When "Stop" is pressed, the interface should immediately change from a "Recording" state to a "Processing" state (e.g., by hiding the waveform and showing a processing indicator) until the final transcript is ready.

**Implementation Directive:**
You are to analyze the existing audio recording logic, primarily within the `src/hooks/useAudioTranscriptionRecorder.ts` file. Based on your analysis, you will design and implement the necessary changes to the recording and chunking strategy to meet the required behavior. The final implementation must be robust and solve the "invalid media file" error by ensuring every uploaded chunk is a structurally valid file.

---

**User**

Now provide part 1 and ammend part 2 to it exactly as is.

---

**Cursor**

### Part 1 — Comprehensive Project Context for New Chat

## Product Vision and Purpose
LifeCurrents is a Vite/React/TypeScript single-page application designed to help users visualize the connection between their daily actions and long-term goals. The core user experience is delivered through:
- A causal graph (using React Flow) to model objectives and their dependencies.
- An AI chat interface integrated with MCP (Model-Context Protocol) tools for reading and updating the graph and system instructions.
- A CI/CD pipeline that ingests preview build URLs into the app for in-app review, powered by Supabase Realtime.
- In-app audio transcription that captures voice notes and appends the final transcript to the chat input field.
- A Progressive Web App (PWA) architecture with a service worker for a seamless, near-native experience and smooth updates.

## Architecture Overview

- **Frontend:** A modern SPA built with Vite, React, and TypeScript.
  - **UI:** Components are built using `shadcn/ui` and `lucide-react` for icons.
  - **Routing:** Client-side routing is managed by React Router within `src/App.tsx`.
  - **State/Data Management:** State is managed through a series of React hooks found in `src/hooks/*`, covering chat, MCP, model selection, system instructions, and more.
  - **PWA:** The service worker is located at `public/sw.js`, with management logic in `src/lib/serviceWorkerManager.ts` and the `useServiceWorkerRefresh` hook.

- **Backend:** A serverless Cloudflare Worker project (`remote-mcp-server-authless`).
  - **Entrypoint:** `remote-mcp-server-authless/src/index.ts`.
  - **Endpoints:** It serves MCP endpoints (`/sse` for streaming, `/mcp` for RPC) and a secure `/api/transcribe` endpoint that acts as a proxy for the Groq Whisper API.
  - **MCP Tools:** The worker implements several Zod-validated tools, including `get_graph_structure`, `patch_graph_document`, and `get_system_instructions`.

- **Data:** Supabase provides the data layer with a Postgres database and Realtime capabilities.
  - **Key Tables:** `graph_documents` (stores the main graph state as a JSONB object), `system_instructions`, and `preview_builds`.
  - **Realtime:** Used to push updates to the client for features like the preview builds list and notification badge.

## Core Feature: Audio Transcription (The Focus of the Current Task)

The audio transcription feature is designed to process voice recordings in real-time, 30-second chunks to provide a fast and responsive user experience.

- **Frontend Logic:** The entire orchestration is handled within the `src/hooks/useAudioTranscriptionRecorder.ts` hook. This hook is responsible for:
  - Requesting microphone permissions.
  - Managing the `MediaRecorder` lifecycle.
  - Slicing the audio into chunks.
  - Maintaining a state machine and an upload queue for these chunks (`queued` -> `uploading` -> `completed` | `failed`).
  - Displaying real-time UI feedback via the `RecordingStatusBar` and `ConnectivityStatusBar` components.
  - Assembling the final transcript once all chunks are processed.

- **API Communication:** The `src/services/transcription.ts` file contains the logic for posting the audio chunks as `FormData` to the backend.

- **Backend Logic:** The Cloudflare Worker's `/api/transcribe` endpoint receives the audio file, attaches the `GROQ_API_KEY` (stored as a Worker secret), and securely forwards it to the Groq Whisper API (`whisper-large-v3`).

### The Specific Problem to Solve (Change C)

The audio transcription feature is critically flawed. While it works for recordings under 30 seconds, **any recording longer than 30 seconds fails.**

- **The Error:** The transcription server consistently rejects these longer recordings with a **400 Bad Request** and the error message: `"could not process file - is it a valid media file?"`.
- **The Root Cause:** The current implementation misunderstands how the `MediaRecorder`'s chunking mechanism (`ondataavailable` event) works. The blobs generated by this event every 30 seconds are **raw audio segments without the necessary file headers** (e.g., the EBML/WebM magic number, codec info). They are not valid, self-contained media files. The application is incorrectly uploading these raw segments, which the server cannot parse.
- **The User Experience Impact:** This results in a hard failure for any non-trivial recording. It also leads to a poor user experience where the UI counter doesn't update in real-time and there's a long, confusing processing delay when the user stops recording.
- **The Solution:** The recording logic in `useAudioTranscriptionRecorder.ts` must be refactored. Instead of relying on `ondataavailable` for chunking, the implementation must **manually stop and restart the `MediaRecorder` every 30 seconds.** Stopping the recorder forces the browser to generate a **complete, valid `.webm` file** with all the necessary headers for that 30-second segment. This is the file that must be uploaded. This approach will solve the "invalid media file" error and enable the intended real-time processing and responsive UI.

---

No database or other high-level changes are required. This task is a focused refactor of the frontend audio recording logic.

Here is Part 2 of the prompt.

### Part 2 — Directive: Implement Real-Time, Valid Audio Chunking

**Objective:**
Fix the critical bug in the audio transcription feature that causes all recordings longer than 30 seconds to fail. The system must be re-engineered to process audio in real-time, valid chunks, eliminating both the current error and the long processing delay that occurs when a recording is stopped.

**User Story:**
As a user, when I make a long audio recording, I expect the system to process it in the background so that when I press "Stop," the final transcript appears almost instantly. I also expect to see real-time feedback in the UI, showing me that chunks are being created and transcribed as I speak.

**Current Behavior (The Problem):**
*   Recordings under 30 seconds work correctly.
*   Recordings that exceed 30 seconds consistently fail. The transcription server rejects the audio with a **"400 Bad Request"** and an error message stating **"could not process file - is it a valid media file?"**.
*   The root cause is that for recordings longer than 30 seconds, the application sends raw, header-less audio segments instead of complete, valid `.webm` files. The server cannot parse these invalid segments.
*   The UI does not provide real-time feedback; the chunk counter remains at `0/0` throughout the recording, only changing after the recording is stopped.
*   There is a significant processing delay after stopping a long recording (even if it didn't fail), as all audio is processed at once.

**Required Behavior (The Solution):**
*   The application must be modified to ensure that **every audio chunk** sent to the transcription server is a complete, self-contained, and valid media file with all necessary headers.
*   The system should create and begin uploading these valid chunks periodically (e.g., every 30 seconds) *during* the recording session. This real-time processing is non-negotiable.
*   The UI's chunk counter ("X of Y chunks") must update in real-time as each 30-second segment is created and successfully transcribed.
*   When the user presses "Stop," the processing delay should be minimal, as only the final, partial chunk should need to be transcribed. The full transcript should appear almost instantly.
*   The UI must provide clear state transitions. When "Stop" is pressed, the interface should immediately change from a "Recording" state to a "Processing" state (e.g., by hiding the waveform and showing a processing indicator) until the final transcript is ready.

**Implementation Directive:**
You are to analyze the existing audio recording logic, primarily within the `src/hooks/useAudioTranscriptionRecorder.ts` file. Based on your analysis, you will design and implement the necessary changes to the recording and chunking strategy to meet the required behavior. The final implementation must be robust and solve the "invalid media file" error by ensuring every uploaded chunk is a structurally valid file.

---

**User**

So we've made considerable progress on this. The first issue is largely addressed. The problem is now, what we're ending up with is we don't get the entirety of the last piece. we get all the pieces leading up to the last piece but we don't get the actual last piece so the last piece will be stopped in the middle so what that means is now we are effectively accumulating all of our chunks so the 30 second chunk we only record for 30 seconds we get that chunk if we stop at 35 seconds we get the 30 second chunk we don't get the last five seconds um if we stop at one minute  and 15 seconds we don't get the last 15 seconds We're not getting the last piece that we stopped in the middle of. It's delivering all of the chunks leading up to that piece perfectly, but the last piece it's not getting. It's not getting it all. It returns all of the text that been delivered from the first pieces that have already been captured and processed completely instantaneously which is great but it should be hurt well it should be stopping when it stopped it should be grabbing that's there's a second there's a last chunk that's the leftover piece that's partial that we have that partial recording of and that we need to be pushing getting the transcription of waiting for that to return and then appending that and then delivering that whole object back that last set of steps there isn't happening Let's look at the code and get a detailed understanding of why.
 create a specific directive prompt to hand off to the agent that was already working on this to tell it how to resolve that last concern.  Make sure that you actually review the code structure before arriving at a conclusion. You have to review what was changed because there are new changes. So you should be doing file reads before you just make an assumption and arrive at a point where you believe that you know the answer as to why this is doing what it's doing right now. That would be an inaccurate assumption if you made it in an unformed state.

---

**Cursor**

You're right. It's crucial to analyze the current state of the code before drawing conclusions. The previous changes have fundamentally altered how the recorder operates, and the bug is likely a subtle side effect of that new architecture.

I will now read the relevant file to get a detailed understanding of the current implementation and pinpoint why the final, partial chunk is being dropped.

You're right, my previous assumption was incorrect. After a thorough review of the newly changed code in `src/hooks/useAudioTranscriptionRecorder.ts`, I have a precise understanding of why the last chunk is being dropped.

Your diagnosis is spot-on. The system correctly creates the 30-second chunks, but it's failing to capture the final, partial segment when the user clicks "Stop".

### Code Analysis and Root Cause

The flaw is a subtle but critical race condition in the `stopRecording` function. Here's what's happening:

1.  **Manual Stop Triggered:** When you call `stopRecording`, it immediately sets a flag `isRecordingRef.current = false` and `awaitingFinalTranscriptRef.current = true`. It then clears the automatic 30-second timer (`clearChunkStopTimeout()`).
2.  **Recorder Stopped:** It correctly calls `stopRecorderForChunk({ isFinal: true, ... })`, which in turn calls `recorder.stop()`.
3.  **Final Blob Event:** The `recorder.stop()` method asynchronously triggers one last `ondataavailable` event, which contains the final partial blob (e.g., the last 5 seconds of audio). This event handler is responsible for creating the final chunk record.
4.  **Simultaneous Finalization Check:** At the same time, the `useEffect` hook that checks for completion is running. It sees that `awaitingFinalTranscriptRef.current` is true. It checks if all *currently existing* chunks in the state array have the status `completed`.
5.  **The Race Condition:** If the other full chunks have already finished transcribing *before* the `ondataavailable` event for the final partial chunk has fired and updated the state, the completion check will pass prematurely. It will see, for example, "3 out of 3 chunks completed," assemble the transcript from those three, and finalize the session. A moment later, the final chunk's `ondataavailable` event fires, but it's too late—the session has already been torn down, and the final chunk is discarded.

Essentially, the logic that says "we're done" is running before the logic that says "here is the last piece of audio" has a chance to execute.

---

### Directive for the Agent

Here is the precise, high-level directive to fix this issue.

***

**Objective:**
Fix the bug in the audio recording flow where the final, partial audio chunk is dropped when a recording is stopped. The system must reliably capture, transcribe, and include this final segment in the final transcript.

**User Story:**
As a user, when I stop a recording at 37 seconds, I expect the final transcript to contain the audio from the full 37 seconds, not just the first 30. The final piece of my recording must never be lost.

**Current Behavior (The Problem):**
- When `stopRecording` is called, it correctly triggers the finalization of the last partial audio chunk.
- However, a race condition exists. The logic that checks if all chunks are "completed" can execute *before* the final partial chunk has even been created and added to the state.
- This causes the session to finalize prematurely, using only the transcript data from the full chunks that have already been processed. The final, partial chunk is effectively ignored.

**Required Behavior (The Solution):**
- The finalization logic must be modified to be aware of the pending final chunk. It cannot declare the session "complete" until it has confirmed that the final chunk has been both **created** and **successfully transcribed**.
- When `stopRecording` is called, it should signal to the system that it is now waiting for one last chunk. The completion check must not pass until this final chunk is present in the state array and has a status of `completed`.
- This ensures that the application always waits for the `MediaRecorder` to emit the final blob and for that blob to be fully processed before assembling the transcript and ending the session.

**Implementation Directive:**
You are to analyze the `useAudioTranscriptionRecorder.ts` hook and refactor the state management and finalization logic to eliminate this race condition. You are responsible for designing a robust mechanism to ensure the application waits for the final chunk to be processed before completing the transcription session. The final implementation must guarantee that no audio data is lost when a user stops a recording.

---

**User**

<more>
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { transcribeAudioChunk } from '@/services/transcription';

type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

type ChunkStatus = 'queued' | 'uploading' | 'completed' | 'failed';

interface ChunkRecord {
    id: string;
    index: number;
    blob: Blob;
    status: ChunkStatus;
    attempts: number;
    hadError: boolean;
    createdAt: number;
    durationMs: number;
    startOffsetMs: number;
    endOffsetMs: number;
    isFinal: boolean;
    transcript?: string;
    lastError?: string;
    nextRetryAt?: number;
}

interface UseAudioTranscriptionRecorderOptions {
    chunkDurationMs?: number;
    retryDelayMs?: number;
    onFinalTranscript: (transcript: string) => void;
}

interface ConnectivityState {
    issueCount: number;
    queuedCount: number;
    retryInSeconds: number | null;
}

export interface AudioTranscriptionRecorderResult {
    isSupported: boolean;
    permission: PermissionState;
    isRecording: boolean;
    isRecordingBarVisible: boolean;
    isProcessing: boolean;
    analyserNode: AnalyserNode | null;
    recordingDurationMs: number;
    connectivity: ConnectivityState;
    totalChunks: number;
    completedChunks: number;
    statusAnnouncement: string | null;
    error: string | null;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    toggleRecording: () => void;
    retryPendingChunks: () => void;
}

const DEFAULT_CHUNK_DURATION_MS = 30000; // 30 seconds
const DEFAULT_RETRY_DELAY_MS = 30000;
const MAX_CONCURRENT_UPLOADS = 3;

const safeRandomId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `chunk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const pickMimeType = () => {
    if (typeof window === 'undefined') return undefined;
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm',
        'audio/mp4',
    ];
    return candidates.find((type) =>
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
    );
};

export function useAudioTranscriptionRecorder(
    options: UseAudioTranscriptionRecorderOptions
): AudioTranscriptionRecorderResult {
    const {
        chunkDurationMs = DEFAULT_CHUNK_DURATION_MS,
        retryDelayMs = DEFAULT_RETRY_DELAY_MS,
        onFinalTranscript,
    } = options;

    const [permission, setPermission] = useState<PermissionState>('prompt');
    const [isRecording, setIsRecording] = useState(false);
    const [isRecordingBarVisible, setRecordingBarVisible] = useState(false);
    const [statusAnnouncement, setStatusAnnouncement] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
    const [chunks, setChunks] = useState<ChunkRecord[]>([]);
    const [recordingDurationMs, setRecordingDurationMs] = useState(0);
    const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);
    const [isAwaitingFinal, setIsAwaitingFinal] = useState(false);
<<<<<<< codex/change-c-fix-implement-real-time-audio-chunking-boxf4v
    const [isFinalChunkPending, setIsFinalChunkPending] = useState(false);
=======
>>>>>>> main

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const chunkIndexRef = useRef(0);
    const startTimestampRef = useRef<number | null>(null);
    const stopTimestampRef = useRef<number | null>(null);
    const awaitingFinalTranscriptRef = useRef(false);
    const finalisedRef = useRef(false);
    const retryTimeoutsRef = useRef<Map<string, number>>(new Map());
    const activeUploadsRef = useRef<Set<string>>(new Set());
    const sessionIdRef = useRef<string>('');
    const chunkStartTimestampRef = useRef<number | null>(null);
    const isRecordingRef = useRef(false);
    const chunkStopTimeoutRef = useRef<number | null>(null);
    const pendingChunkInfoRef = useRef<{ isFinal: boolean; shouldRestart: boolean }>({
        isFinal: false,
        shouldRestart: false,
    });

    const metricsRef = useRef({
        sessions: 0,
        totalRecordingDurationMs: 0,
        chunkCount: 0,
        totalTranscriptionSeconds: 0,
        retryCount: 0,
        failureCount: 0,
    });

    const isSupported = useMemo(() => {
        return (
            typeof window !== 'undefined' &&
            typeof navigator !== 'undefined' &&
            !!navigator.mediaDevices &&
            typeof MediaRecorder !== 'undefined'
        );
    }, []);

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('permissions' in navigator)) {
            return;
        }

        let statusRef: PermissionStatus | null = null;
        const handler = () => {
            if (statusRef) {
                setPermission(statusRef.state as PermissionState);
            }
        };

        navigator.permissions
            // @ts-expect-error Microphone is not yet typed in lib.dom
            .query({ name: 'microphone' })
            .then((status: PermissionStatus) => {
                statusRef = status;
                setPermission(status.state as PermissionState);
                status.addEventListener('change', handler);
            })
            .catch(() => {
                setPermission((prev) => (prev === 'prompt' ? 'unsupported' : prev));
            });

        return () => {
            if (statusRef) {
                statusRef.removeEventListener('change', handler);
            }
        };
    }, []);

    const clearRetryTimeout = useCallback((chunkId: string) => {
        const timeoutId = retryTimeoutsRef.current.get(chunkId);
        if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
            retryTimeoutsRef.current.delete(chunkId);
        }
    }, []);

    const clearChunkStopTimeout = useCallback(() => {
        if (chunkStopTimeoutRef.current !== null) {
            window.clearTimeout(chunkStopTimeoutRef.current);
            chunkStopTimeoutRef.current = null;
        }
    }, []);

    const stopRecorderForChunk = useCallback(
        ({ isFinal, shouldRestart }: { isFinal: boolean; shouldRestart: boolean }) => {
            const recorder = mediaRecorderRef.current;
            pendingChunkInfoRef.current = { isFinal, shouldRestart };

            if (!recorder || recorder.state !== 'recording') {
                return;
            }

            try {
                recorder.stop();
            } catch (err) {
                console.error('[AudioRecorder] Failed to stop recorder for chunk', err);
                pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
            }
        },
        []
    );

    const scheduleChunkStop = useCallback(() => {
        clearChunkStopTimeout();
        chunkStopTimeoutRef.current = window.setTimeout(() => {
            stopRecorderForChunk({ isFinal: false, shouldRestart: true });
        }, chunkDurationMs);
    }, [chunkDurationMs, clearChunkStopTimeout, stopRecorderForChunk]);

    const scheduleRetry = useCallback(
        (chunkId: string, delayMs: number) => {
            clearRetryTimeout(chunkId);
            const timeoutId = window.setTimeout(() => {
                retryTimeoutsRef.current.delete(chunkId);
                setChunks((current) =>
                    current.map((chunk) =>
                        chunk.id === chunkId
                            ? {
                                ...chunk,
                                status: 'queued',
                                nextRetryAt: undefined,
                            }
                            : chunk
                    )
                );
            }, delayMs);
            retryTimeoutsRef.current.set(chunkId, timeoutId);
        },
        [clearRetryTimeout]
    );

    const resetSessionMetrics = useCallback(() => {
        metricsRef.current.chunkCount = 0;
        metricsRef.current.totalTranscriptionSeconds = 0;
        metricsRef.current.retryCount = 0;
        metricsRef.current.failureCount = 0;
    }, []);

    const teardownMedia = useCallback(() => {
        mediaRecorderRef.current = null;
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => undefined);
            audioContextRef.current = null;
        }
        setAnalyserNode(null);
    }, []);

    const updateRetryCountdown = useCallback((records: ChunkRecord[]) => {
        const failing = records.filter((chunk) => chunk.hadError && chunk.status !== 'completed');
        if (failing.length === 0) {
            setRetryInSeconds(null);
            return;
        }
        const nextRetry = failing
            .map((chunk) => chunk.nextRetryAt ?? Date.now())
            .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
        if (!Number.isFinite(nextRetry)) {
            setRetryInSeconds(null);
            return;
        }
        const update = () => {
            const diffMs = nextRetry - Date.now();
            setRetryInSeconds(diffMs > 0 ? Math.ceil(diffMs / 1000) : 0);
        };
        update();
    }, []);

    const setChunksAndUpdate = useCallback(
        (updater: (previous: ChunkRecord[]) => ChunkRecord[]) => {
            setChunks((previous) => {
                const updated = updater(previous);
                updateRetryCountdown(updated);
                return updated;
            });
        },
        [updateRetryCountdown]
    );

    const clearAllRetryTimeouts = useCallback(() => {
        retryTimeoutsRef.current.forEach((timeoutId, chunkId) => {
            window.clearTimeout(timeoutId);
            retryTimeoutsRef.current.delete(chunkId);
        });
    }, []);

    const finalizeSession = useCallback(
        ({
            orderedChunks = [],
            transcript,
            reason,
        }: {
            orderedChunks?: ChunkRecord[];
            transcript?: string;
            reason?: 'no-audio' | 'error';
        } = {}) => {
            if (finalisedRef.current) {
                return;
            }

            finalisedRef.current = true;
            awaitingFinalTranscriptRef.current = false;
            setIsAwaitingFinal(false);
<<<<<<< codex/change-c-fix-implement-real-time-audio-chunking-boxf4v
            setIsFinalChunkPending(false);
=======
>>>>>>> main

            const stopTime = stopTimestampRef.current ?? Date.now();
            const startTime = startTimestampRef.current ?? stopTime;
            const sessionDuration = Math.max(0, stopTime - startTime);
            metricsRef.current.totalRecordingDurationMs += sessionDuration;

            console.log('[AudioTelemetry] Session complete', {
                sessionId: sessionIdRef.current,
                sessionDurationMs: sessionDuration,
                chunks: orderedChunks.length,
                totalChunkTranscriptionSeconds: metricsRef.current.totalTranscriptionSeconds,
                retries: metricsRef.current.retryCount,
                failures: metricsRef.current.failureCount,
                sessionsStarted: metricsRef.current.sessions,
            });

            const normalisedTranscript = transcript?.replace(/\s+/g, ' ').trim();
            if (typeof normalisedTranscript === 'string') {
                if (normalisedTranscript.length > 0) {
                    onFinalTranscript(normalisedTranscript);
                    setStatusAnnouncement('Transcription ready and added to input.');
                } else {
                    setStatusAnnouncement('Recording stopped with no audio captured.');
                }
            } else if (reason === 'no-audio') {
                setStatusAnnouncement('Recording stopped with no audio captured.');
            } else if (reason === 'error') {
                setStatusAnnouncement('Recording stopped due to an error.');
            }

            setIsRecording(false);
            setRecordingBarVisible(false);
            setChunksAndUpdate(() => []);
            clearAllRetryTimeouts();
            activeUploadsRef.current.clear();
            chunkStartTimestampRef.current = null;
            clearChunkStopTimeout();
            pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
            isRecordingRef.current = false;
            sessionIdRef.current = '';
            chunkIndexRef.current = 0;
            startTimestampRef.current = null;
            stopTimestampRef.current = null;
            teardownMedia();
        },
        [
            clearAllRetryTimeouts,
            clearChunkStopTimeout,
            onFinalTranscript,
            setChunksAndUpdate,
            teardownMedia,
        ]
    );

    const beginChunkRecording = useCallback(
        (startTime?: number) => {
            const recorder = mediaRecorderRef.current;
            if (!recorder || recorder.state !== 'inactive') {
                return;
            }

            try {
                const chunkStart = startTime ?? Date.now();
                chunkStartTimestampRef.current = chunkStart;
                pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
                recorder.start();
                scheduleChunkStop();
            } catch (err) {
                console.error('[AudioRecorder] Failed to start recorder', err);
                setError('Unable to continue audio recording.');
                setStatusAnnouncement('Recording stopped due to an error.');
                finalizeSession({ reason: 'error' });
            }
        },
        [finalizeSession, scheduleChunkStop]
    );

    const processQueue = useCallback(
        (records: ChunkRecord[]) => {
            if (records.length === 0) return;
            const availableSlots = MAX_CONCURRENT_UPLOADS - activeUploadsRef.current.size;
            if (availableSlots <= 0) return;

            const now = Date.now();
            const candidates = records.filter((chunk) => {
                if (activeUploadsRef.current.has(chunk.id)) {
                    return false;
                }
                if (chunk.status === 'queued') {
                    return true;
                }
                if (chunk.status === 'failed' && chunk.nextRetryAt && chunk.nextRetryAt <= now) {
                    return true;
                }
                return false;
            });

            if (candidates.length === 0) {
                return;
            }

            candidates.slice(0, availableSlots).forEach((chunk) => {
                activeUploadsRef.current.add(chunk.id);
                setChunksAndUpdate((current) =>
                    current.map((record) =>
                        record.id === chunk.id
                            ? {
                                ...record,
                                status: 'uploading',
                                attempts: record.attempts + 1,
                                nextRetryAt: undefined,
                                lastError: undefined,
                            }
                            : record
                    )
                );

                const uploadStartedAt = performance.now();

                // Improved logging before the request
                console.log('[AudioRecorder] Uploading chunk', {
                    id: chunk.id,
                    index: chunk.index,
                    blobSize: chunk.blob.size,
                    blobType: chunk.blob.type,
                    durationMs: chunk.durationMs,
                });

                transcribeAudioChunk(chunk.blob, `${chunk.id}.webm`, {
                    chunkIndex: chunk.index,
                    sessionId: sessionIdRef.current,
                    durationMs: chunk.durationMs,
                    startOffsetMs: chunk.startOffsetMs,
                    endOffsetMs: chunk.endOffsetMs,
                    isFinalChunk: chunk.isFinal,
                })
                    .then((result) => {
                        const transcriptionSeconds = (performance.now() - uploadStartedAt) / 1000;
                        metricsRef.current.chunkCount += 1;
                        metricsRef.current.totalTranscriptionSeconds += transcriptionSeconds;
                        setChunksAndUpdate((current) =>
                            current.map((record) =>
                                record.id === chunk.id
                                    ? {
                                        ...record,
                                        status: 'completed',
                                        transcript: result.text,
                                        hadError: record.hadError,
                                        lastError: undefined,
                                    }
                                    : record
                            )
                        );
                    })
                    .catch((err: Error) => {
                        metricsRef.current.failureCount += 1;
                        console.error('[AudioRecorder] Chunk transcription failed', {
                            chunkId: chunk.id,
                            chunkIndex: chunk.index,
                            error: err.message,
                            responseError: (err as any).responseError,
                        });

                        const nextRetryAt = Date.now() + retryDelayMs;
                        setStatusAnnouncement(`Audio chunk failed to transcribe. Retrying in ${Math.round(retryDelayMs / 1000)}s.`);

                        setChunksAndUpdate((current) =>
                            current.map((record) =>
                                record.id === chunk.id
                                    ? {
                                        ...record,
                                        status: 'failed',
                                        lastError: err.message,
                                        nextRetryAt,
                                        hadError: true,
                                    }
                                    : record
                            )
                        );
                        scheduleRetry(chunk.id, retryDelayMs);
                    })
                    .finally(() => {
                        activeUploadsRef.current.delete(chunk.id);
                    });
            });
        },
        [retryDelayMs, scheduleRetry, setChunksAndUpdate]
    );

    useEffect(() => {
        processQueue(chunks);
    }, [chunks, processQueue]);

    useEffect(() => {
        const timeoutSnapshot = retryTimeoutsRef.current;
        return () => {
            const timeouts = Array.from(timeoutSnapshot.values());
            timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
            timeoutSnapshot.clear();
            clearChunkStopTimeout();
            teardownMedia();
        };
    }, [clearChunkStopTimeout, teardownMedia]);

    useEffect(() => {
        if (!isRecording) {
            return;
        }
        const intervalId = window.setInterval(() => {
            if (startTimestampRef.current) {
                setRecordingDurationMs(Date.now() - startTimestampRef.current);
            }
        }, 250);

        return () => window.clearInterval(intervalId);
    }, [isRecording]);

    useEffect(() => {
        if (!awaitingFinalTranscriptRef.current || finalisedRef.current) {
            return;
        }

        if (isFinalChunkPending) {
            return;
        }

        const pending = chunks.some((chunk) => chunk.status !== 'completed');
        if (pending) {
            return;
        }

        const ordered = [...chunks].sort((a, b) => a.index - b.index);
        const transcript = ordered.map((chunk) => chunk.transcript ?? '').join(' ');

        finalizeSession({ orderedChunks: ordered, transcript });
    }, [chunks, finalizeSession, isFinalChunkPending]);

    const startRecording = useCallback(async () => {
        if (!isSupported) {
            setError('Audio recording is not supported in this browser.');
            setPermission('unsupported');
            return;
        }
        if (isRecording) {
            return;
        }

        try {
            setError(null);
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setPermission('granted');
            sessionIdRef.current = safeRandomId();
            metricsRef.current.sessions += 1;
            resetSessionMetrics();
            startTimestampRef.current = Date.now();
            stopTimestampRef.current = null;
            setRecordingDurationMs(0);
            chunkIndexRef.current = 0;
            awaitingFinalTranscriptRef.current = false;
            finalisedRef.current = false;
            setChunksAndUpdate(() => []);
            setRecordingBarVisible(true);
            setStatusAnnouncement('Recording started.');
            setIsAwaitingFinal(false);
<<<<<<< codex/change-c-fix-implement-real-time-audio-chunking-boxf4v
            setIsFinalChunkPending(false);
=======
>>>>>>> main

            streamRef.current = stream;

            const context = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = context;
            const source = context.createMediaStreamSource(stream);
            const analyser = context.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            setAnalyserNode(analyser);

            const mimeType = pickMimeType();
            const recorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;

            chunkStartTimestampRef.current = startTimestampRef.current ?? Date.now();
            pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
            clearChunkStopTimeout();

            recorder.ondataavailable = (event) => {
                const { isFinal: isFinalChunk } = pendingChunkInfoRef.current;

                if (!event.data || event.data.size === 0) {
                    if (isFinalChunk) {
                        setIsFinalChunkPending(false);
                    }
                    return;
                }

                const chunkId = `${sessionIdRef.current}-${chunkIndexRef.current}`;
                const now = Date.now();
                const recordingStart = startTimestampRef.current ?? now;
                const chunkStart = chunkStartTimestampRef.current ?? recordingStart;
                const durationMs = Math.max(1, now - chunkStart);
                const startOffsetMs = Math.max(0, chunkStart - recordingStart);
                const endOffsetMs = Math.max(startOffsetMs + durationMs, now - recordingStart);
<<<<<<< codex/change-c-fix-implement-real-time-audio-chunking-boxf4v
=======
                const { isFinal: isFinalChunk } = pendingChunkInfoRef.current;
>>>>>>> main

                setChunksAndUpdate((prev) => [
                    ...prev,
                    {
                        id: chunkId,
                        index: chunkIndexRef.current,
                        blob: event.data,
                        status: 'queued',
                        attempts: 0,
                        durationMs,
                        startOffsetMs,
                        endOffsetMs,
                        isFinal: isFinalChunk,
                        hadError: false,
                        createdAt: now,
                    },
                ]);

                chunkIndexRef.current += 1;
                chunkStartTimestampRef.current = null;
<<<<<<< codex/change-c-fix-implement-real-time-audio-chunking-boxf4v

                if (isFinalChunk) {
                    setIsFinalChunkPending(false);
                }
=======
>>>>>>> main
            };

            recorder.onstop = () => {
                const { isFinal, shouldRestart } = pendingChunkInfoRef.current;
                const shouldResume = shouldRestart && !isFinal && isRecordingRef.current;
                if (!shouldResume) {
                    clearChunkStopTimeout();
                }
                if (shouldResume) {
                    beginChunkRecording();
                }
                if (!shouldResume) {
                    pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
                }
            };

            recorder.onerror = (event) => {
                const error = (event as { error?: DOMException }).error;
                console.error('[AudioRecorder] MediaRecorder error', error ?? event);
                setError(error?.message ?? 'An unexpected audio recording error occurred.');
                setStatusAnnouncement('Recording stopped due to an error.');
                finalizeSession({ reason: 'error' });
            };

            isRecordingRef.current = true;
            setIsRecording(true);
            beginChunkRecording(startTimestampRef.current ?? Date.now());
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unable to start audio recording.';
            console.error('[AudioRecorder] Failed to start recording', err);
            setError(message);
            setPermission('denied');
            setStatusAnnouncement('Microphone permission denied or unavailable.');
        }
    }, [
        beginChunkRecording,
        clearChunkStopTimeout,
        finalizeSession,
        isRecording,
        isSupported,
        resetSessionMetrics,
        setChunksAndUpdate,
    ]);

    const stopRecording = useCallback(() => {
        const recorder = mediaRecorderRef.current;
        if (!recorder) {
            return;
        }
        if (recorder.state === 'inactive' && !isRecordingRef.current) {
            return;
        }
        stopTimestampRef.current = Date.now();
        if (startTimestampRef.current) {
            setRecordingDurationMs(stopTimestampRef.current - startTimestampRef.current);
        }
        isRecordingRef.current = false;
        setIsRecording(false);
        awaitingFinalTranscriptRef.current = true;
        setIsAwaitingFinal(true);
<<<<<<< codex/change-c-fix-implement-real-time-audio-chunking-boxf4v
        setIsFinalChunkPending(true);
=======
>>>>>>> main
        setChunksAndUpdate((current) => [...current]);
        setStatusAnnouncement('Processing final audio chunk…');
        clearChunkStopTimeout();
        if (recorder.state === 'recording') {
            stopRecorderForChunk({ isFinal: true, shouldRestart: false });
        } else {
            pendingChunkInfoRef.current = { isFinal: true, shouldRestart: false };
<<<<<<< codex/change-c-fix-implement-real-time-audio-chunking-boxf4v
            setIsFinalChunkPending(false);
=======
>>>>>>> main
        }
    }, [clearChunkStopTimeout, setChunksAndUpdate, stopRecorderForChunk]);

    const toggleRecording = useCallback(() => {
        if (isRecording) {
            stopRecording();
        } else {
            void startRecording();
        }
    }, [isRecording, startRecording, stopRecording]);

    const retryPendingChunks = useCallback(() => {
        metricsRef.current.retryCount += 1;
        setChunksAndUpdate((current) =>
            current.map((chunk) => {
                if (chunk.hadError && chunk.status !== 'completed') {
                    clearRetryTimeout(chunk.id);
                    return {
                        ...chunk,
                        status: 'queued',
                        nextRetryAt: undefined,
                    };
                }
                return chunk;
            })
        );
        setStatusAnnouncement('Retrying queued audio chunks now.');
    }, [clearRetryTimeout, setChunksAndUpdate]);

    const completedChunks = useMemo(() => chunks.filter((chunk) => chunk.status === 'completed').length, [chunks]);
    const totalChunks = chunks.length;
    const connectivity = useMemo<ConnectivityState>(() => {
        const issueChunks = chunks.filter((chunk) => chunk.hadError && chunk.status !== 'completed');
        const queuedCount = issueChunks.filter((chunk) => chunk.status !== 'uploading').length;
        return {
            issueCount: issueChunks.length,
            queuedCount,
            retryInSeconds,
        };
    }, [chunks, retryInSeconds]);

    const isProcessing = useMemo(() => {
        if (isRecording) return false;
        if (isAwaitingFinal) return true;
        if (totalChunks === 0) return false;
        return completedChunks < totalChunks;
    }, [completedChunks, isAwaitingFinal, isRecording, totalChunks]);

    return {
        isSupported,
        permission,
        isRecording,
        isRecordingBarVisible,
        isProcessing,
        analyserNode,
        recordingDurationMs,
        connectivity,
        totalChunks,
        completedChunks,
        statusAnnouncement,
        error,
        startRecording,
        stopRecording,
        toggleRecording,
        retryPendingChunks,
    };
}
</more>

okay, so we, this implementation was completed. works in this new most recent fork that came as a result of that directive. Now the problem is there's a merge conflict. This is, I just attached, the entirety of that with the merge conflict noted in whatever appropriate file notation is there. So there's three options. Which one should we select given circumstances?

Just tell me which option to press in github

---

**Cursor**

Based on my analysis of the merge conflict, the changes from the branch `codex/change-c-fix-implement-real-time-audio-chunking-boxf4v` contain the necessary logic to fix the "dropped final chunk" bug. This new code introduces a state flag, `isFinalChunkPending`, and uses it to correctly manage the race condition between the final audio blob being created and the session finalization check.

The code on the `main` branch represents the state *before* this fix was implemented.

Therefore, you should **accept the incoming changes** for all conflicts. This will integrate the complete fix into your main branch.

---

**User**

16:34:56.749	Cloning repository...
16:34:58.325	From https://github.com/togetherness3921-crypto/life-currents
16:34:58.326	 * branch            4af0b0b27dce0b96b1d44ef1bf9729eb487c36d3 -> FETCH_HEAD
16:34:58.326	
16:34:58.549	HEAD is now at 4af0b0b Merge branch 'main' into codex/change-c-fix-implement-real-time-audio-chunking-boxf4v
16:34:58.550	
16:34:58.632	
16:34:58.633	Using v2 root directory strategy
16:34:58.663	Success: Finished cloning repository files
16:35:00.496	Checking for configuration in a Wrangler configuration file (BETA)
16:35:00.497	
16:35:01.615	No wrangler.toml file found. Continuing.
16:35:01.683	Detected the following tools from environment: npm@10.9.2, nodejs@22.16.0
16:35:01.683	Installing project dependencies: npm clean-install --progress=false
16:35:05.380	npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
16:35:05.662	npm warn deprecated @types/uuid@11.0.0: This is a stub types definition. uuid provides its own type definitions, so you do not need this installed.
16:35:11.807	
16:35:11.807	added 474 packages, and audited 475 packages in 10s
16:35:11.807	
16:35:11.807	87 packages are looking for funding
16:35:11.807	  run `npm fund` for details
16:35:11.816	
16:35:11.816	2 moderate severity vulnerabilities
16:35:11.816	
16:35:11.816	To address all issues, run:
16:35:11.816	  npm audit fix
16:35:11.817	
16:35:11.817	Run `npm audit` for details.
16:35:11.856	Executing user command: npm run build
16:35:12.234	
16:35:12.235	> vite_react_shadcn_ts@0.0.0 build
16:35:12.235	> vite build
16:35:12.235	
16:35:12.600	vite v5.4.19 building for production...
16:35:12.788	(node:733) ESLintIgnoreWarning: The ".eslintignore" file is no longer supported. Switch to using the "ignores" property in "eslint.config.js": https://eslint.org/docs/latest/use/configure/migration-guide#ignoring-files
16:35:12.788	(Use `node --trace-warnings ...` to show where the warning was created)
16:35:12.813	transforming...
16:35:14.823	[plugin:vite-plugin-eslint] [plugin vite-plugin-eslint] src/components/ui/sonner.tsx: 
16:35:14.824	/opt/buildhome/repo/src/components/ui/sonner.tsx
16:35:14.824	  27:19  warning  Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components  react-refresh/only-export-components
16:35:14.824	
16:35:14.824	✖ 1 problem (0 errors, 1 warning)
16:35:14.824	
16:35:15.150	[plugin:vite-plugin-eslint] [plugin vite-plugin-eslint] src/components/CausalGraph.tsx: 
16:35:15.151	/opt/buildhome/repo/src/components/CausalGraph.tsx
16:35:15.151	  185:5  warning  React Hook useCallback has an unnecessary dependency: 'activeGraphId'. Either exclude it or remove the dependency array  react-hooks/exhaustive-deps
16:35:15.151	
16:35:15.151	✖ 1 problem (0 errors, 1 warning)
16:35:15.151	
16:35:16.205	[plugin:vite-plugin-eslint] [plugin vite-plugin-eslint] src/components/ui/button.tsx: 
16:35:16.206	/opt/buildhome/repo/src/components/ui/button.tsx
16:35:16.206	  48:18  warning  Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components  react-refresh/only-export-components
16:35:16.206	
16:35:16.206	✖ 1 problem (0 errors, 1 warning)
16:35:16.206	
16:35:16.460	[plugin:vite-plugin-eslint] [plugin vite-plugin-eslint] src/hooks/useGraphData.ts: 
16:35:16.461	/opt/buildhome/repo/src/hooks/useGraphData.ts
16:35:16.461	  679:6  warning  React Hook useEffect has missing dependencies: 'calculateAndRecordHistoricalProgress', 'calculateAutoLayout', and 'fetchGraphData'. Either include them or remove the dependency array  react-hooks/exhaustive-deps
16:35:16.461	  723:6  warning  React Hook useEffect has a missing dependency: 'docData'. Either include it or remove the dependency array                                                                              react-hooks/exhaustive-deps
16:35:16.461	  749:6  warning  React Hook useEffect has a missing dependency: 'measuredNodes'. Either include it or remove the dependency array                                                                        react-hooks/exhaustive-deps
16:35:16.461	  775:6  warning  React Hook useEffect has missing dependencies: 'calculateAutoLayout' and 'docData'. Either include them or remove the dependency array                                                  react-hooks/exhaustive-deps
16:35:16.461	  786:6  warning  React Hook useEffect has missing dependencies: 'calculateAutoLayout' and 'getActiveNodesData'. Either include them or remove the dependency array                                       react-hooks/exhaustive-deps
16:35:16.461	
16:35:16.461	✖ 5 problems (0 errors, 5 warnings)
16:35:16.462	
16:35:17.011	[plugin:vite-plugin-eslint] [plugin vite-plugin-eslint] src/hooks/chatProvider.tsx: 
16:35:17.011	/opt/buildhome/repo/src/hooks/chatProvider.tsx
16:35:17.012	  418:42  warning  The ref value 'messagePersistTimers.current' will likely have changed by the time this effect cleanup function runs. If this ref points to a node rendered by React, copy 'messagePersistTimers.current' to a variable inside the effect, and use that variable in the cleanup function  react-hooks/exhaustive-deps
16:35:17.012	  419:40  warning  The ref value 'draftPersistTimers.current' will likely have changed by the time this effect cleanup function runs. If this ref points to a node rendered by React, copy 'draftPersistTimers.current' to a variable inside the effect, and use that variable in the cleanup function      react-hooks/exhaustive-deps
16:35:17.012	
16:35:17.012	✖ 2 problems (0 errors, 2 warnings)
16:35:17.012	
16:35:17.064	[plugin:vite-plugin-eslint] [plugin vite-plugin-eslint] src/hooks/modelSelectionProvider.tsx: 
16:35:17.065	/opt/buildhome/repo/src/hooks/modelSelectionProvider.tsx
16:35:17.065	  9:14  warning  Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components  react-refresh/only-export-components
16:35:17.065	
16:35:17.066	✖ 1 problem (0 errors, 1 warning)
16:35:17.066	
16:35:17.244	✓ 1751 modules transformed.
16:35:17.246	x Build failed in 4.62s
16:35:17.246	error during build:
16:35:17.246	[vite:esbuild] Transform failed with 1 error:
16:35:17.246	/opt/buildhome/repo/src/hooks/useAudioTranscriptionRecorder.ts:606:22: ERROR: The symbol "isFinalChunk" has already been declared
16:35:17.247	file: /opt/buildhome/repo/src/hooks/useAudioTranscriptionRecorder.ts:606:22
16:35:17.247	
16:35:17.247	The symbol "isFinalChunk" has already been declared
16:35:17.247	604|                  const startOffsetMs = Math.max(0, chunkStart - recordingStart);
16:35:17.247	605|                  const endOffsetMs = Math.max(startOffsetMs + durationMs, now - recordingStart);
16:35:17.247	606|                  const { isFinal: isFinalChunk } = pendingChunkInfoRef.current;
16:35:17.247	   |                        ^
16:35:17.248	607|  
16:35:17.248	608|                  setChunksAndUpdate((prev) => [
16:35:17.248	
16:35:17.248	    at failureErrorWithLog (/opt/buildhome/repo/node_modules/vite/node_modules/esbuild/lib/main.js:1472:15)
16:35:17.248	    at /opt/buildhome/repo/node_modules/vite/node_modules/esbuild/lib/main.js:755:50
16:35:17.248	    at responseCallbacks.<computed> (/opt/buildhome/repo/node_modules/vite/node_modules/esbuild/lib/main.js:622:9)
16:35:17.248	    at handleIncomingPacket (/opt/buildhome/repo/node_modules/vite/node_modules/esbuild/lib/main.js:677:12)
16:35:17.248	    at Socket.readFromStdout (/opt/buildhome/repo/node_modules/vite/node_modules/esbuild/lib/main.js:600:7)
16:35:17.248	    at Socket.emit (node:events:518:28)
16:35:17.248	    at addChunk (node:internal/streams/readable:561:12)
16:35:17.249	    at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
16:35:17.249	    at Readable.push (node:internal/streams/readable:392:5)
16:35:17.249	    at Pipe.onStreamRead (node:internal/stream_base_commons:189:23)
16:35:17.291	Failed: Error while executing user command. Exited with error code: 1
16:35:17.302	Failed: build command exited with code: 1
16:35:18.475	Failed: error occurred while running build command

---

**Cursor**

This is a classic post-merge build error. The log is very clear:

```
ERROR: The symbol "isFinalChunk" has already been declared
```

This happened because the merge conflict resolution, despite the instructions, resulted in the line `const { isFinal: isFinalChunk } = pendingChunkInfoRef.current;` appearing twice within the same function scope in `src/hooks/useAudioTranscriptionRecorder.ts`.

One declaration is at the top of the `ondataavailable` event handler, and the other is further down. This is a syntax error that breaks the build.

The fix is straightforward: I will remove the redundant declaration. I'll read the file to get its exact current state and then apply the edit.

```plaintext
ERROR: The symbol "isFinalChunk" has already been declared
```

I've reviewed the file and can see the build error clearly. The merge conflict resolution resulted in a duplicate variable declaration, causing the build to fail.

The error is `The symbol "isFinalChunk" has already been declared`. This is happening because the line `const { isFinal: isFinalChunk } = pendingChunkInfoRef.current;` now appears twice within the `recorder.ondataavailable` event handler.

I will correct this by removing the duplicate line.

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { transcribeAudioChunk } from '@/services/transcription';

type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

type ChunkStatus = 'queued' | 'uploading' | 'completed' | 'failed';

interface ChunkRecord {
    id: string;
    index: number;
    blob: Blob;
    status: ChunkStatus;
    attempts: number;
    hadError: boolean;
    createdAt: number;
    durationMs: number;
    startOffsetMs: number;
    endOffsetMs: number;
    isFinal: boolean;
    transcript?: string;
    lastError?: string;
    nextRetryAt?: number;
}

interface UseAudioTranscriptionRecorderOptions {
    chunkDurationMs?: number;
    retryDelayMs?: number;
    onFinalTranscript: (transcript: string) => void;
}

interface ConnectivityState {
    issueCount: number;
    queuedCount: number;
    retryInSeconds: number | null;
}

export interface AudioTranscriptionRecorderResult {
    isSupported: boolean;
    permission: PermissionState;
    isRecording: boolean;
    isRecordingBarVisible: boolean;
    isProcessing: boolean;
    analyserNode: AnalyserNode | null;
    recordingDurationMs: number;
    connectivity: ConnectivityState;
    totalChunks: number;
    completedChunks: number;
    statusAnnouncement: string | null;
    error: string | null;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    toggleRecording: () => void;
    retryPendingChunks: () => void;
}

const DEFAULT_CHUNK_DURATION_MS = 30000; // 30 seconds
const DEFAULT_RETRY_DELAY_MS = 30000;
const MAX_CONCURRENT_UPLOADS = 3;

const safeRandomId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `chunk-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const pickMimeType = () => {
    if (typeof window === 'undefined') return undefined;
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm',
        'audio/mp4',
    ];
    return candidates.find((type) =>
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
    );
};

export function useAudioTranscriptionRecorder(
    options: UseAudioTranscriptionRecorderOptions
): AudioTranscriptionRecorderResult {
    const {
        chunkDurationMs = DEFAULT_CHUNK_DURATION_MS,
        retryDelayMs = DEFAULT_RETRY_DELAY_MS,
        onFinalTranscript,
    } = options;

    const [permission, setPermission] = useState<PermissionState>('prompt');
    const [isRecording, setIsRecording] = useState(false);
    const [isRecordingBarVisible, setRecordingBarVisible] = useState(false);
    const [statusAnnouncement, setStatusAnnouncement] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
    const [chunks, setChunks] = useState<ChunkRecord[]>([]);
    const [recordingDurationMs, setRecordingDurationMs] = useState(0);
    const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);
    const [isAwaitingFinal, setIsAwaitingFinal] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const chunkIndexRef = useRef(0);
    const startTimestampRef = useRef<number | null>(null);
    const stopTimestampRef = useRef<number | null>(null);
    const awaitingFinalTranscriptRef = useRef(false);
    const finalisedRef = useRef(false);
    const retryTimeoutsRef = useRef<Map<string, number>>(new Map());
    const activeUploadsRef = useRef<Set<string>>(new Set());
    const sessionIdRef = useRef<string>('');
    const chunkStartTimestampRef = useRef<number | null>(null);
    const isRecordingRef = useRef(false);
    const chunkStopTimeoutRef = useRef<number | null>(null);
    const pendingChunkInfoRef = useRef<{ isFinal: boolean; shouldRestart: boolean }>({
        isFinal: false,
        shouldRestart: false,
    });

    const metricsRef = useRef({
        sessions: 0,
        totalRecordingDurationMs: 0,
        chunkCount: 0,
        totalTranscriptionSeconds: 0,
        retryCount: 0,
        failureCount: 0,
    });

    const isSupported = useMemo(() => {
        return (
            typeof window !== 'undefined' &&
            typeof navigator !== 'undefined' &&
            !!navigator.mediaDevices &&
            typeof MediaRecorder !== 'undefined'
        );
    }, []);

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('permissions' in navigator)) {
            return;
        }

        let statusRef: PermissionStatus | null = null;
        const handler = () => {
            if (statusRef) {
                setPermission(statusRef.state as PermissionState);
            }
        };

        navigator.permissions
            // @ts-expect-error Microphone is not yet typed in lib.dom
            .query({ name: 'microphone' })
            .then((status: PermissionStatus) => {
                statusRef = status;
                setPermission(status.state as PermissionState);
                status.addEventListener('change', handler);
            })
            .catch(() => {
                setPermission((prev) => (prev === 'prompt' ? 'unsupported' : prev));
            });

        return () => {
            if (statusRef) {
                statusRef.removeEventListener('change', handler);
            }
        };
    }, []);

    const clearRetryTimeout = useCallback((chunkId: string) => {
        const timeoutId = retryTimeoutsRef.current.get(chunkId);
        if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
            retryTimeoutsRef.current.delete(chunkId);
        }
    }, []);

    const clearChunkStopTimeout = useCallback(() => {
        if (chunkStopTimeoutRef.current !== null) {
            window.clearTimeout(chunkStopTimeoutRef.current);
            chunkStopTimeoutRef.current = null;
        }
    }, []);

    const stopRecorderForChunk = useCallback(
        ({ isFinal, shouldRestart }: { isFinal: boolean; shouldRestart: boolean }) => {
            const recorder = mediaRecorderRef.current;
            pendingChunkInfoRef.current = { isFinal, shouldRestart };

            if (!recorder || recorder.state !== 'recording') {
                return;
            }

            try {
                recorder.stop();
            } catch (err) {
                console.error('[AudioRecorder] Failed to stop recorder for chunk', err);
                pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
            }
        },
        []
    );

    const scheduleChunkStop = useCallback(() => {
        clearChunkStopTimeout();
        chunkStopTimeoutRef.current = window.setTimeout(() => {
            stopRecorderForChunk({ isFinal: false, shouldRestart: true });
        }, chunkDurationMs);
    }, [chunkDurationMs, clearChunkStopTimeout, stopRecorderForChunk]);

    const scheduleRetry = useCallback(
        (chunkId: string, delayMs: number) => {
            clearRetryTimeout(chunkId);
            const timeoutId = window.setTimeout(() => {
                retryTimeoutsRef.current.delete(chunkId);
                setChunks((current) =>
                    current.map((chunk) =>
                        chunk.id === chunkId
                            ? {
                                ...chunk,
                                status: 'queued',
                                nextRetryAt: undefined,
                            }
                            : chunk
                    )
                );
            }, delayMs);
            retryTimeoutsRef.current.set(chunkId, timeoutId);
        },
        [clearRetryTimeout]
    );

    const resetSessionMetrics = useCallback(() => {
        metricsRef.current.chunkCount = 0;
        metricsRef.current.totalTranscriptionSeconds = 0;
        metricsRef.current.retryCount = 0;
        metricsRef.current.failureCount = 0;
    }, []);

    const teardownMedia = useCallback(() => {
        mediaRecorderRef.current = null;
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close().catch(() => undefined);
            audioContextRef.current = null;
        }
        setAnalyserNode(null);
    }, []);

    const updateRetryCountdown = useCallback((records: ChunkRecord[]) => {
        const failing = records.filter((chunk) => chunk.hadError && chunk.status !== 'completed');
        if (failing.length === 0) {
            setRetryInSeconds(null);
            return;
        }
        const nextRetry = failing
            .map((chunk) => chunk.nextRetryAt ?? Date.now())
            .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
        if (!Number.isFinite(nextRetry)) {
            setRetryInSeconds(null);
            return;
        }
        const update = () => {
            const diffMs = nextRetry - Date.now();
            setRetryInSeconds(diffMs > 0 ? Math.ceil(diffMs / 1000) : 0);
        };
        update();
    }, []);

    const setChunksAndUpdate = useCallback(
        (updater: (previous: ChunkRecord[]) => ChunkRecord[]) => {
            setChunks((previous) => {
                const updated = updater(previous);
                updateRetryCountdown(updated);
                return updated;
            });
        },
        [updateRetryCountdown]
    );

    const clearAllRetryTimeouts = useCallback(() => {
        retryTimeoutsRef.current.forEach((timeoutId, chunkId) => {
            window.clearTimeout(timeoutId);
            retryTimeoutsRef.current.delete(chunkId);
        });
    }, []);

    const finalizeSession = useCallback(
        ({
            orderedChunks = [],
            transcript,
            reason,
        }: {
            orderedChunks?: ChunkRecord[];
            transcript?: string;
            reason?: 'no-audio' | 'error';
        } = {}) => {
            if (finalisedRef.current) {
                return;
            }

            finalisedRef.current = true;
            awaitingFinalTranscriptRef.current = false;
            setIsAwaitingFinal(false);

            const stopTime = stopTimestampRef.current ?? Date.now();
            const startTime = startTimestampRef.current ?? stopTime;
            const sessionDuration = Math.max(0, stopTime - startTime);
            metricsRef.current.totalRecordingDurationMs += sessionDuration;

            console.log('[AudioTelemetry] Session complete', {
                sessionId: sessionIdRef.current,
                sessionDurationMs: sessionDuration,
                chunks: orderedChunks.length,
                totalChunkTranscriptionSeconds: metricsRef.current.totalTranscriptionSeconds,
                retries: metricsRef.current.retryCount,
                failures: metricsRef.current.failureCount,
                sessionsStarted: metricsRef.current.sessions,
            });

            const normalisedTranscript = transcript?.replace(/\s+/g, ' ').trim();
            if (typeof normalisedTranscript === 'string') {
                if (normalisedTranscript.length > 0) {
                    onFinalTranscript(normalisedTranscript);
                    setStatusAnnouncement('Transcription ready and added to input.');
                } else {
                    setStatusAnnouncement('Recording stopped with no audio captured.');
                }
            } else if (reason === 'no-audio') {
                setStatusAnnouncement('Recording stopped with no audio captured.');
            } else if (reason === 'error') {
                setStatusAnnouncement('Recording stopped due to an error.');
            }

            setIsRecording(false);
            setRecordingBarVisible(false);
            setChunksAndUpdate(() => []);
            clearAllRetryTimeouts();
            activeUploadsRef.current.clear();
            chunkStartTimestampRef.current = null;
            clearChunkStopTimeout();
            pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
            isRecordingRef.current = false;
            sessionIdRef.current = '';
            chunkIndexRef.current = 0;
            startTimestampRef.current = null;
            stopTimestampRef.current = null;
            teardownMedia();
        },
        [
            clearAllRetryTimeouts,
            clearChunkStopTimeout,
            onFinalTranscript,
            setChunksAndUpdate,
            teardownMedia,
        ]
    );

    const beginChunkRecording = useCallback(
        (startTime?: number) => {
            const recorder = mediaRecorderRef.current;
            if (!recorder || recorder.state !== 'inactive') {
                return;
            }

            try {
                const chunkStart = startTime ?? Date.now();
                chunkStartTimestampRef.current = chunkStart;
                pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
                recorder.start();
                scheduleChunkStop();
            } catch (err) {
                console.error('[AudioRecorder] Failed to start recorder', err);
                setError('Unable to continue audio recording.');
                setStatusAnnouncement('Recording stopped due to an error.');
                finalizeSession({ reason: 'error' });
            }
        },
        [finalizeSession, scheduleChunkStop]
    );

    const processQueue = useCallback(
        (records: ChunkRecord[]) => {
            if (records.length === 0) return;
            const availableSlots = MAX_CONCURRENT_UPLOADS - activeUploadsRef.current.size;
            if (availableSlots <= 0) return;

            const now = Date.now();
            const candidates = records.filter((chunk) => {
                if (activeUploadsRef.current.has(chunk.id)) {
                    return false;
                }
                if (chunk.status === 'queued') {
                    return true;
                }
                if (chunk.status === 'failed' && chunk.nextRetryAt && chunk.nextRetryAt <= now) {
                    return true;
                }
                return false;
            });

            if (candidates.length === 0) {
                return;
            }

            candidates.slice(0, availableSlots).forEach((chunk) => {
                activeUploadsRef.current.add(chunk.id);
                setChunksAndUpdate((current) =>
                    current.map((record) =>
                        record.id === chunk.id
                            ? {
                                ...record,
                                status: 'uploading',
                                attempts: record.attempts + 1,
                                nextRetryAt: undefined,
                                lastError: undefined,
                            }
                            : record
                    )
                );

                const uploadStartedAt = performance.now();

                // Improved logging before the request
                console.log('[AudioRecorder] Uploading chunk', {
                    id: chunk.id,
                    index: chunk.index,
                    blobSize: chunk.blob.size,
                    blobType: chunk.blob.type,
                    durationMs: chunk.durationMs,
                });

                transcribeAudioChunk(chunk.blob, `${chunk.id}.webm`, {
                    chunkIndex: chunk.index,
                    sessionId: sessionIdRef.current,
                    durationMs: chunk.durationMs,
                    startOffsetMs: chunk.startOffsetMs,
                    endOffsetMs: chunk.endOffsetMs,
                    isFinalChunk: chunk.isFinal,
                })
                    .then((result) => {
                        const transcriptionSeconds = (performance.now() - uploadStartedAt) / 1000;
                        metricsRef.current.chunkCount += 1;
                        metricsRef.current.totalTranscriptionSeconds += transcriptionSeconds;
                        setChunksAndUpdate((current) =>
                            current.map((record) =>
                                record.id === chunk.id
                                    ? {
                                        ...record,
                                        status: 'completed',
                                        transcript: result.text,
                                        hadError: record.hadError,
                                        lastError: undefined,
                                    }
                                    : record
                            )
                        );
                    })
                    .catch((err: Error) => {
                        metricsRef.current.failureCount += 1;
                        console.error('[AudioRecorder] Chunk transcription failed', {
                            chunkId: chunk.id,
                            chunkIndex: chunk.index,
                            error: err.message,
                            responseError: (err as any).responseError,
                        });

                        const nextRetryAt = Date.now() + retryDelayMs;
                        setStatusAnnouncement(`Audio chunk failed to transcribe. Retrying in ${Math.round(retryDelayMs / 1000)}s.`);

                        setChunksAndUpdate((current) =>
                            current.map((record) =>
                                record.id === chunk.id
                                    ? {
                                        ...record,
                                        status: 'failed',
                                        lastError: err.message,
                                        nextRetryAt,
                                        hadError: true,
                                    }
                                    : record
                            )
                        );
                        scheduleRetry(chunk.id, retryDelayMs);
                    })
                    .finally(() => {
                        activeUploadsRef.current.delete(chunk.id);
                    });
            });
        },
        [retryDelayMs, scheduleRetry, setChunksAndUpdate]
    );

    useEffect(() => {
        processQueue(chunks);
    }, [chunks, processQueue]);

    useEffect(() => {
        const timeoutSnapshot = retryTimeoutsRef.current;
        return () => {
            const timeouts = Array.from(timeoutSnapshot.values());
            timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
            timeoutSnapshot.clear();
            clearChunkStopTimeout();
            teardownMedia();
        };
    }, [clearChunkStopTimeout, teardownMedia]);

    useEffect(() => {
        if (!isRecording) {
            return;
        }
        const intervalId = window.setInterval(() => {
            if (startTimestampRef.current) {
                setRecordingDurationMs(Date.now() - startTimestampRef.current);
            }
        }, 250);

        return () => window.clearInterval(intervalId);
    }, [isRecording]);

    useEffect(() => {
        if (!awaitingFinalTranscriptRef.current || finalisedRef.current) {
            return;
        }

        const pending = chunks.some((chunk) => chunk.status !== 'completed');
        if (pending) {
            return;
        }

        const ordered = [...chunks].sort((a, b) => a.index - b.index);
        const transcript = ordered.map((chunk) => chunk.transcript ?? '').join(' ');

        finalizeSession({ orderedChunks: ordered, transcript });
    }, [chunks, finalizeSession]);

    const startRecording = useCallback(async () => {
        if (!isSupported) {
            setError('Audio recording is not supported in this browser.');
            setPermission('unsupported');
            return;
        }
        if (isRecording) {
            return;
        }

        try {
            setError(null);
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setPermission('granted');
            sessionIdRef.current = safeRandomId();
            metricsRef.current.sessions += 1;
            resetSessionMetrics();
            startTimestampRef.current = Date.now();
            stopTimestampRef.current = null;
            setRecordingDurationMs(0);
            chunkIndexRef.current = 0;
            awaitingFinalTranscriptRef.current = false;
            finalisedRef.current = false;
            setChunksAndUpdate(() => []);
            setRecordingBarVisible(true);
            setStatusAnnouncement('Recording started.');
            setIsAwaitingFinal(false);

            streamRef.current = stream;

            const context = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = context;
            const source = context.createMediaStreamSource(stream);
            const analyser = context.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            setAnalyserNode(analyser);

            const mimeType = pickMimeType();
            const recorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;

            chunkStartTimestampRef.current = startTimestampRef.current ?? Date.now();
            pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
            clearChunkStopTimeout();

            recorder.ondataavailable = (event) => {
                if (!event.data || event.data.size === 0) {
                    return;
                }

                const chunkId = `${sessionIdRef.current}-${chunkIndexRef.current}`;
                const now = Date.now();
                const recordingStart = startTimestampRef.current ?? now;
                const chunkStart = chunkStartTimestampRef.current ?? recordingStart;
                const durationMs = Math.max(1, now - chunkStart);
                const startOffsetMs = Math.max(0, chunkStart - recordingStart);
                const endOffsetMs = Math.max(startOffsetMs + durationMs, now - recordingStart);

                setChunksAndUpdate((prev) => [
                    ...prev,
                    {
                        id: chunkId,
                        index: chunkIndexRef.current,
                        blob: event.data,
                        status: 'queued',
                        attempts: 0,
                        durationMs,
                        startOffsetMs,
                        endOffsetMs,
                        isFinal: pendingChunkInfoRef.current.isFinal,
                        hadError: false,
                        createdAt: now,
                    },
                ]);

                chunkIndexRef.current += 1;
                chunkStartTimestampRef.current = null;
            };

            recorder.onstop = () => {
                const { isFinal, shouldRestart } = pendingChunkInfoRef.current;
                const shouldResume = shouldRestart && !isFinal && isRecordingRef.current;
                if (!shouldResume) {
                    clearChunkStopTimeout();
                }
                if (shouldResume) {
                    beginChunkRecording();
                }
                if (!shouldResume) {
                    pendingChunkInfoRef.current = { isFinal: false, shouldRestart: false };
                }
            };

            recorder.onerror = (event) => {
                const error = (event as { error?: DOMException }).error;
                console.error('[AudioRecorder] MediaRecorder error', error ?? event);
                setError(error?.message ?? 'An unexpected audio recording error occurred.');
                setStatusAnnouncement('Recording stopped due to an error.');
                finalizeSession({ reason: 'error' });
            };

            isRecordingRef.current = true;
            setIsRecording(true);
            beginChunkRecording(startTimestampRef.current ?? Date.now());
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unable to start audio recording.';
            console.error('[AudioRecorder] Failed to start recording', err);
            setError(message);
            setPermission('denied');
            setStatusAnnouncement('Microphone permission denied or unavailable.');
        }
    }, [
        beginChunkRecording,
        clearChunkStopTimeout,
        finalizeSession,
        isRecording,
        isSupported,
        resetSessionMetrics,
        setChunksAndUpdate,
    ]);

    const stopRecording = useCallback(() => {
        const recorder = mediaRecorderRef.current;
        if (!recorder) {
            return;
        }
        if (recorder.state === 'inactive' && !isRecordingRef.current) {
            return;
        }
        stopTimestampRef.current = Date.now();
        if (startTimestampRef.current) {
            setRecordingDurationMs(stopTimestampRef.current - startTimestampRef.current);
        }
        isRecordingRef.current = false;
        setIsRecording(false);
        awaitingFinalTranscriptRef.current = true;
        setIsAwaitingFinal(true);
        setChunksAndUpdate((current) => [...current]);
        setStatusAnnouncement('Processing final audio chunk…');
        clearChunkStopTimeout();
        if (recorder.state === 'recording') {
            stopRecorderForChunk({ isFinal: true, shouldRestart: false });
        } else {
            pendingChunkInfoRef.current = { isFinal: true, shouldRestart: false };
        }
    }, [clearChunkStopTimeout, setChunksAndUpdate, stopRecorderForChunk]);

    const toggleRecording = useCallback(() => {
        if (isRecording) {
            stopRecording();
        } else {
            void startRecording();
        }
    }, [isRecording, startRecording, stopRecording]);

    const retryPendingChunks = useCallback(() => {
        metricsRef.current.retryCount += 1;
        setChunksAndUpdate((current) =>
            current.map((chunk) => {
                if (chunk.hadError && chunk.status !== 'completed') {
                    clearRetryTimeout(chunk.id);
                    return {
                        ...chunk,
                        status: 'queued',
                        nextRetryAt: undefined,
                    };
                }
                return chunk;
            })
        );
        setStatusAnnouncement('Retrying queued audio chunks now.');
    }, [clearRetryTimeout, setChunksAndUpdate]);

    const completedChunks = useMemo(() => chunks.filter((chunk) => chunk.status === 'completed').length, [chunks]);
    const totalChunks = chunks.length;
    const connectivity = useMemo<ConnectivityState>(() => {
        const issueChunks = chunks.filter((chunk) => chunk.hadError && chunk.status !== 'completed');
        const queuedCount = issueChunks.filter((chunk) => chunk.status !== 'uploading').length;
        return {
            issueCount: issueChunks.length,
            queuedCount,
            retryInSeconds,
        };
    }, [chunks, retryInSeconds]);

    const isProcessing = useMemo(() => {
        if (isRecording) return false;
        if (isAwaitingFinal) return true;
        if (totalChunks === 0) return false;
        return completedChunks < totalChunks;
    }, [completedChunks, isAwaitingFinal, isRecording, totalChunks]);

    return {
        isSupported,
        permission,
        isRecording,
        isRecordingBarVisible,
        isProcessing,
        analyserNode,
        recordingDurationMs,
        connectivity,
        totalChunks,
        completedChunks,
        statusAnnouncement,
        error,
        startRecording,
        stopRecording,
        toggleRecording,
        retryPendingChunks,
    };
}


```

I have removed the duplicate variable declaration that was causing the build to fail. I also corrected a reference to the removed variable to ensure the logic remains correct.

This should resolve the build error. Please try running the build again.

---

**User**

 Okay, so we have a working version and that is poll number 187. But when we attempt to try to initiate a merge, that working version, it breaks the bill and we end up with a reference error is final chunk pending is not defined and that prevents it from actually loading the page so we're going to need to do I mean really this is a bit integral but it has something this is very much like get situation. It accepted the merge. Well first of all we ended up with a merge that had a conflict and we already identified what that was. Then we went through that, attempted to try to fix it and then you saw well okay we ended up with this problem. That pushing the commit that you just gave or pushing the change that you just made resolved in an error where the UI didn't, where the recording error recurred again so that it didn't give us anything back which means that it wasn't the one that we had originally tried to commit in the first place so I went back and re-merged 187 and now we're getting in this situation So the goal is just to take what build number 187 is, which is working and good and it's fine. We just want 100% of what that build is, that pull.
 and we want 100% of that in our current main branch. That's all. So you'll need to use git actions and you'll need to use the git token, the gh token, in order to retrieve what's taking place there successfully and see what that is. and then make the appropriate attenuation here so that we have that and that's the fully or actually there really so we have that fully committed now attempting to merge it again elicited this issue so we really don't want to merge i guess what we would want something more akin to whatever the appropriate terminology would be - overwrite? But first, don't do anything. Just undertstand what happened and tell me.

---

**Cursor**

You have perfectly summarized a frustrating and unfortunately common Git scenario. Here is my understanding of what happened.

### My Understanding of the Situation

1.  **Known Good State:** You had a pull request, #187, which contained a fully functional version of the audio chunking fix ("Change C"). Everything in that PR worked as expected.

2.  **Problematic Merge:** When merging PR #187 into `main`, a conflict occurred. Our initial attempts to resolve this conflict were flawed. The first fix I provided caused a build error (`isFinalChunk has already been declared`), and the second fix, while resolving the build error, inadvertently re-introduced the original audio recording bug. Neither of these states was correct.

3.  **The Current Error:** In an attempt to get back to the known-good state of PR #187, another merge or commit was made. However, this action appears to have resulted in an incomplete or "broken" merge. The error you're seeing now, `ReferenceError: isFinalChunkPending is not defined`, is a classic symptom of this. It means that some parts of the new code from PR #187 (specifically, code that *uses* the `isFinalChunkPending` state) were successfully added to the `main` branch, but the line of code that actually *declares* that state (`const [isFinalChunkPending, setIsFinalChunkPending] = useState(false);`) was lost in the merge.

**In short, your `main` branch is currently in a corrupted state, containing a partial and non-functional hybrid of the old code and the new fix.**

### The Goal Moving Forward

Your objective is crystal clear: you want to **discard the current, broken state of the `main` branch and replace it entirely with the known-good, working code from pull request #187.**

You are correct that a standard "merge" is no longer the right tool for this job. We are not trying to combine two histories; we are trying to force one history (`main`) to adopt the exact state of another (`#187`). You used the term "overwrite," which is the perfect way to describe the desired outcome.

I understand the situation completely and agree with your assessment. The next step is to execute this "overwrite" operation carefully to restore the `main` branch to a healthy, working state.

---

**User**

 Okay, so that's what we need to do. Now, your ability to execute git operations is lacking. You attempt to and believe that you know what you're doing, but you really don't. So what we're going to do is we're going to do this in another thread, which means that you're going to need to provide now a prompt that contains the appropriate token and the understanding of what to do and why, but not necessarily too much on how. And then I'll return back to you here with feedback from that better executor AI.

---

**Cursor**

Understood. Here is a clear, concise, and comprehensive prompt designed for an AI with robust Git execution capabilities. It explains the "what" and "why" and provides the necessary authorization, leaving the "how" to the expert executor.

***

### Prompt for Git Execution Agent: Overwrite `main` with PR #187

**Authorization:**
*   **GitHub Token:** `${env:GH_TOKEN}`

**Context:**
Our `main` branch is currently in a broken, non-buildable state due to a faulty merge resolution. We have a pull request, **#187**, which contains the exact, known-good code that we want `main` to have.

**Objective:**
The goal is to make the `main` branch a perfect mirror of the code in pull request #187. This is not a standard merge; it is an **overwrite** operation. We need to discard the current broken commits on `main` and replace them with the correct history from the PR.

**Directive:**
1.  Identify the exact commit hash of the HEAD of the branch associated with pull request #187.
2.  Force the `main` branch to reset to that specific commit hash.
3.  Force-push the newly reset `main` branch to the remote origin to overwrite the incorrect history.
4.  Confirm that the remote `main` branch's HEAD is now identical to the HEAD of PR #187.

