import {
  getOpenClawConfigView,
  saveOpenClawSessionConfig,
  validateAndRestartOpenClaw,
} from "@/lib/openclaw-config"
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
    return Response.json(await getOpenClawConfigView())
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    return Response.json(await saveOpenClawSessionConfig(body.session || {}))
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    if (body.action !== "restart") {
      return Response.json({ error: "Unsupported config action." }, { status: 400 })
    }
    return Response.json(await validateAndRestartOpenClaw())
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}
