const { exec, spawn } = require('child_process');
const chokidar = require('chokidar');
const path = require('path');

// --- ANSI Color Codes ---
const colors = {
  reset: '\x1b[0m',
  purple: '\x1b[35m',  // Monorepo/Git
  blue: '\x1b[34m',    // Vite
  green: '\x1b[32m',   // Supabase
  yellow: '\x1b[33m',  // Warnings
  red: '\x1b[31m',     // Errors
  cyan: '\x1b[36m',    // Info
};

console.log(`${colors.purple}[MONOREPO]${colors.reset} 🚀 Auto-Sync: Most Recent Changes Win + Dev Services`);
let isSyncing = false;
let viteProcess = null;
let supabaseProcess = null;

// --- Vite Dev Server ---
function startVite() {
  console.log(`${colors.blue}[VITE]${colors.reset} 🎨 Starting Vite dev server...`);
  viteProcess = spawn('npm', ['run', 'dev'], {
    cwd: path.join(__dirname, 'packages', 'frontend'),
    stdio: 'inherit',
    shell: true,
  });

  viteProcess.on('error', (error) => {
    console.error(`${colors.red}[VITE]${colors.reset} ❌ Error:`, error);
  });

  viteProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`${colors.yellow}[VITE]${colors.reset} ⚠️ Exited with code ${code}`);
    }
  });
}

// --- Supabase Sync ---
function startSupabaseSync() {
  console.log(`${colors.green}[SUPABASE]${colors.reset} 🗄️  Starting Supabase sync...`);
  const syncScriptPath = path.join(__dirname, 'scripts', 'supabase-sync.js');

  supabaseProcess = spawn('node', [syncScriptPath], {
    stdio: 'inherit',
    shell: true,
  });

  supabaseProcess.on('error', (error) => {
    console.error(`${colors.red}[SUPABASE]${colors.reset} ❌ Error:`, error);
  });

  supabaseProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`${colors.yellow}[SUPABASE]${colors.reset} ⚠️ Exited with code ${code}`);
    }
  });
}

// --- Git Sync Function: Most Recent Wins ---
function sync() {
  if (isSyncing) return;
  isSyncing = true;

  console.log(`${colors.purple}[MONOREPO]${colors.reset} 🔄 Pulling remote changes (remote wins conflicts)...`);
  exec('git pull --strategy-option=theirs origin main', (pullError) => {
    if (pullError && !pullError.message.includes('up to date')) {
      console.warn(`${colors.yellow}[MONOREPO]${colors.reset} ⚠️ Pull completed with warnings:`, pullError.message);
    }

    console.log(`${colors.purple}[MONOREPO]${colors.reset} 📝 Committing local changes...`);
    exec('git add --all && git commit -m "Auto-sync" --quiet', (commitError) => {
      // Ignore "nothing to commit" errors

      console.log(`${colors.purple}[MONOREPO]${colors.reset} 🚀 Pushing to GitHub...`);
      exec('git push origin main', (pushError) => {
        if (pushError) {
          console.error(`${colors.red}[MONOREPO]${colors.reset} ❌ Push failed:`, pushError.message);
        } else {
          console.log(`${colors.purple}[MONOREPO]${colors.reset} ✅ Sync complete!`);
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
  console.log(`${colors.cyan}[MONOREPO]${colors.reset} 📝 Change: ${path}`);
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(sync, 3000);
});

// --- Periodic Sync (every 15 seconds) ---
setInterval(sync, 15000);

// --- Cleanup Handler ---
function cleanup() {
  console.log(`\n${colors.purple}[MONOREPO]${colors.reset} 👋 Shutting down...`);
  watcher.close();

  if (viteProcess) {
    console.log(`${colors.blue}[VITE]${colors.reset} 🛑 Stopping Vite...`);
    viteProcess.kill();
  }

  if (supabaseProcess) {
    console.log(`${colors.green}[SUPABASE]${colors.reset} 🛑 Stopping Supabase sync...`);
    supabaseProcess.kill();
  }

  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// --- Initialize ---
console.log(`${colors.cyan}[MONOREPO]${colors.reset} 🚀 Initializing services...`);
startVite();
startSupabaseSync();
console.log(`${colors.cyan}[MONOREPO]${colors.reset} 📁 Monitoring files and checking remote every 15s...`);
console.log(`${colors.cyan}[MONOREPO]${colors.reset} Press Ctrl+C to stop all services.`);
