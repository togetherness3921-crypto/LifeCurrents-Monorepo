# Claude Code Tools - Complete Reference

## Enabled Tools in Our Workflow

The following tools are now enabled in `.github/workflows/claude-dispatch.yml` for all dispatched jobs:

### File Editing Tools

#### `Edit`
**Purpose:** Edit existing files with search/replace operations
**Use Case:** Making targeted changes to specific parts of a file
**Example:** Changing a function implementation, updating a component

#### `Replace`
**Purpose:** Replace text across files (like find/replace)
**Use Case:** Renaming variables, updating import paths, bulk changes
**Example:** Renaming a function across the entire codebase

#### `MultiEdit`
**Purpose:** Edit multiple files simultaneously in a single operation
**Use Case:** Coordinated changes across related files
**Example:** Updating an interface and all its implementations at once

#### `Write`
**Purpose:** Create new files or completely overwrite existing ones
**Use Case:** Generating new components, creating configuration files
**Example:** Creating a new React component file

### File Navigation & Search Tools

#### `Read`
**Purpose:** Read file contents
**Use Case:** Understanding existing code before making changes
**Example:** Reading a configuration file to understand structure

#### `LS` (List)
**Purpose:** List directory contents
**Use Case:** Exploring project structure, finding files
**Example:** Listing all components in a directory

#### `Glob`
**Purpose:** Find files matching a pattern
**Use Case:** Locating all files of a certain type or name
**Example:** Finding all `.tsx` files, all test files

#### `Grep`
**Purpose:** Search for text within files
**Use Case:** Finding where a function is used, locating imports
**Example:** Searching for all usages of a specific API call

### Command Execution

#### `Bash`
**Purpose:** Execute shell commands
**Use Case:** Running build scripts, installing dependencies, running tests
**Example:** `npm install`, `npm test`, `git status`
**Note:** We allow all bash commands. Can be restricted to specific commands like `Bash(npm install)` if desired

### Web Capabilities (Newly Enabled) 🆕

#### `WebSearch`
**Purpose:** Search the web for information
**Use Case:** Looking up API documentation, finding solutions to errors, researching best practices
**Example:** "Search for React 18 useEffect cleanup patterns"
**Why Disabled by Default:** Security (prevents data exfiltration)
**Why We Enabled It:** Claude Code can research documentation and solutions while working

#### `WebFetch`
**Purpose:** Fetch content from specific URLs
**Use Case:** Reading documentation, downloading examples, checking API specs
**Example:** Fetching the latest API documentation from a URL
**Why Disabled by Default:** Security (prevents arbitrary web requests)
**Why We Enabled It:** Claude Code can access official documentation directly

---

## Tool Capabilities Summary

| Tool | Create Files | Edit Files | Search Files | Run Commands | Web Access |
|------|--------------|------------|--------------|--------------|------------|
| Edit | ❌ | ✅ | ❌ | ❌ | ❌ |
| Replace | ❌ | ✅ | ❌ | ❌ | ❌ |
| MultiEdit | ❌ | ✅ | ❌ | ❌ | ❌ |
| Write | ✅ | ✅ | ❌ | ❌ | ❌ |
| Read | ❌ | ❌ | ✅ | ❌ | ❌ |
| LS | ❌ | ❌ | ✅ | ❌ | ❌ |
| Glob | ❌ | ❌ | ✅ | ❌ | ❌ |
| Grep | ❌ | ❌ | ✅ | ❌ | ❌ |
| Bash | ✅* | ✅* | ✅* | ✅ | ❌ |
| WebSearch | ❌ | ❌ | ❌ | ❌ | ✅ |
| WebFetch | ❌ | ❌ | ❌ | ❌ | ✅ |

*Via commands like `echo`, `cat`, `grep`, etc.

---

## Benefits of WebSearch and WebFetch

### WebSearch

**Scenarios where Claude Code can now search the web:**

1. **API Documentation**
   - Prompt: "Add authentication using the latest Supabase auth pattern"
   - Claude searches: "Supabase auth best practices 2025"
   - Uses current documentation instead of potentially outdated training data

2. **Error Resolution**
   - Prompt: "Fix this TypeScript error: TS2339"
   - Claude searches: "TypeScript TS2339 error solution"
   - Finds specific solutions for obscure errors

3. **Library Updates**
   - Prompt: "Update to React 19"
   - Claude searches: "React 19 migration guide breaking changes"
   - Applies latest migration patterns

4. **Best Practices**
   - Prompt: "Optimize this database query"
   - Claude searches: "PostgreSQL query optimization 2025"
   - Uses current best practices

### WebFetch

**Scenarios where Claude Code can fetch specific URLs:**

1. **Official Documentation**
   - Fetches from `https://docs.anthropic.com/...`
   - Reads current API specifications
   - Uses exact parameter names and types

2. **GitHub Resources**
   - Fetches README from dependency repos
   - Reads changelog for library updates
   - Checks issue discussions for known bugs

3. **Examples and Templates**
   - Fetches example code from official repos
   - Downloads boilerplate configurations
   - References canonical implementations

