import { getUsageStatus, toErrorResponse } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    return Response.json(await getUsageStatus())
  } catch (error) {
    return toErrorResponse(error, {
      method: request.method,
      path: new URL(request.url).pathname,
    })
  }
}
