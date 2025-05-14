import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// console.log("[DEBUG] CWD:", process.cwd());
// console.log("[DEBUG] API KEY:", process.env.OPENAI_API_KEY);

import OpenAI from "openai";

import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources.mjs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";

import { Buffer } from "buffer";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY 未设置");
}

function generateRandomBitBuffer(bitLength: number): Buffer {
  const byteLength = Math.ceil(bitLength / 8);
  const buf = Buffer.alloc(byteLength);
  for (let i = 0; i < byteLength; i++) {
    buf[i] = Math.floor(Math.random() * 256); // 8 random bits
  }
  return buf;
}

function formatBits(bits: number): string {
  if (bits >= 8_589_934_592) return (bits / 8_589_934_592).toFixed(2) + " GB";
  if (bits >= 8_388_608) return (bits / 8_388_608).toFixed(2) + " MB";
  if (bits >= 8_192) return (bits / 8_192).toFixed(2) + " kB";
  if (bits >= 8) return (bits / 8).toFixed(2) + " B";
  return bits + " bits";
}



class MCPClient {

  private messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: [
        "You are a helpful assistant.",
        "Only call the 'get-local-time' tools when the user asks for the current time or the local time or the time now."
      ].join(" ")
    }
  ];
  
  private mcp: Client;
  private openai: OpenAI;
  private transport: StdioClientTransport | null = null;
  private tools: ChatCompletionTool[] = [];

  constructor() {
    this.openai = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
  }
  
  async connectToServer(serverScriptPath: string) {
    try {
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      if (!isJs && !isPy) {
        throw new Error("服务器脚本必须是 .js 或 .py 文件");
      }
      const command = isPy
        ? process.platform === "win32"
          ? "python"
          : "python3"
        : process.execPath;
      
      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });
      this.mcp.connect(this.transport);
      
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool: any) => {
        return {
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema
            },
        };
      });
      console.log(
        "已连接到服务器，工具包括：",
        this.tools.map((tool) => tool.function.name)
      );
    } catch (e) {
      console.log("无法连接到 MCP 服务器: ", e);
      throw e;
    }
  }
  

  async processQuery(query: string) {
    // const messages: ChatCompletionMessageParam[] = [{ role: "user", content: query }];

    this.messages.push({ role: "user", content: query });

  
    // console.log("[CLIENT] Sending to GPT:", messages);
  
    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: this.messages,
      tools: this.tools,
      tool_choice: "auto",
    });
  
    const finalText = [];
    const toolResults = [];
  
    for (const choice of response.choices) {
      const message = choice.message;

      // Run on LLM
      if (message.content) {
        // console.log("[CLIENT] GPT content:", message.content);
        finalText.push(message.content);
      }
  
      // Run on tools
      if (message.tool_calls) {
        this.messages.push({
          role: "assistant",
          content: message.content ?? null,
          tool_calls: message.tool_calls
        });
        for (const call of message.tool_calls) {
          const toolName = call.function.name;
          const toolArgs = JSON.parse(call.function.arguments);
  
          // console.log(`[CLIENT] Tool call detected: ${toolName}`, toolArgs);
  
          const result = await this.mcp.callTool({
            name: toolName,
            arguments: toolArgs,
          });
  
          // console.log(`[CLIENT] Tool result from '${toolName}':`, JSON.stringify(result, null, 2));

          toolResults.push(result);
  
          this.messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }

        // Rerun with tool results
        try{
          const followUp = await this.openai.chat.completions.create({
            model:   "gpt-4o",
            messages: this.messages,
          });
          this.messages.push(followUp.choices[0].message);

          // console.log("[CLIENT] GPT follow-up response:", JSON.stringify(followUp, null, 2));
    
          finalText.push(followUp.choices[0].message.content ?? "");
        } catch (err) {
          console.error("follow-up error:", err);
        }
      }
    }
  
    // Print out result
    return finalText.join("\n");
  }
  
  async runBenchmark() {
    const sizes = [
      10, 100, 1000, 
      10_000, 100_000, 500_000, 
      1_000_000, 2_000_000, 5_000_000, 
      // 10_000_000, 20_000_000, 50_000_000, 
      // 100_000_000, 200_000_000, 500_000_000, 
      // 1_000_000_000, 2_000_000_000, 5_000_000_000, 
      // 10_000_000_000, 20_000_000_000, 50_000_000_000,
      // 100_000_000_000, 200_000_000_000, 500_000_000_000, 
      // 1_000_000_000_000,
    ];

    for (const size of sizes) {
      const payload = "x".repeat(size);
      // const payload = Array.from({ length: size }, () => (Math.random() < 0.5 ? "0" : "1")).join("");

      const start = performance.now();

      try {
        const result = await this.mcp.callTool({
          name: "echo_data",
          arguments: { payload },
        });

        const content = result?.content as { type: string; text: string }[] | undefined;
        const echoedText = content?.[0]?.text ?? "";
        const end = performance.now();
        const isValid = echoedText.length === size && echoedText === payload;

        console.log(
          `Size: ${size.toString().padStart(10)} bytes | Time: ${(end - start).toFixed(4).padStart(10)} ms | Valid: ${isValid}`
        );
      } catch (err) {
        console.error(`Size: ${size} bytes | ERROR:`, err);
      }
    }
  }

  async runBitLevelBenchmark() {
    const bitSizes = [
      8, 512, 4096, // 1-512 B
      8192, 524288, 4194304, // 1-512 kB
      8388608, 16777216, 41943040, 67108864, 134217728,
      268435456, 536870912, 1073741824, 2147483649, 4294967297
    ];

    for (const bits of bitSizes) {
      const buffer = generateRandomBitBuffer(bits);
      const base64Payload = buffer.toString("base64");

      const start = performance.now();

      try {
        const result = await this.mcp.callTool({
          name: "echo_data",
          arguments: { payload: base64Payload },
          timeoutMs: 240_000,
        });

        const echoedBase64 = (result?.content as any)?.[0]?.text ?? "";
        const echoedBuffer = Buffer.from(echoedBase64, "base64");

        const end = performance.now();

        const isValid = buffer.equals(echoedBuffer);

        console.log(
          `Bits: ${formatBits(bits).padStart(10)} | Time: ${(end - start).toFixed(4).padStart(10)} ms | Mbps: ${((bits/(end - start)/1000000)).toFixed(8).padStart(10)} mbps | Valid: ${isValid}`
        );

        if (!isValid) {
          console.error(`[MISMATCH] at ${bits} bits. Terminating benchmark.`);
          return;
        }

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ERROR] at ${bits} bits: ${message}`);
        return;
      }
    }

    console.log("✅ Benchmark completed without failures.");
  }


async findMaxEchoableBits(): Promise<number> {
  let low = 1_000_000;
  let high = 1_500_000_000;
  let maxValid = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const buffer = generateRandomBitBuffer(mid);
    const base64Payload = buffer.toString("base64");

    console.log(`Testing ${mid} bits...`);
    const start = performance.now();
    try {
      const result = await this.mcp.callTool({
        name: "echo_data",
        arguments: { payload: base64Payload },
        timeoutMs: 240_000,
      });

      const echoedBase64 = (result?.content as any)?.[0]?.text ?? "";
      const echoedBuffer = Buffer.from(echoedBase64, "base64");

      const isValid = buffer.equals(echoedBuffer);
      const duration = (performance.now() - start).toFixed(2);

      if (isValid) {
        console.log(`[SUCCESS]: ${mid} bits in ${duration} ms`);
        maxValid = mid;
        low = mid + 1;
      } else {
        console.log(`[MISMATCH] at ${mid} bits`);
        high = mid - 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ERROR] at ${mid} bits:`, message);
      high = mid - 1;
    }
  }

  console.log(`\nMaximum echoable size: ${maxValid} bits (${(maxValid / 8 / 1024 / 1024).toFixed(2)} MB)`);
  return maxValid;
}


  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  
    try {
      console.log("\nMCP 客户端已启动！");
      console.log("输入你的查询或输入 'quit' 退出。");
  
      while (true) {
        const message = await rl.question("\n查询: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } finally {
      rl.close();
    }
  }
  
  async cleanup() {
    await this.mcp.close();
  }
}

  async function main() {
    if (process.argv.length < 3) {
      console.log("使用方法: node index.ts <path_to_server_script>");
      return;
    }
    const mcpClient = new MCPClient();
    try {
      await mcpClient.connectToServer(process.argv[2]);

      // [Chatbot]
      // await mcpClient.chatLoop();

      // [String Benchmark]
      // console.log("\nRunning string benchmark...\n");
      // await mcpClient.runBenchmark();

      // [Bit-level Benchmark]
      console.log("\nRunning bit-level benchmark...\n");
      await mcpClient.runBitLevelBenchmark();

      // [Find max echoable bits]
      // await mcpClient.findMaxEchoableBits();

    } finally {
      await mcpClient.cleanup();
      process.exit(0);
    }
  }
  
  main();