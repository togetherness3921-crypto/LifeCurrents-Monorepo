# Cloudflare Pages Configuration for Monorepo

## 🎯 Quick Setup Guide

Your monorepo is now live at:
**https://github.com/togetherness3921-crypto/LifeCurrents-Monorepo**

Follow these steps to complete the deployment configuration:

---

## Step 1: Configure Cloudflare Pages

### Option A: Create New Project (Recommended)

1. Go to [Cloudflare Pages Dashboard](https://dash.cloudflare.com/?to=/:account/pages)
2. Click **"Create a project"**
3. Click **"Connect to Git"**
4. Select your **LifeCurrents-Monorepo** repository
5. Configure build settings:

```
Framework preset: None (or Vite if available)
Build command: npm install && npm run build:frontend
Build output directory: packages/frontend/dist
Root directory: (leave empty)
Branch: main
```

6. Add environment variables (click **"Add variable"**):
   - `NODE_VERSION` = `18`
   - `VITE_SUPABASE_URL` = `your_supabase_url`
   - `VITE_SUPABASE_ANON_KEY` = `your_anon_key`

7. Click **"Save and Deploy"**

### Option B: Update Existing Project

If you already have a Cloudflare Pages project:

1. Go to your [Cloudflare Pages Dashboard](https://dash.cloudflare.com/?to=/:account/pages)
2. Select your existing project
3. Go to **Settings** → **Builds & deployments**
4. Click **"Configure Production deployments"**
5. Update the repository to: **LifeCurrents-Monorepo**
6. Update build settings:
   - **Build command:** `npm install && npm run build:frontend`
   - **Build output directory:** `packages/frontend/dist`
   - **Root directory:** Leave empty
7. Save changes
8. Go to **Settings** → **Environment variables**
9. Ensure these are set:
   - `NODE_VERSION` = `18`
   - Add any other frontend env vars
10. Trigger a new deployment

---

## Step 2: Verify Frontend Deployment

After deployment completes (usually 2-5 minutes):

1. Click on the deployment URL provided by Cloudflare
2. Verify the app loads correctly
3. Test basic functionality:
   - Graph visualization renders
   - Chat interface loads
   - Can create/modify nodes (if applicable)

---

## Step 3: Deploy Worker

The Cloudflare Worker needs to be deployed separately using Wrangler:

### From the root directory:
```bash
npm run build:worker
```

### Or from the worker directory:
```bash
cd packages/worker
npm run deploy
```

### Environment Variables for Worker

Make sure `packages/worker/.dev.vars` exists with:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GROQ_API_KEY=your_groq_api_key
```

For production, set these in Cloudflare Dashboard:
1. Go to [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers)
2. Select your worker
3. Go to **Settings** → **Variables**
4. Add the environment variables as **Secrets**

---

## Step 4: Test Integration

### Test MCP Endpoints

Your worker should respond at these endpoints:
- `/mcp` - MCP tool calls
- `/sse` - Server-sent events
- `/api/transcribe` - Audio transcription

### Test Frontend-Worker Communication

1. Open the deployed frontend
2. Open browser DevTools → Console
3. Try using the chat to interact with the AI
4. Verify tool calls are being sent to the worker
5. Check that graph modifications work

---

## 🔄 Development Workflow

### Local Development

```bash
# Install all dependencies
npm install

# Run frontend and worker together
npm run dev:all

# Or run separately
npm run dev          # Frontend only
npm run dev:worker   # Worker only
```

### Making Changes

```bash
# Work in either package
cd packages/frontend  # Frontend changes
cd packages/worker    # Worker changes

# Commit from root
git add .
git commit -m "Your changes"
git push origin main
```

The `auto-sync.cjs` script can also automatically push changes every 15 seconds if running:
```bash
node auto-sync.cjs
```

---

## 📊 Deployment Pipeline

```
GitHub Push
    ↓
Cloudflare Pages (automatic)
    → Builds: npm run build:frontend
    → Deploys: packages/frontend/dist

Worker (manual)
    → Deploy: npm run build:worker
    → or: cd packages/worker && npm run deploy
```

---

## ✅ Verification Checklist

- [ ] GitHub repository accessible: https://github.com/togetherness3921-crypto/LifeCurrents-Monorepo
- [ ] Cloudflare Pages project configured with correct build settings
- [ ] Environment variables set for frontend (NODE_VERSION, VITE_*)
- [ ] Frontend deployment successful and site loads
- [ ] Worker deployed via Wrangler
- [ ] Worker environment variables/secrets configured
- [ ] Frontend can communicate with worker (MCP calls work)
- [ ] Database connections working (both frontend and worker)
- [ ] Audio transcription working (if applicable)

---

## 🚨 Troubleshooting

### Build Fails on Cloudflare

**Error:** "Cannot find module 'X'"
- **Solution:** Ensure `NODE_VERSION=18` is set in environment variables
- **Solution:** Check build command includes `npm install`

**Error:** "Build output not found"
- **Solution:** Verify build output directory is exactly `packages/frontend/dist`

### Worker Deployment Fails

**Error:** "Authentication failed"
- **Solution:** Run `wrangler login` from `packages/worker/`
- **Solution:** Check you're logged into the correct Cloudflare account

### Frontend Can't Connect to Worker

**Error:** "Network error" or "CORS error"
- **Solution:** Verify worker is deployed and accessible
- **Solution:** Check worker URL in frontend config matches deployment
- **Solution:** Ensure worker CORS settings allow frontend domain

### Database Connection Issues

**Error:** "Invalid API key" or "Connection refused"
- **Solution:** Verify Supabase credentials in environment variables
- **Solution:** Check service role key is set for worker (not anon key)
- **Solution:** Ensure Supabase project is active and accessible

---

## 📚 Additional Resources

- **Monorepo README:** [`README.md`](./README.md)
- **Migration Guide:** [`MIGRATION_GUIDE.md`](./MIGRATION_GUIDE.md)
- **Cloudflare Pages Docs:** https://developers.cloudflare.com/pages
- **Cloudflare Workers Docs:** https://developers.cloudflare.com/workers
- **Wrangler CLI Docs:** https://developers.cloudflare.com/workers/wrangler

---

## 🎉 Success!

Once all steps are complete, your unified monorepo deployment is live and operational. Both frontend and worker are deployed from a single source of truth, ensuring consistency and easier maintenance going forward.

**Repository:** https://github.com/togetherness3921-crypto/LifeCurrents-Monorepo

