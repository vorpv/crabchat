import { sendMessage, toErrorResponse } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const text = typeof body.text === "string" ? body.text.trim() : ""
    const attachments = Array.isArray(body.attachments) ? body.attachments : []

    if (!text && attachments.length === 0) {
      return Response.json(
        { error: "Message text or an attachment is required." },
        { status: 400 }
      )
    }

    const payload = await sendMessage({
      session: body.session,
      text,
      thinkingLevel: body.thinkingLevel || "medium",
      attachments,
      idempotencyKey: body.idempotencyKey || crypto.randomUUID(),
    })

    return Response.json({ result: payload })
  } catch (error) {
    return toErrorResponse(error)
  }
}
