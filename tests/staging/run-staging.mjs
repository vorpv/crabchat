import { spawn } from "node:child_process"

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    })

    child.on("error", (error) => {
      console.error(error)
      resolve(1)
    })

    child.on("close", (code, signal) => {
      if (signal) {
        console.error(`${command} ${args.join(" ")} exited from signal ${signal}`)
        resolve(1)
        return
      }
      resolve(code ?? 1)
    })
  })
}

const serviceStatus = await run("npm", ["run", "test:staging:services"])
let testStatus = 1
let cleanupStatus = 0

try {
  if (serviceStatus === 0) {
    testStatus = await run("npm", ["run", "test:staging:run"])
  } else {
    testStatus = serviceStatus
  }
} finally {
  cleanupStatus = await run("npm", ["run", "test:staging:services:down"])
}

process.exitCode = testStatus || cleanupStatus
