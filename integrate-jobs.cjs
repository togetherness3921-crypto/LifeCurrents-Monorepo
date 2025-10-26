const { exec } = require('child_process');

// --- ANSI Color Codes ---
const colors = {
  reset: '\x1b[0m',
  purple: '\x1b[35m',
  green: '\x1b[32m',
  red: '\x1b[31m',
};

// Get commit message from command line args or use default
const jobTitles = process.argv.slice(2).join(', ') || 'completed jobs';
const commitMessage = `Integrate: ${jobTitles}`;

console.log(`${colors.purple}[INTEGRATE]${colors.reset} 🔄 Integrating jobs...`);
console.log(`${colors.purple}[INTEGRATE]${colors.reset} 📝 Commit message: "${commitMessage}"`);

exec('git add --all && git commit -m "' + commitMessage + '" --quiet', (commitError) => {
  if (commitError && !commitError.message.includes('nothing to commit')) {
    console.error(`${colors.red}[INTEGRATE]${colors.reset} ❌ Commit failed:`, commitError.message);
    process.exit(1);
  }

  console.log(`${colors.purple}[INTEGRATE]${colors.reset} 🚀 Pushing to GitHub...`);
  exec('git push origin main', (pushError) => {
    if (pushError) {
      console.error(`${colors.red}[INTEGRATE]${colors.reset} ❌ Push failed:`, pushError.message);
      process.exit(1);
    }
    
    console.log(`${colors.green}[INTEGRATE]${colors.reset} ✅ Integration complete!`);
    process.exit(0);
  });
});

