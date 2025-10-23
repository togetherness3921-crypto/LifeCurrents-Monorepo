import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { 
  CallToolRequestSchema, 
  ErrorCode, 
  ListToolsRequestSchema, 
  McpError 
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Create server instance
const server = new Server(
  {
    name: "job-dispatcher",
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
        name: "dispatch_job",
        description: "Dispatch an asynchronous job to a remote Cloudflare Worker with a development prompt",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "A brief title for the job"
            },
            prompt: {
              type: "string",
              description: "Multi-line development prompt to pass as payload"
            }
          },
          required: ["title", "prompt"]
        }
      }
    ]
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "dispatch_job") {
    const { title, prompt } = request.params.arguments as {
      title: string;
      prompt: string;
    };

    try {
      // TODO: Replace with the actual Cloudflare Worker URL
      const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
      if (!workerUrl) {
        throw new McpError(ErrorCode.InternalError, "CLOUDFLARE_WORKER_URL environment variable is not set.");
      }

      // Make secure API call to Cloudflare Worker
      const response = await fetch(`${workerUrl}/api/dispatch-job`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`
        },
        body: JSON.stringify({
          title,
          prompt,
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API call failed: ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();

      return {
        content: [
          {
            type: "text",
            text: `Job dispatched successfully!\nJob ID: ${result.jobId}\nStatus: ${result.status}`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to dispatch job: ${errorMessage}`
      );
    }
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Job Dispatcher MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
