const { exec, spawn } = require('child_process');
const chokidar = require('chokidar');
const path = require('path');

console.log('[MONOREPO] 🚀 Auto-Sync: Most Recent Changes Win + Dev Services');
let isSyncing = false;
let viteProcess = null;
let supabaseProcess = null;

// --- Vite Dev Server ---
function startVite() {
  console.log('[MONOREPO] 🎨 Starting Vite dev server...');
  viteProcess = spawn('npm', ['run', 'dev', '--workspace=@lifecurrents/frontend'], {
    stdio: 'inherit',
    shell: true,
  });

  viteProcess.on('error', (error) => {
    console.error('[MONOREPO] ❌ Vite error:', error);
  });

  viteProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[MONOREPO] ⚠️ Vite exited with code ${code}`);
    }
  });
}

// --- Supabase Sync ---
function startSupabaseSync() {
  console.log('[MONOREPO] 🗄️  Starting Supabase sync...');
  const syncScriptPath = path.join(__dirname, 'scripts', 'supabase-sync.js');

  supabaseProcess = spawn('node', [syncScriptPath], {
    stdio: 'inherit',
    shell: true,
  });

  supabaseProcess.on('error', (error) => {
    console.error('[MONOREPO] ❌ Supabase sync error:', error);
  });

  supabaseProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[MONOREPO] ⚠️ Supabase sync exited with code ${code}`);
    }
  });
}

// --- Git Sync Function: Most Recent Wins ---
function sync() {
  if (isSyncing) return;
  isSyncing = true;

  console.log('[MONOREPO] 🔄 Pulling remote changes (remote wins conflicts)...');
  exec('git pull --strategy-option=theirs origin main', (pullError) => {
    if (pullError && !pullError.message.includes('up to date')) {
      console.warn('[MONOREPO] ⚠️ Pull completed with warnings:', pullError.message);
    }

    console.log('[MONOREPO] 📝 Committing local changes...');
    exec('git add --all && git commit -m "Auto-sync" --quiet', (commitError) => {
      // Ignore "nothing to commit" errors

      console.log('[MONOREPO] 🚀 Pushing to GitHub...');
      exec('git push origin main', (pushError) => {
        if (pushError) {
          console.error('[MONOREPO] ❌ Push failed:', pushError.message);
        } else {
          console.log('[MONOREPO] ✅ Sync complete!');
        }
        isSyncing = false;
      });
    });
  });
}

// --- File Watcher ---
const watcher = chokidar.watch('.', {
  ignored: [
    /node_modules/,
    /\.git/,
    /dist/,
    /\.wrangler/,
    /playwright-user-profile/,
    /\.supabase/,
  ],
  ignoreInitial: true,
});

let syncTimeout;
watcher.on('all', (event, path) => {
  console.log(`[MONOREPO] 📝 Change: ${path}`);
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(sync, 3000);
});

// --- Periodic Sync (every 15 seconds) ---
setInterval(sync, 15000);

// --- Cleanup Handler ---
function cleanup() {
  console.log('\n[MONOREPO] 👋 Shutting down...');
  watcher.close();

  if (viteProcess) {
    console.log('[MONOREPO] 🛑 Stopping Vite...');
    viteProcess.kill();
  }

  if (supabaseProcess) {
    console.log('[MONOREPO] 🛑 Stopping Supabase sync...');
    supabaseProcess.kill();
  }

  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// --- Initialize ---
console.log('[MONOREPO] 🚀 Initializing services...');
startVite();
startSupabaseSync();
console.log('[MONOREPO] 📁 Monitoring files and checking remote every 15s...');
console.log('[MONOREPO] Press Ctrl+C to stop all services.');
