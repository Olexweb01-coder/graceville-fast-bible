// Graceville Fast Bible: makes publishing to GitHub Releases safe for self-updates.
//
// electron-builder uploads its files at the same time, and each upload may try to create the release.
// That can make two releases with one tag, or fail half-way ("Published releases must have a valid tag"),
// leaving a release without latest.yml, which stops every installed app from finding updates.
//
// So the release is handled here instead:
//   1. before packaging: remove broken releases, then create ONE hidden draft for this version
//   2. electron-builder uploads every file into that draft
//   3. only when all files are there is the draft published, so installed apps never see a half release
//   (if anything fails, the draft is deleted again)

const API = "https://api.github.com";
const REQUIRED_FILES = (version) => [
  "latest.yml",
  `Graceville-Fast-Bible-Setup-${version}.exe`,
  `Graceville-Fast-Bible-Setup-${version}.exe.blockmap`,
];

function createGitHub({ token, owner, repo, request = globalThis.fetch }) {
  async function call(method, path, body) {
    const response = await request(`${API}/repos/${owner}/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "graceville-fast-bible-builder",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (
      method === "DELETE" &&
      (response.status === 404 || response.status === 422)
    )
      return null; // already gone
    if (!response.ok)
      throw new Error(
        `GitHub ${method} ${path} failed: ${response.status} ${await response.text()}`,
      );
    return response.status === 204 ? null : response.json();
  }

  async function listReleases() {
    const all = [];
    for (let page = 1; page <= 10; page++) {
      const releases = await call("GET", `/releases?per_page=100&page=${page}`);
      all.push(...releases);
      if (releases.length < 100) break;
    }
    return all;
  }

  async function deleteRelease(release, remaining) {
    await call("DELETE", `/releases/${release.id}`);
    // the tag goes too, unless another (good) release still uses it
    const tagStillUsed = remaining.some(
      (other) => other.id !== release.id && other.tag_name === release.tag_name,
    );
    if (!release.draft && !tagStillUsed)
      await call(
        "DELETE",
        `/git/refs/tags/${encodeURIComponent(release.tag_name)}`,
      );
  }

  const hasUpdateInfo = (release) =>
    (release.assets || []).some((asset) => asset.name === "latest.yml");

  return {
    /** Removes published releases without latest.yml (they break self-updates) and any old copy of this version. */
    async cleanUp(tag) {
      let releases = await listReleases();
      const broken = releases.filter(
        (release) => release.tag_name === tag || !hasUpdateInfo(release),
      );
      for (const release of broken) {
        releases = releases.filter((other) => other.id !== release.id);
        await deleteRelease(release, releases);
        console.log(
          `Removed ${release.draft ? "draft" : "broken release"} ${release.tag_name}`,
        );
      }
      // an old tag of this version without a release (from a failed run)
      if (!releases.some((release) => release.tag_name === tag))
        await call("DELETE", `/git/refs/tags/${encodeURIComponent(tag)}`);
      return broken.length;
    },

    async createDraft(tag, version, commit) {
      const release = await call("POST", "/releases", {
        tag_name: tag,
        target_commitish: commit,
        name: version,
        body: `Graceville Fast Bible ${version}`,
        draft: true,
        prerelease: false,
      });
      return release.id;
    },

    /** Publishes the draft, but only if every file installed apps need is in it. */
    async publishDraft(id, version) {
      const release = await call("GET", `/releases/${id}`);
      const names = (release.assets || [])
        .filter((asset) => asset.state === "uploaded")
        .map((asset) => asset.name);
      const missing = REQUIRED_FILES(version).filter(
        (name) => !names.includes(name),
      );
      if (missing.length)
        throw new Error(`The release is missing: ${missing.join(", ")}`);
      await call("PATCH", `/releases/${id}`, {
        draft: false,
        make_latest: "true",
      });
    },

    async deleteDraft(id) {
      await call("DELETE", `/releases/${id}`);
    },
  };
}

module.exports = { createGitHub, REQUIRED_FILES };
