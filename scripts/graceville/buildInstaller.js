// Graceville Fast Bible: builds the Windows installer in one go, and publishes it as a self-update.
// Usage (from the project folder):  node scripts/graceville/buildInstaller.js
//
// Steps: 1. build the app   2. package the installer (and publish it)   3. clean up the build files (always)
//
// Version: <year>.<month>.<number of commits>, e.g. 2026.11.5124. It always goes up, which self-updates need.
// Publishing: when GH_TOKEN is set in .env.local and every change is committed, the installer is uploaded to
// the project's GitHub Releases. Installed apps then download it quietly and install it when they are closed.

const { spawnSync, execSync } = require("child_process");
const { existsSync, readdirSync, readFileSync, statSync } = require("fs");
const { join } = require("path");
const { createGitHub } = require("./githubRelease");

const root = join(__dirname, "..", "..");
const distFolder = join(root, "dist");
const started = Date.now();

function readEnvLocal() {
  const file = join(root, ".env.local");
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

function git(command) {
  return execSync(`git ${command}`, { cwd: root, encoding: "utf8" }).trim();
}

// Files the build itself rewrites (FreeShow's preBuild.js copies the PDF worker from node_modules).
// They are put back after every build and never count as "your" changes.
const BUILD_GENERATED_FILES = ["public/assets/pdf.worker.min.mjs"];

function restoreBuildGeneratedFiles() {
  for (const file of BUILD_GENERATED_FILES) {
    try {
      git(`checkout -- "${file}"`);
    } catch (err) {
      console.warn(`Could not restore ${file}:`, err.message);
    }
  }
}

restoreBuildGeneratedFiles();

const now = new Date();
const commitCount = Number(git("rev-list --count HEAD"));
const version = `${now.getFullYear()}.${now.getMonth() + 1}.${commitCount}`;
const hasUncommittedChanges =
  git("status --porcelain --untracked-files=no") !== "";

const token = process.env.GH_TOKEN || readEnvLocal().GH_TOKEN;

// a release must point at a commit that is already on GitHub
function commitsNotPushed() {
  try {
    git("fetch origin --quiet");
    return Number(git("rev-list --count @{u}..HEAD"));
  } catch (err) {
    console.warn("Could not check GitHub:", err.message);
    return -1;
  }
}
const notPushed = token && !hasUncommittedChanges ? commitsNotPushed() : 0;
const publish = !!token && !hasUncommittedChanges && notPushed === 0;

console.log(`\nGraceville Fast Bible ${version}`);
if (publish)
  console.log("Publishing: YES - installed apps will update themselves.");
else if (!token)
  console.log(
    "Publishing: no (GH_TOKEN is not in .env.local) - building the installer only.",
  );
else if (hasUncommittedChanges)
  console.log(
    "Publishing: no (some changes are not committed yet) - building the installer only.",
  );
else if (notPushed > 0)
  console.log(
    `Publishing: no (${notPushed} change(s) not on GitHub yet - run: git push origin main) - building the installer only.`,
  );
else
  console.log(
    "Publishing: no (could not reach GitHub) - building the installer only.",
  );

function run(title, command, extraEnv = {}) {
  console.log(`\n=== ${title} ===\n> ${command}\n`);
  const env = { ...process.env, NODE_ENV: "production", ...extraEnv };
  const result = spawnSync(command, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env,
  });
  return result.status === 0;
}

function newestInstaller() {
  if (!existsSync(distFolder)) return null;
  const installers = readdirSync(distFolder)
    .filter((name) => name === `Graceville-Fast-Bible-Setup-${version}.exe`)
    .map((name) => ({
      path: join(distFolder, name),
      time: statSync(join(distFolder, name)).mtimeMs,
    }))
    .filter((file) => file.time >= started);
  return installers[0]?.path || null;
}

async function main() {
  let ok = run("1/3 Building the app (takes a few minutes)", "npm run build");

  let github = null;
  let draftId = null;
  if (ok && publish) {
    try {
      github = createGitHub({
        token,
        owner: "Olexweb01-coder",
        repo: "graceville-fast-bible",
      });
      await github.cleanUp(`v${version}`);
      draftId = await github.createDraft(
        `v${version}`,
        version,
        git("rev-parse HEAD"),
      );
      console.log(`\nPrepared a hidden draft release v${version} on GitHub.`);
    } catch (err) {
      console.error(
        `\x1b[31mCould not prepare the GitHub release: ${err.message}\x1b[0m`,
      );
      ok = false;
    }
  }

  if (ok) {
    const builder = `npx electron-builder --config config/building/graceville-builder.yaml -c.extraMetadata.version=${version} --publish ${publish ? "always" : "never"}`;
    ok = run(
      `2/3 Packaging the installer${publish ? " and uploading it" : ""}`,
      builder,
      publish ? { GH_TOKEN: token } : {},
    );
  }

  if (draftId) {
    try {
      if (!ok) throw new Error("packaging failed");
      await github.publishDraft(draftId, version);
      console.log(`Release v${version} is now public.`);
      await github
        .removeOlderReleases(draftId)
        .catch((err) =>
          console.warn(`Could not remove old releases: ${err.message}`),
        );
    } catch (err) {
      console.error(`\x1b[31mNot published: ${err.message}\x1b[0m`);
      ok = false;
      await github.deleteDraft(draftId).catch(() => {});
    }
  }

  return ok;
}

main().then(finish, (err) => {
  console.error(err);
  finish(false);
});

function finish(ok) {
  // always restore the project to development mode, even if a step failed
  run("3/3 Cleaning up build files", "node scripts/cleanBuilds.js");
  restoreBuildGeneratedFiles();

  const installer = ok ? newestInstaller() : null;
  const minutes = ((Date.now() - started) / 60000).toFixed(1);

  if (installer) {
    console.log(
      `\n\x1b[32mSUCCESS (${minutes} min): Graceville Fast Bible ${version}\n${installer}`,
    );
    if (publish)
      console.log(
        "Published to GitHub Releases: installed apps will update themselves when they are next closed.",
      );
    console.log("\x1b[0m");
    process.exit(0);
  } else {
    console.log(
      `\n\x1b[31mBUILD FAILED after ${minutes} min - see the red text above.\x1b[0m\n`,
    );
    process.exit(1);
  }
}
