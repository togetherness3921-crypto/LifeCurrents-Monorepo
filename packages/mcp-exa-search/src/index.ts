#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { 
  CallToolRequestSchema, 
  ErrorCode, 
  ListToolsRequestSchema, 
  McpError 
} from "@modelcontextprotocol/sdk/types.js";

const EXA_API_BASE = "https://api.exa.ai";

// Create server instance
const server = new Server(
  {
    name: "exa-search",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "exa_search",
        description: "Search the web using Exa's neural search engine. Best for finding high-quality technical content, documentation, research papers, and developer resources. Returns semantic search results optimized for AI understanding.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query. Use natural language - Exa understands semantic meaning, not just keywords."
            },
            num_results: {
              type: "number",
              description: "Number of results to return (default: 10, max: 100)",
              default: 10
            },
            include_domains: {
              type: "array",
              items: { type: "string" },
              description: "Optional: List of domains to include (e.g., ['github.com', 'stackoverflow.com'])"
            },
            exclude_domains: {
              type: "array",
              items: { type: "string" },
              description: "Optional: List of domains to exclude"
            },
            start_published_date: {
              type: "string",
              description: "Optional: Start date for content (ISO 8601 format: YYYY-MM-DD)"
            },
            end_published_date: {
              type: "string",
              description: "Optional: End date for content (ISO 8601 format: YYYY-MM-DD)"
            },
            use_autoprompt: {
              type: "boolean",
              description: "Let Exa automatically enhance your query for better results (default: true)",
              default: true
            },
            type: {
              type: "string",
              enum: ["neural", "keyword"],
              description: "Search type: 'neural' for semantic understanding (default), 'keyword' for exact matching",
              default: "neural"
            },
            category: {
              type: "string",
              enum: ["company", "research paper", "news", "github", "tweet", "pdf"],
              description: "Optional: Filter by content category"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "exa_get_contents",
        description: "Get detailed content from specific URLs, including full text, highlights, and metadata. Use this after exa_search to retrieve full content from promising results.",
        inputSchema: {
          type: "object",
          properties: {
            ids: {
              type: "array",
              items: { type: "string" },
              description: "List of Exa document IDs from a previous search result"
            },
            text: {
              type: "boolean",
              description: "Include cleaned, readable text content (default: true)",
              default: true
            },
            highlights: {
              type: "boolean",
              description: "Include relevant highlights from the content (default: true)",
              default: true
            },
            summary: {
              type: "boolean",
              description: "Include AI-generated summary (default: false)",
              default: false
            }
          },
          required: ["ids"]
        }
      },
      {
        name: "exa_find_similar",
        description: "Find pages similar to a given URL. Great for discovering related content, alternative solutions, or competing approaches.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL to find similar content for"
            },
            num_results: {
              type: "number",
              description: "Number of results to return (default: 10, max: 100)",
              default: 10
            },
            exclude_source_domain: {
              type: "boolean",
              description: "Exclude results from the same domain as the source URL (default: false)",
              default: false
            },
            category: {
              type: "string",
              enum: ["company", "research paper", "news", "github", "tweet", "pdf"],
              description: "Optional: Filter by content category"
            }
          },
          required: ["url"]
        }
      }
    ]
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new McpError(ErrorCode.InternalError, "EXA_API_KEY environment variable is not set.");
  }

  if (request.params.name === "exa_search") {
    const args = request.params.arguments as {
      query: string;
      num_results?: number;
      include_domains?: string[];
      exclude_domains?: string[];
      start_published_date?: string;
      end_published_date?: string;
      use_autoprompt?: boolean;
      type?: string;
      category?: string;
    };

    try {
      const requestBody: any = {
        query: args.query,
        numResults: args.num_results || 10,
        type: args.type || "neural",
        useAutoprompt: args.use_autoprompt !== false,
        contents: {
          text: true,
          highlights: true
        }
      };

      if (args.include_domains && args.include_domains.length > 0) {
        requestBody.includeDomains = args.include_domains;
      }
      if (args.exclude_domains && args.exclude_domains.length > 0) {
        requestBody.excludeDomains = args.exclude_domains;
      }
      if (args.start_published_date) {
        requestBody.startPublishedDate = args.start_published_date;
      }
      if (args.end_published_date) {
        requestBody.endPublishedDate = args.end_published_date;
      }
      if (args.category) {
        requestBody.category = args.category;
      }

      const response = await fetch(`${EXA_API_BASE}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Exa API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      // Format results for better readability
      let formattedText = `# Exa Search Results for: "${args.query}"\n\n`;
      formattedText += `Found ${result.results?.length || 0} results\n\n`;

      if (result.autopromptString) {
        formattedText += `**Auto-enhanced query:** ${result.autopromptString}\n\n`;
      }

      formattedText += `---\n\n`;

      if (result.results && result.results.length > 0) {
        result.results.forEach((item: any, index: number) => {
          formattedText += `## ${index + 1}. ${item.title}\n\n`;
          formattedText += `**URL:** ${item.url}\n`;
          formattedText += `**ID:** ${item.id}\n`;
          if (item.publishedDate) {
            formattedText += `**Published:** ${item.publishedDate}\n`;
          }
          if (item.author) {
            formattedText += `**Author:** ${item.author}\n`;
          }
          if (item.score) {
            formattedText += `**Relevance Score:** ${item.score.toFixed(3)}\n`;
          }
          formattedText += `\n`;
          
          if (item.text) {
            const textPreview = item.text.substring(0, 500);
            formattedText += `**Content Preview:**\n${textPreview}${item.text.length > 500 ? '...' : ''}\n\n`;
          }

          if (item.highlights && item.highlights.length > 0) {
            formattedText += `**Key Highlights:**\n`;
            item.highlights.forEach((highlight: string) => {
              formattedText += `- ${highlight}\n`;
            });
            formattedText += `\n`;
          }

          formattedText += `---\n\n`;
        });
      }

      return {
        content: [
          {
            type: "text",
            text: formattedText
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search Exa: ${errorMessage}`
      );
    }
  }

  if (request.params.name === "exa_get_contents") {
    const args = request.params.arguments as {
      ids: string[];
      text?: boolean;
      highlights?: boolean;
      summary?: boolean;
    };

    try {
      const requestBody = {
        ids: args.ids,
        contents: {
          text: args.text !== false,
          highlights: args.highlights !== false,
          summary: args.summary === true
        }
      };

      const response = await fetch(`${EXA_API_BASE}/contents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Exa API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      // Format contents for better readability
      let formattedText = `# Exa Content Details\n\n`;
      formattedText += `Retrieved ${result.results?.length || 0} documents\n\n`;
      formattedText += `---\n\n`;

      if (result.results && result.results.length > 0) {
        result.results.forEach((item: any, index: number) => {
          formattedText += `## ${index + 1}. ${item.title}\n\n`;
          formattedText += `**URL:** ${item.url}\n`;
          if (item.publishedDate) {
            formattedText += `**Published:** ${item.publishedDate}\n`;
          }
          if (item.author) {
            formattedText += `**Author:** ${item.author}\n`;
          }
          formattedText += `\n`;

          if (item.summary) {
            formattedText += `### Summary\n${item.summary}\n\n`;
          }

          if (item.text) {
            formattedText += `### Full Content\n${item.text}\n\n`;
          }

          if (item.highlights && item.highlights.length > 0) {
            formattedText += `### Key Highlights\n`;
            item.highlights.forEach((highlight: string) => {
              formattedText += `- ${highlight}\n`;
            });
            formattedText += `\n`;
          }

          formattedText += `---\n\n`;
        });
      }

      return {
        content: [
          {
            type: "text",
            text: formattedText
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get contents from Exa: ${errorMessage}`
      );
    }
  }

  if (request.params.name === "exa_find_similar") {
    const args = request.params.arguments as {
      url: string;
      num_results?: number;
      exclude_source_domain?: boolean;
      category?: string;
    };

    try {
      const requestBody: any = {
        url: args.url,
        numResults: args.num_results || 10,
        excludeSourceDomain: args.exclude_source_domain === true,
        contents: {
          text: true,
          highlights: true
        }
      };

      if (args.category) {
        requestBody.category = args.category;
      }

      const response = await fetch(`${EXA_API_BASE}/findSimilar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Exa API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      // Format results for better readability
      let formattedText = `# Similar Pages to: ${args.url}\n\n`;
      formattedText += `Found ${result.results?.length || 0} similar pages\n\n`;
      formattedText += `---\n\n`;

      if (result.results && result.results.length > 0) {
        result.results.forEach((item: any, index: number) => {
          formattedText += `## ${index + 1}. ${item.title}\n\n`;
          formattedText += `**URL:** ${item.url}\n`;
          formattedText += `**ID:** ${item.id}\n`;
          if (item.publishedDate) {
            formattedText += `**Published:** ${item.publishedDate}\n`;
          }
          if (item.score) {
            formattedText += `**Similarity Score:** ${item.score.toFixed(3)}\n`;
          }
          formattedText += `\n`;

          if (item.text) {
            const textPreview = item.text.substring(0, 500);
            formattedText += `**Content Preview:**\n${textPreview}${item.text.length > 500 ? '...' : ''}\n\n`;
          }

          if (item.highlights && item.highlights.length > 0) {
            formattedText += `**Key Highlights:**\n`;
            item.highlights.forEach((highlight: string) => {
              formattedText += `- ${highlight}\n`;
            });
            formattedText += `\n`;
          }

          formattedText += `---\n\n`;
        });
      }

      return {
        content: [
          {
            type: "text",
            text: formattedText
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to find similar pages on Exa: ${errorMessage}`
      );
    }
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[Exa Search] MCP server running on stdio");
}

main().catch((error) => {
  console.error("[Exa Search] Fatal error:", error);
  process.exit(1);
});



