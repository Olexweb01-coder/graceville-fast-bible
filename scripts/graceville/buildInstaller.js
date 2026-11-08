// Graceville Fast Bible: builds the Windows installer in one go.
// Usage (from the project folder):  node scripts/graceville/buildInstaller.js
//
// Steps: 1. build the app   2. package the installer   3. clean up the build files (always)

const { spawnSync } = require("child_process")
const { existsSync, readdirSync, statSync } = require("fs")
const { join } = require("path")

const root = join(__dirname, "..", "..")
const distFolder = join(root, "dist")
const started = Date.now()

function run(title, command) {
    console.log(`\n=== ${title} ===\n> ${command}\n`)
    const result = spawnSync(command, { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, NODE_ENV: "production" } })
    return result.status === 0
}

function newestInstaller() {
    if (!existsSync(distFolder)) return null
    const installers = readdirSync(distFolder)
        .filter((name) => /^Graceville-Fast-Bible-Setup-.*\.exe$/i.test(name))
        .map((name) => ({ path: join(distFolder, name), time: statSync(join(distFolder, name)).mtimeMs }))
        .filter((file) => file.time >= started)
        .sort((a, b) => b.time - a.time)
    return installers[0]?.path || null
}

let ok = run("1/3 Building the app (takes a few minutes)", "npm run build")
if (ok) ok = run("2/3 Packaging the installer", "npx electron-builder --config config/building/graceville-builder.yaml --publish never")

// always restore the project to development mode, even if a step failed
run("3/3 Cleaning up build files", "node scripts/cleanBuilds.js")

const installer = ok ? newestInstaller() : null
const minutes = ((Date.now() - started) / 60000).toFixed(1)

if (installer) {
    console.log(`\n\x1b[32mSUCCESS (${minutes} min): installer ready\n${installer}\x1b[0m\n`)
    process.exit(0)
} else {
    console.log(`\n\x1b[31mBUILD FAILED after ${minutes} min - send the red text above to Claude.\x1b[0m\n`)
    process.exit(1)
}
