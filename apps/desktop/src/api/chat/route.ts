// app/api/chat-handler.ts
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { Route } from "./+types/chat-handler";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { messages, system, tools } = await request.json();

    const customOpenAI = createOpenAI({
      baseURL: "http://127.0.0.1:4000/v1/",
    });

    const result = await streamText({
      model: customOpenAI("codex"),
      messages,
      system,
      tools,
    });

    return result.toDataStreamResponse();
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
