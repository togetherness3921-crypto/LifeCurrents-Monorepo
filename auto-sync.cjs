const { exec } = require('child_process');
const chokidar = require('chokidar');

console.log('[MONOREPO] 🚀 Auto-Sync: Most Recent Changes Win');
let isSyncing = false;

// --- Sync Function: Most Recent Wins ---
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
console.log('[MONOREPO] Monitoring files and checking remote every 15s...');

process.on('SIGINT', () => {
  console.log('\n[MONOREPO] 👋 Stopped.');
  watcher.close();
  process.exit(0);
});
