import { getCrabChatState, updateCrabChatState } from "@/lib/crabchat-store"
import { toErrorResponse } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

function getErrorContext(request: Request) {
  return {
    method: request.method,
    path: new URL(request.url).pathname,
  }
}

export async function GET(request: Request) {
  try {
    return Response.json(getCrabChatState())
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    return Response.json(
      updateCrabChatState({
        settings: body.settings,
        modelSelection: body.modelSelection,
        pins: body.pins,
      })
    )
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}
