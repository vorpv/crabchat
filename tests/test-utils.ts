import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach } from "vitest"

const envStack: Array<NodeJS.ProcessEnv> = []
const tempDirs: string[] = []

export function useTempCrabChatHome() {
  let home = ""

  beforeEach(() => {
    envStack.push({ ...process.env })
    home = mkdtempSync(join(tmpdir(), "crabchat-test-"))
    tempDirs.push(home)
    process.env.CRABCHAT_HOME = home
  })

  afterEach(() => {
    process.env = envStack.pop() || process.env
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  return () => home
}
