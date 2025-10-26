import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { 
  CallToolRequestSchema, 
  ErrorCode, 
  ListToolsRequestSchema, 
  McpError 
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Helper function to extract verification steps from prompt
function extractVerificationSteps(prompt: string): { steps: string[] } | null {
  // Look for "Verification Steps:" section
  const verificationMatch = prompt.match(/\*\*Verification Steps:\*\*\s*\n([\s\S]*?)(?=\n\n|$)/i);
  
  if (!verificationMatch) {
    return null;
  }
  
  const verificationSection = verificationMatch[1];
  
  // Extract numbered steps (1. something, 2. something, etc.)
  const steps = verificationSection
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^\d+\./.test(line))  // Lines starting with numbers
    .map(line => line.replace(/^\d+\.\s*/, ''));  // Remove the number prefix
  
  return steps.length > 0 ? { steps } : null;
}

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
        description: "See rule1.mdc §Job Dispatch",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "See rule1.mdc §Job Dispatch"
            },
            prompt: {
              type: "string",
              description: "See rule1.mdc §Job Dispatch"
            },
            integration_summary: {
              type: "string",
              description: "See rule1.mdc §Job Dispatch"
            }
          },
          required: ["title", "prompt", "integration_summary"]
        }
      },
      {
        name: "get_ready_jobs",
        description: "See rule1.mdc §Job Reconciliation",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "mark_jobs_integrated",
        description: "See rule1.mdc §Job Reconciliation",
        inputSchema: {
          type: "object",
          properties: {
            job_ids: {
              type: "array",
              items: { type: "string" },
              description: "See rule1.mdc §Job Reconciliation"
            }
          },
          required: ["job_ids"]
        }
      }
    ]
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "dispatch_job") {
    const { title, prompt, integration_summary } = request.params.arguments as {
      title: string;
      prompt: string;
      integration_summary: string;
    };

    try {
      // TODO: Replace with the actual Cloudflare Worker URL
      const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
      if (!workerUrl) {
        throw new McpError(ErrorCode.InternalError, "CLOUDFLARE_WORKER_URL environment variable is not set.");
      }

      // Extract verification steps from prompt
      const verificationSteps = extractVerificationSteps(prompt);

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
          integration_summary,
          verification_steps: verificationSteps,
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

  if (request.params.name === "get_ready_jobs") {
    try {
      const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
      if (!workerUrl) {
        throw new McpError(ErrorCode.InternalError, "CLOUDFLARE_WORKER_URL environment variable is not set.");
      }

      const response = await fetch(`${workerUrl}/api/get-ready-jobs`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`
        }
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
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get ready jobs: ${errorMessage}`
      );
    }
  }

  if (request.params.name === "mark_jobs_integrated") {
    const { job_ids } = request.params.arguments as {
      job_ids: string[];
    };

    try {
      const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
      if (!workerUrl) {
        throw new McpError(ErrorCode.InternalError, "CLOUDFLARE_WORKER_URL environment variable is not set.");
      }

      const response = await fetch(`${workerUrl}/api/mark-jobs-integrated`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`
        },
        body: JSON.stringify({ job_ids })
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
            text: `Successfully marked ${job_ids.length} job(s) as integrated`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to mark jobs as integrated: ${errorMessage}`
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
