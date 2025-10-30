<!-- Baseball 10/29/2025: Blue Jays vs Dodgers - 6-1 Blue Jays - World Series Game 5, Toronto leads series 3-2 -->

# LifeCurrents Monorepo

A unified repository for the LifeCurrents application - a Vite/React/TypeScript SPA that helps users connect near-term actions to long-term goals through a causal objective graph and AI agent.

## 🏗️ Project Structure

```
lifecurrents-monorepo/
├── packages/
│   ├── frontend/          # React SPA (Vite + TypeScript)
│   │   ├── src/           # Application source code
│   │   ├── public/        # Static assets
│   │   └── package.json   # Frontend dependencies
│   │
│   └── worker/            # Cloudflare Worker (MCP Server)
│       ├── src/           # Worker source code
│       └── package.json   # Worker dependencies
│
├── supabase/              # Database migrations and config
│   ├── migrations/        # SQL migration files
│   └── config.toml        # Supabase configuration
│
├── synced_files/          # Synchronized data files
│   ├── graph_data.json    # Graph state
│   └── system_instructions/ # AI system prompts
│
├── scripts/               # Utility scripts
├── package.json           # Root workspace configuration
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd lifecurrents-monorepo
   ```

2. Install dependencies for all packages:
   ```bash
   npm install
   ```

## 📦 Available Scripts

### Development

- **`npm run dev`** - Start the frontend development server
- **`npm run dev:worker`** - Start the worker development server (wrangler dev)
- **`npm run dev:all`** - Run both frontend and worker concurrently

### Building

- **`npm run build`** - Build both frontend and worker
- **`npm run build:frontend`** - Build only the frontend
- **`npm run build:worker`** - Deploy the worker to Cloudflare

### Database Operations

- **`npm run db:push`** - Push local migrations to Supabase
- **`npm run db:pull`** - Pull schema from Supabase
- **`npm run db:types`** - Generate TypeScript types from database schema
- **`npm run db:deploy`** - Push migrations and regenerate types

### Other

- **`npm run lint`** - Lint the frontend code
- **`npm run preview`** - Preview the production build

## 🔧 Workspace Commands

You can run commands in specific packages using:

```bash
npm run <script> --workspace=@lifecurrents/frontend
npm run <script> --workspace=@lifecurrents/worker
```

Or navigate to the package directory:

```bash
cd packages/frontend
npm run dev

cd packages/worker
npm run dev
```

## 🌐 Deployment

### Frontend (Cloudflare Pages)

The frontend is deployed to Cloudflare Pages. Configure your project in the Cloudflare dashboard:

- **Build command:** `npm run build:frontend`
- **Build output directory:** `packages/frontend/dist`
- **Root directory:** Leave empty (builds from root)

### Worker (Cloudflare Worker)

The worker is deployed separately using Wrangler:

```bash
npm run build:worker
```

Or from the worker directory:

```bash
cd packages/worker
npm run deploy
```

## 🗄️ Database

The project uses Supabase for data persistence. All migrations are stored in `supabase/migrations/`.

### Working with Migrations

```bash
# Create a new migration
cd supabase
npx supabase migration new <migration_name>

# Apply migrations
npm run db:push

# Generate TypeScript types
npm run db:types
```

## 📝 Architecture

### Frontend
- **Framework:** React 18 with Vite
- **UI Library:** shadcn/ui with Radix UI primitives
- **Styling:** Tailwind CSS
- **Graph Visualization:** React Flow (@xyflow/react)
- **State Management:** React Context + TanStack Query
- **Routing:** React Router v6

### Worker
- **Runtime:** Cloudflare Workers
- **Protocol:** Model Context Protocol (MCP)
- **Database:** Supabase (server-side only)
- **API Endpoints:**
  - `/mcp` - MCP tool calls
  - `/sse` - Server-sent events for streaming
  - `/api/transcribe` - Audio transcription via Groq Whisper

### Key Features
- **Agentic Control:** AI is the primary mutation path for the graph
- **Explicit Subgraphing:** Enforced via mandatory `graph` field
- **Day-based Navigation:** `viewedDate` as app-wide source of truth
- **PWA Support:** Progressive web app capabilities
- **Audio Transcription:** Worker proxies Groq Whisper API

## 🔐 Environment Variables

### Frontend
Create `packages/frontend/.env.local`:
```env
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

### Worker
Create `packages/worker/.dev.vars`:
```env
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
GROQ_API_KEY=<your-groq-api-key>
```

## 🤝 Contributing

This is a monorepo managed with npm workspaces. When making changes:

1. Make changes in the appropriate package
2. Test locally using `npm run dev` or `npm run dev:all`
3. Run linting: `npm run lint`
4. Commit your changes
5. The auto-sync script will handle pushing to GitHub

## 📄 License

[Your License Here]

## 📧 Contact

[Your Contact Information]
