@echo off
ECHO Starting LifeCurrents Development Environment...

REM This single command starts the Python dashboard, which in turn
REM launches the Cloudflare Worker and MCP Server as subprocesses.
REM Closing the main dashboard window will automatically terminate all services.
start "LifeCurrents Dashboard" cmd /k "packages\\dashboard-py\\venv\\Scripts\\python.exe packages\\dashboard-py\\main.py"

ECHO Main application window launched.
