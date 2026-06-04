import { pingGateway, toErrorResponse } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

export async function GET() {
  try {
    return Response.json(await pingGateway())
  } catch (error) {
    return toErrorResponse(error)
  }
}
