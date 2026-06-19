import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { NextRequest, NextResponse } from "next/server"

const WORKSPACE_ALIAS = "/workspace"
const SANDBOX_CONTAINERS_DIR = `${homedir()}/.openclaw/sandbox/containers`

type SandboxContainerMetadata = {
  backendId?: string
  containerName?: string
  sessionKey?: string
}

type ContainerMount = {
  Source?: string
  Destination?: string
}

function normalizeAbsolutePath(value: string) {
  const parts: string[] = []

  for (const part of value.split("/")) {
    if (!part || part === ".") {
      continue
    }
    if (part === "..") {
      parts.pop()
      continue
    }
    parts.push(part)
  }

  return `/${parts.join("/")}`
}

function splitLineColumn(value: string) {
  const match = value.match(/^(.*?)(?::(\d+))?(?::(\d+))?$/)
  return {
    filePath: match?.[1] || value,
    line: match?.[2],
    column: match?.[3],
  }
}

function readSandboxContainerMetadata(filePath: string) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as SandboxContainerMetadata
  } catch {
    return null
  }
}

function findSandboxContainer(sessionKey: string) {
  if (!SANDBOX_CONTAINERS_DIR || !existsSync(SANDBOX_CONTAINERS_DIR)) {
    return null
  }

  for (const fileName of readdirSync(SANDBOX_CONTAINERS_DIR)) {
    if (!fileName.endsWith(".json")) {
      continue
    }

    const metadata = readSandboxContainerMetadata(`${SANDBOX_CONTAINERS_DIR}/${fileName}`)
    if (metadata?.sessionKey === sessionKey && metadata.containerName) {
      return metadata
    }
  }

  return null
}

function inspectWorkspaceMount(metadata: SandboxContainerMetadata) {
  if (!metadata.containerName) {
    return null
  }

  const binary = metadata.backendId === "podman" ? "podman" : "docker"
  try {
    const output = execFileSync(
      binary,
      ["inspect", metadata.containerName, "--format", "{{json .Mounts}}"],
      { encoding: "utf8", timeout: 2_000 }
    )
    const mounts = JSON.parse(output) as ContainerMount[]
    const workspaceMount = mounts.find((mount) => mount.Destination === WORKSPACE_ALIAS)
    return workspaceMount?.Source ? normalizeAbsolutePath(workspaceMount.Source) : null
  } catch {
    return null
  }
}

function resolveWorkspaceRoot(rawWorkspaceRoot: string | null, sessionKey: string | null) {
  if (rawWorkspaceRoot) {
    return normalizeAbsolutePath(rawWorkspaceRoot)
  }

  if (!sessionKey) {
    return null
  }

  const metadata = findSandboxContainer(sessionKey)
  return metadata ? inspectWorkspaceMount(metadata) : null
}

function resolveWorkspacePath(rawPath: string, rawWorkspaceRoot: string | null, sessionKey: string | null) {
  const workspaceRoot = resolveWorkspaceRoot(rawWorkspaceRoot, sessionKey)
  if (!workspaceRoot) {
    return { error: "Workspace root is required." as const }
  }

  const { filePath, line, column } = splitLineColumn(rawPath)
  let resolvedPath: string

  if (filePath === WORKSPACE_ALIAS) {
    resolvedPath = workspaceRoot
  } else if (filePath.startsWith(`${WORKSPACE_ALIAS}/`)) {
    resolvedPath = normalizeAbsolutePath(`${workspaceRoot}/${filePath.slice(WORKSPACE_ALIAS.length + 1)}`)
  } else if (filePath.startsWith("/")) {
    resolvedPath = normalizeAbsolutePath(filePath)
  } else {
    resolvedPath = normalizeAbsolutePath(`${workspaceRoot}/${filePath}`)
  }

  if (resolvedPath !== workspaceRoot && !resolvedPath.startsWith(`${workspaceRoot}/`)) {
    return null
  }

  return { path: resolvedPath, line, column, error: undefined }
}

export function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path")
  const workspaceRoot = request.nextUrl.searchParams.get("root")
  const sessionKey = request.nextUrl.searchParams.get("session")

  if (!requestedPath) {
    return NextResponse.json({ error: "Missing path." }, { status: 400 })
  }

  const resolved = resolveWorkspacePath(requestedPath, workspaceRoot, sessionKey)
  if (!resolved) {
    return NextResponse.json({ error: "Path is outside the workspace." }, { status: 400 })
  }
  if (resolved.error) {
    return NextResponse.json({ error: resolved.error }, { status: 400 })
  }

  const location = encodeURI(
    `vscode://file${resolved.path}${resolved.line ? `:${resolved.line}` : ""}${
      resolved.column ? `:${resolved.column}` : ""
    }`
  )

  return NextResponse.redirect(location, { status: 302 })
}
