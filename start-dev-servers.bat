@echo off
ECHO Starting local development servers...

ECHO Starting Cloudflare Worker...
REM The "start" command runs the following command in a new window.
start "Cloudflare Worker" npm run dev --workspace=packages/worker -- --port 8787

ECHO Starting Python Dashboard...
REM We provide a title for the new window and then the command to execute.
REM The "cmd /k" will keep the window open if the script crashes.
start "Python Dashboard" cmd /k "packages\\dashboard-py\\venv\\Scripts\\python.exe packages\\dashboard-py\\main.py"

ECHO Starting Job Dispatcher MCP Server...
start "MCP Server" node packages\\mcp-server\\build\\index.js

ECHO All three services have been launched in separate windows.
