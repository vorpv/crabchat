import { subscribeSessionActivity, toErrorResponse } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

function encodeSse(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const session = url.searchParams.get("session")

  if (!session) {
    return Response.json({ error: "Session is required." }, { status: 400 })
  }

  try {
    const encoder = new TextEncoder()
    const abortController = new AbortController()
    let closeStream: (() => void) | undefined
    const stream = new ReadableStream({
      start(controller) {
        let closed = false
        const sendEvent = (event: string, payload: unknown) => {
          if (closed) return
          controller.enqueue(encoder.encode(encodeSse(event, payload)))
        }
        const heartbeat = setInterval(() => {
          sendEvent("heartbeat", {})
        }, 15_000)

        closeStream = () => {
          if (closed) return
          closed = true
          clearInterval(heartbeat)
          abortController.abort()
          controller.close()
        }

        request.signal.addEventListener("abort", closeStream, { once: true })
        sendEvent("connected", {})

        void subscribeSessionActivity(session, {
          signal: abortController.signal,
          onActivity: (activity) => {
            sendEvent("status", activity)
          },
          onError: (error) => {
            sendEvent("error", { error: error.message, code: error.code })
            closeStream?.()
          },
        }).catch((error) => {
          sendEvent("error", {
            error: error instanceof Error ? error.message : "Stream failed",
          })
          closeStream?.()
        })
      },
      cancel() {
        closeStream?.()
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      },
    })
  } catch (error) {
    return toErrorResponse(error, {
      method: request.method,
      path: new URL(request.url).pathname,
    })
  }
}
