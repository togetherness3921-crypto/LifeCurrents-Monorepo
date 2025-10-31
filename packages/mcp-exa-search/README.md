# Exa Search MCP Server

A Model Context Protocol (MCP) server that integrates [Exa](https://exa.ai) neural search capabilities into Cursor IDE.

## Features

Exa is a neural search engine optimized for finding high-quality technical content, documentation, research papers, and developer resources. Unlike traditional keyword-based search, Exa understands semantic meaning and context.

### Available Tools

#### 1. `exa_search`
Perform semantic web searches optimized for technical content.

**Best for:**
- Finding documentation and API references
- Discovering technical blog posts and tutorials
- Searching GitHub repositories and discussions
- Finding research papers and academic content
- Developer resources and Stack Overflow answers

**Parameters:**
- `query` (required): Natural language search query
- `num_results`: Number of results (1-100, default: 10)
- `include_domains`: Filter to specific domains (e.g., `["github.com", "stackoverflow.com"]`)
- `exclude_domains`: Exclude specific domains
- `start_published_date`: Filter by publication date (ISO 8601: YYYY-MM-DD)
- `end_published_date`: End date filter
- `use_autoprompt`: Auto-enhance query (default: true)
- `type`: Search type - `"neural"` (semantic) or `"keyword"` (exact match)
- `category`: Filter by content type - `"company"`, `"research paper"`, `"news"`, `"github"`, `"tweet"`, `"pdf"`

**Example:**
```javascript
{
  "query": "How to implement OAuth2 authentication in Node.js",
  "num_results": 5,
  "include_domains": ["dev.to", "medium.com", "github.com"],
  "type": "neural"
}
```

#### 2. `exa_get_contents`
Retrieve full content, highlights, and summaries from specific search results.

**Parameters:**
- `ids` (required): Array of Exa document IDs from previous search
- `text`: Include full cleaned text (default: true)
- `highlights`: Include key highlights (default: true)
- `summary`: Include AI-generated summary (default: false)

**Example:**
```javascript
{
  "ids": ["https://example.com/article-12345"],
  "text": true,
  "highlights": true,
  "summary": true
}
```

#### 3. `exa_find_similar`
Find pages similar to a given URL - great for discovering related content or alternatives.

**Parameters:**
- `url` (required): The reference URL
- `num_results`: Number of results (default: 10)
- `exclude_source_domain`: Exclude same domain (default: false)
- `category`: Filter by content type

**Example:**
```javascript
{
  "url": "https://react.dev/learn/thinking-in-react",
  "num_results": 10,
  "exclude_source_domain": true
}
```

## Installation

1. The server is already built and configured in your `.cursor/mcp.json`
2. Restart Cursor IDE to load the MCP server
3. The tools will be available in your AI chat

## Usage Examples

### Search for React tutorials
```
Use exa_search to find recent React hooks tutorials published in the last year from dev.to or medium.com
```

### Find similar documentation
```
Use exa_find_similar to find pages similar to https://docs.python.org/3/library/asyncio.html
```

### Deep dive into a result
```
After getting search results, use exa_get_contents with the document IDs to get full text and summaries
```

## API Key

The API key is configured in `.cursor/mcp.json` as an environment variable. Never commit this file to version control if it contains your API key.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode for development
npm run watch
```

## API Reference

Exa API Documentation: https://docs.exa.ai

## License

Private - Part of LifeCurrents project


