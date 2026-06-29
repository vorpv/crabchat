import {
  deleteNote,
  listNotes,
  readNote,
  saveNote,
  validateNotesStoragePath,
} from "@/lib/crabchat-notes"
import { getCrabChatState } from "@/lib/crabchat-store"
import { toErrorResponse } from "@/lib/openclaw-gateway"

export const runtime = "nodejs"

function getErrorContext(request: Request) {
  return {
    method: request.method,
    path: new URL(request.url).pathname,
  }
}

function currentFeatures() {
  return getCrabChatState().features
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const validatePath = url.searchParams.get("validatePath")
    if (validatePath !== null) {
      return Response.json(validateNotesStoragePath(validatePath))
    }

    const fileName = url.searchParams.get("fileName")
    if (fileName) {
      return Response.json({ note: readNote(fileName, currentFeatures()) })
    }

    return Response.json(listNotes(currentFeatures()))
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    return Response.json(saveNote(body, currentFeatures()))
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    return Response.json(saveNote(body, currentFeatures()))
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    return Response.json(deleteNote(body.fileName, currentFeatures()))
  } catch (error) {
    return toErrorResponse(error, getErrorContext(request))
  }
}
