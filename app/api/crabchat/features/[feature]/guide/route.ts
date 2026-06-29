import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { toErrorResponse } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

const featureFiles: Record<string, string> = {
  "session-archiving": "01_Session_archiving.md",
  notes: "02_Notes.md",
}

function getErrorContext(request: Request) {
  return {
    method: request.method,
    path: new URL(request.url).pathname,
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ feature: string }> }
) {
  try {
    const { feature } = await context.params
    const file = featureFiles[feature]
    if (!file) {
      return Response.json({ error: "Unknown feature" }, { status: 404 })
    }

    const markdown = await readFile(join(process.cwd(), "features", file), "utf8")
    return Response.json({ markdown })
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}
