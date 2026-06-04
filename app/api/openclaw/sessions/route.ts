import {
  createSession,
  deleteSession,
  listSessions,
  toErrorResponse,
  updateSession,
} from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

export async function GET() {
  try {
    return Response.json({ sessions: await listSessions() })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    return Response.json({ session: await createSession(body.label) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    if (!body.identifier || !body.label) {
      return Response.json(
        { error: "Session identifier and label are required." },
        { status: 400 }
      )
    }
    return Response.json({
      session: await updateSession(body.identifier, body.label),
    })
  } catch (error) {
    return toErrorResponse(error)
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
    return Response.json(await deleteSession(body.identifier))
  } catch (error) {
    return toErrorResponse(error)
  }
}
