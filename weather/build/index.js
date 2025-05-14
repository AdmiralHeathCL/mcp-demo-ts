import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// const emptyArgs: ZodRawShape = {};
const dummyShape = {
    dummy: z.string().optional().describe("just a placeholder"),
};
// 创建 server instance
const server = new McpServer({
    name: "weather",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tools: {},
    },
});
server.tool("get-local-time", "获取当前本地时间", dummyShape, async () => {
    const now = new Date();
    const text = now.toLocaleString("en-US", {
        hour12: true,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
    return {
        content: [
            {
                type: "text",
                text: `Current local time is: ${text}`
            }
        ]
    };
});
server.tool("get-random-joke", "Get a random joke.", dummyShape, async () => {
    try {
        const res = await fetch("https://official-joke-api.appspot.com/random_joke");
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const { setup, punchline } = await res.json();
        return {
            content: [
                { type: "text", text: `Here's a joke for you:\n${setup}\n${punchline}` }
            ]
        };
    }
    catch (error) {
        console.error("Error fetching joke:", error);
        return {
            content: [
                { type: "text", text: "Failed to fetch joke from external API." }
            ]
        };
    }
});
// Benchmark
server.tool("echo_data", "Echoes back base64-encoded binary payload.", { payload: z.string().describe("Base64-encoded binary buffer") }, async ({ payload }) => {
    return {
        content: [
            {
                type: "text",
                text: payload
            }
        ]
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Weather MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
