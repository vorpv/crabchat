import http from "node:http"
import { randomUUID } from "node:crypto"

const port = Number(process.env.MOCK_OPENAI_PORT || "8080")

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json",
  })
  res.end(`${JSON.stringify(payload)}\n`)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function responseText(body) {
  const input = Array.isArray(body.messages)
    ? body.messages.map((message) => message.content).filter(Boolean).join("\n")
    : body.input

  if (typeof input === "string" && input.trim()) {
    return `Mock OpenAI response: ${input.trim()}`
  }

  return "Mock OpenAI response"
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true })
    return
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    json(res, 200, {
      object: "list",
      data: [
        {
          id: "gpt-5-staging-mock",
          object: "model",
          created: 0,
          owned_by: "outclaw-tests",
        },
      ],
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = await readBody(req)
    const content = responseText(body)

    if (body.stream) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      res.write(
        `data: ${JSON.stringify({
          id: `chatcmpl-${randomUUID()}`,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        })}\n\n`
      )
      res.write(
        `data: ${JSON.stringify({
          id: `chatcmpl-${randomUUID()}`,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}\n\n`
      )
      res.end("data: [DONE]\n\n")
      return
    }

    json(res, 200, {
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model || "gpt-5-staging-mock",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 6,
        total_tokens: 14,
      },
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/v1/responses") {
    const body = await readBody(req)
    const outputText = responseText(body)
    json(res, 200, {
      id: `resp_${randomUUID()}`,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      model: body.model || "gpt-5-staging-mock",
      status: "completed",
      output: [
        {
          id: `msg_${randomUUID()}`,
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: outputText }],
        },
      ],
      output_text: outputText,
      usage: {
        input_tokens: 8,
        output_tokens: 6,
        total_tokens: 14,
      },
    })
    return
  }

  json(res, 404, {
    error: {
      message: `Unhandled mock OpenAI endpoint: ${req.method} ${url.pathname}`,
      type: "invalid_request_error",
    },
  })
})

server.listen(port, "0.0.0.0", () => {
  console.log(`Mock OpenAI API listening on ${port}`)
})
