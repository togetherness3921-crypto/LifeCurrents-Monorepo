# LifeCurrents Monorepo Migration Guide

## ✅ Migration Completed

The LifeCurrents codebase has been successfully unified into a monorepo structure. This document provides the remaining manual steps and important information.

## 📂 New Repository Structure

```
lifecurrents-monorepo/
├── packages/
│   ├── frontend/          # React SPA (previously root-level)
│   └── worker/            # Cloudflare Worker (previously remote-mcp-server-authless/)
├── supabase/              # Database migrations
├── synced_files/          # Synchronized data
├── scripts/               # Utility scripts
├── package.json           # Root workspace configuration
├── auto-sync.cjs          # Auto-sync automation (updated for monorepo)
└── README.md              # Comprehensive documentation
```

## 🔄 What Has Been Done

1. ✅ Created `packages/frontend/` directory with all frontend code
2. ✅ Created `packages/worker/` directory with all worker code
3. ✅ Created root-level `package.json` with npm workspaces configuration
4. ✅ Updated `auto-sync.cjs` to work with the monorepo structure
5. ✅ Updated `.gitignore` for monorepo patterns
6. ✅ Created comprehensive `README.md` with usage instructions
7. ✅ All files committed and ready to push

## 📋 Remaining Manual Steps

### Step 1: Create New GitHub Repository

**Option A: Using GitHub Web Interface**
1. Go to https://github.com/new
2. Repository name: `LifeCurrents-Monorepo` (or your preferred name)
3. Description: "Unified monorepo for LifeCurrents frontend and worker"
4. Visibility: Public (or Private as preferred)
5. **DO NOT** initialize with README, .gitignore, or license
6. Click "Create repository"

**Option B: Using GitHub CLI**
```bash
gh repo create LifeCurrents-Monorepo --public --source=. --remote=origin --push
```

**Option C: Using Git Commands (after creating repo on GitHub)**
```bash
git remote add origin https://github.com/YOUR_USERNAME/LifeCurrents-Monorepo.git
git branch -M main
git push -u origin main
```

### Step 2: Configure Cloudflare Pages

After pushing the code to GitHub, you must reconfigure your Cloudflare Pages project to point to the new repository.

#### 2.1 Update Frontend Deployment

1. Log in to your Cloudflare Dashboard
2. Navigate to **Pages** → Select your project (or create new one)
3. Go to **Settings** → **Builds & deployments**
4. Update the following settings:

   **Build Configuration:**
   - **Framework preset:** None (or select Vite if available)
   - **Build command:** `npm install && npm run build:frontend`
   - **Build output directory:** `packages/frontend/dist`
   - **Root directory:** Leave empty (builds from root)
   
   **Environment Variables:**
   - `NODE_VERSION`: `18`
   - Add any other frontend environment variables

5. Click **Save**

#### 2.2 Update Worker Deployment

The worker should continue to be deployed using Wrangler CLI:

```bash
cd packages/worker
npm run deploy
```

**Or from the root:**
```bash
npm run build:worker
```

### Step 3: Verify Deployments

1. **Test Frontend:**
   - Wait for Cloudflare Pages build to complete
   - Visit your Pages URL to verify the frontend loads correctly
   - Test MCP tool calls to ensure frontend-worker communication works

2. **Test Worker:**
   - Verify MCP endpoints respond: `/mcp`, `/sse`
   - Test transcription endpoint: `/api/transcribe`
   - Check Cloudflare Worker logs for any errors

### Step 4: Update Development Workflow

**Install Dependencies:**
```bash
# From root (installs for all packages)
npm install
```

**Development:**
```bash
# Run frontend only
npm run dev

# Run worker only
npm run dev:worker

# Run both simultaneously
npm run dev:all
```

**Building:**
```bash
# Build both
npm run build

# Build frontend only
npm run build:frontend

# Deploy worker
npm run build:worker
```

## 🔧 Configuration Files Updated

### Root `package.json`
- Added workspaces configuration
- Added monorepo-wide scripts
- Supports running commands in specific packages

### `auto-sync.cjs`
- Updated logging to include `[MONOREPO]` prefix
- Watches all packages for changes
- Ignores `node_modules` in all package directories

### `.gitignore`
- Updated to handle multiple `node_modules/` directories
- Ignores `dist/` in all packages
- Ignores `.wrangler/` for worker development

## 📊 Repository Comparison

### Before (Two Repositories)

```
LifeCurrents/                    remote-mcp-server-authless/
├── src/                         ├── src/
├── pages/                       ├── test files
├── components/                  ├── wrangler.jsonc
├── vite.config.ts               └── package.json
└── package.json
```

### After (Unified Monorepo)

```
lifecurrents-monorepo/
├── packages/
│   ├── frontend/     # Complete LifeCurrents SPA
│   └── worker/       # Complete MCP server
├── supabase/         # Shared database config
└── package.json      # Workspace manager
```

## 🎯 Benefits of Monorepo Structure

1. **Atomic Deployments:** Frontend and worker changes are always in sync
2. **Simplified Dependencies:** Shared dependencies managed at root level
3. **Single Source of Truth:** One repository to clone, one version history
4. **Improved CI/CD:** Build both projects from single pipeline
5. **Easier Development:** Work on full stack in one place

## 🚨 Important Notes

### Path Changes

If you have any hardcoded paths in your codebase, they may need updating:

**Old:**
```
./src/components/...
./services/...
```

**New:**
```
./packages/frontend/src/components/...
./packages/frontend/src/services/...
```

### Auto-Sync Behavior

The `auto-sync.cjs` script now monitors the entire monorepo. It will:
- Watch for changes in both frontend and worker
- Automatically commit and push changes every 15 seconds
- Use "theirs" strategy for merge conflicts (remote wins)

### Database Migrations

Database operations remain unchanged:
```bash
npm run db:push    # Apply migrations
npm run db:types   # Generate TypeScript types
npm run db:deploy  # Push + generate types
```

## 🔗 Additional Resources

- **Frontend README:** `packages/frontend/README.md` (if exists)
- **Worker README:** `packages/worker/README.md`
- **Supabase Docs:** https://supabase.com/docs
- **Cloudflare Pages:** https://developers.cloudflare.com/pages
- **Cloudflare Workers:** https://developers.cloudflare.com/workers

## ✉️ Support

If you encounter issues during migration:
1. Check that all dependencies are installed: `npm install`
2. Verify git remote is configured: `git remote -v`
3. Ensure Cloudflare configuration matches this guide
4. Check Cloudflare build logs for specific errors

---

**Migration Completed:** October 20, 2025
**Structure Version:** 1.0.0

