import {
  createCrabChatSession,
  deleteCrabChatSession,
  patchCrabChatSession,
  syncCrabChatSessions,
} from "@/lib/crabchat-store"
import {
  toErrorResponse,
} from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

function getErrorContext(request: Request) {
  return {
    method: request.method,
    path: new URL(request.url).pathname,
  }
}

export async function GET(request: Request) {
  try {
    return Response.json(await syncCrabChatSessions())
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const agentId = typeof body.agentId === "string" ? body.agentId : undefined
    return Response.json({ session: await createCrabChatSession(body.label, agentId) })
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    if (
      !body.identifier ||
      (body.label === undefined &&
        body.model === undefined &&
        body.thinkingLevel === undefined)
    ) {
      return Response.json(
        {
          error:
            "Session identifier and at least one of label, model, or thinkingLevel are required.",
        },
        { status: 400 }
      )
    }
    return Response.json({
      session: await patchCrabChatSession(body.identifier, {
        label: typeof body.label === "string" ? body.label : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        thinkingLevel:
          body.thinkingLevel === null
            ? null
            : typeof body.thinkingLevel === "string"
              ? body.thinkingLevel
              : undefined,
      }),
    })
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    if (!body.identifier) {
      return Response.json(
        { error: "Session identifier is required." },
        { status: 400 }
      )
    }
    return Response.json(await deleteCrabChatSession(body.identifier))
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}
