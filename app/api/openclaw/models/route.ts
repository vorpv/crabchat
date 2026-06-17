import { listModelOptions } from "@/lib/openclaw-models"
import { toErrorResponse } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    return Response.json({ models: await listModelOptions() })
  } catch (error) {
    return toErrorResponse(error, {
      method: request.method,
      path: new URL(request.url).pathname,
    })
  }
}
