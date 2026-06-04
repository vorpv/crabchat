import { loadHistory, toErrorResponse } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const session = url.searchParams.get("session") || undefined
    const limit = Number(url.searchParams.get("limit") || 200)
    return Response.json({ messages: await loadHistory(session, limit) })
  } catch (error) {
    return toErrorResponse(error)
  }
}