4. **Schema Definitions**
   - Fetches OpenAPI specs
   - Reads JSON schemas
   - Downloads type definitions

---

## Security Considerations

### Why These Were Disabled by Default

**WebSearch:**
- Could be used to send sensitive code to search engines
- Potential for data exfiltration via search queries
- Network access increases attack surface

**WebFetch:**
- Could fetch malicious code from external sources
- Potential to download and execute untrusted content
- Risk of SSRF (Server-Side Request Forgery) attacks

### Why We're Enabling Them

1. **Trusted Environment**: GitHub Actions runs in isolated containers
2. **No Sensitive Data**: Our prompts don't contain secrets
3. **Beneficial for Jobs**: Research capability improves code quality
4. **Short-Lived**: Each job runs once, then container is destroyed

### Mitigation

- ✅ Jobs run in ephemeral GitHub Actions runners
- ✅ No persistent access to secrets after job completes
- ✅ Network isolation from production systems
- ✅ Logs are auditable
- ✅ All changes go through PR review process

---

## Other Available Tools (Not Currently Enabled)

### MCP (Model Context Protocol) Tools

If you have MCP servers defined in `.mcp.json`, Claude Code can use them. Examples from the docs:

**GitHub CI Tools** (require `actions: read` permission):
- `mcp__github_ci__get_ci_status` - View workflow status
- `mcp__github_ci__get_workflow_run_details` - Get run details
- `mcp__github_ci__download_job_log` - Download job logs

**GitHub File Operations** (if using commit signing):
- `mcp__github_file_ops__commit_files` - Commit with signing
- `mcp__github_file_ops__delete_files` - Delete with signing

**GitHub Comment Tools:**
- `mcp__github_comment__update_claude_comment` - Update comments

### Specialized Tools

**Notebook Tools:**
- `NotebookEditCell` - Edit Jupyter notebook cells
- (Requires notebooks in repo)

**Task Management:**
- `TaskOutput` - Output task results
- `KillTask` - Cancel running tasks
- (Usually not needed for our workflow)

---

## Current Configuration

```yaml
settings: |
  {
    "permissions": {
      "allow": [
        "Edit",          # Targeted file edits
        "Replace",       # Find/replace operations
        "MultiEdit",     # Multi-file edits
        "Read",          # Read file contents
        "Write",         # Create/overwrite files
        "Bash",          # Execute commands
        "Glob",          # Pattern-based file finding
        "Grep",          # Text search in files
        "LS",            # List directories
        "WebSearch",     # 🆕 Search the web
        "WebFetch"       # 🆕 Fetch URLs
      ]
    }
  }
```

---

## Recommended Additional Permissions (Future)

If we want to enable GitHub Actions integration later:

```yaml
permissions:
  contents: write
  pull-requests: write
  id-token: write
  actions: read  # ⬅️ Add this

settings: |
  {
    "permissions": {
      "allow": [
        # ... existing tools ...
        "mcp__github_ci__get_ci_status",
        "mcp__github_ci__get_workflow_run_details",
        "mcp__github_ci__download_job_log"
      ]
    }
  }
```

This would let Claude Code check test results and debug CI failures.

---

## Usage Examples

### With WebSearch

**Job Prompt:**
```
Implement OAuth2 authentication using the latest industry best practices.

Research current OAuth2 security recommendations and implement accordingly.
```

**Claude Code Can:**
1. Search: "OAuth2 best practices 2025"
2. Find latest security recommendations
3. Implement with current standards

### With WebFetch

**Job Prompt:**
```
Integrate the Stripe API for payment processing.

Use the official Stripe API documentation for parameter names and types.
```

**Claude Code Can:**
1. Fetch: `https://docs.stripe.com/api`
2. Read exact API specifications
3. Implement with correct types and parameters

### Combined (WebSearch + WebFetch)

**Job Prompt:**
```
Add a new charting library for data visualization.

Research and select the best modern charting library, then implement it.
```

**Claude Code Can:**
1. WebSearch: "best React charting libraries 2025"
2. WebFetch: Documentation from top results
3. Evaluate options
4. Implement the chosen library

---

## Performance Implications

**WebSearch and WebFetch add:**
- ~2-5 seconds per search/fetch operation
- Network latency
- External API dependencies

**Mitigation:**
- Claude Code is intelligent about when to use these tools
- Only uses when genuinely needed
- Caches responses within a single job session

**Trade-off:** Slightly longer job execution time in exchange for more accurate, up-to-date implementations.

---

## Summary

We've now enabled **11 tools** for Claude Code, up from the original 4:

**Previous (4 tools):**
- Edit, Replace, Read, Bash

**Current (11 tools):**
- Edit, Replace, MultiEdit, Read, Write, Bash, Glob, Grep, LS, WebSearch, WebFetch

This significantly expands Claude Code's capabilities to:
- ✅ Research current best practices
- ✅ Access up-to-date documentation
- ✅ Find files more efficiently  
- ✅ Search code more effectively
- ✅ Create new files (not just edit)
- ✅ Edit multiple files at once

Jobs will now be more informed, more accurate, and better aligned with current standards. 🚀

