/**
 * Client-side GitHub publisher — creates the repo (if needed) and pushes the
 * entire reader app as ONE commit via the Git Data API, using the user's
 * personal access token that lives ONLY in this browser tab.
 *
 * Token scope needed: "repo" (classic) or "Contents: read and write" +
 * "Administration: write" (fine-grained, for repo creation).
 */

const API = "https://api.github.com";

export interface GithubConfig {
  token: string;
  repoName: string;
  private?: boolean;
}

export interface PublishResult {
  repoUrl: string; // https://github.com/owner/repo
  vercelUrl: string; // deploy-to-vercel link
  commitSha: string;
}

async function gh(path: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "booklith-builder",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = res.status === 401 ? "Check your token." : res.status === 403 ? "Check the token's scopes/permissions." : body.slice(0, 300);
    throw new Error(`GitHub API ${res.status} on ${path}: ${hint}`);
  }
  return res;
}

export async function publishToGithub(files: Record<string, string>, cfg: GithubConfig, onProgress?: (m: string) => void): Promise<PublishResult> {
  const { token } = cfg;
  const repoName = cfg.repoName.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  if (!repoName) throw new Error("Repository name is required.");

  onProgress?.("Checking your GitHub account…");
  const user = (await (await gh("/user", token)).json()) as { login: string };
  const owner = user.login;
  const fullName = `${owner}/${repoName}`;

  // 1. ensure the repo exists
  let repoInfo: { default_branch?: string | null } | null = null;
  const repoRes = await fetch(`${API}/repos/${fullName}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "booklith-builder" },
  });
  if (repoRes.status === 404) {
    onProgress?.(`Creating repository ${fullName}…`);
    const created = await gh("/user/repos", token, {
      method: "POST",
      body: JSON.stringify({ name: repoName, private: !!cfg.private, description: "Book website built with Booklith (MIT)", auto_init: true }),
    });
    repoInfo = await created.json();
  } else if (repoRes.ok) {
    repoInfo = await repoRes.json();
  } else {
    throw new Error(`GitHub API ${repoRes.status}: ${(await repoRes.text()).slice(0, 200)}`);
  }

  // 2. find the head commit of the default branch (if any)
  const branch = repoInfo?.default_branch || "main";
  let baseCommitSha: string | null = null;
  const refRes = await fetch(`${API}/repos/${fullName}/git/ref/heads/${branch}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "booklith-builder" },
  });
  if (refRes.ok) {
    baseCommitSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;
  } else if (refRes.status === 404 || refRes.status === 409) {
    onProgress?.("Initializing empty repository…");
    const initialized = await gh(`/repos/${fullName}/contents/README.md`, token, {
      method: "PUT",
      body: JSON.stringify({
        message: "Initialize repository for Booklith export",
        content: btoa("Booklith repository initialization\n"),
        branch,
      }),
    });
    const result = (await initialized.json()) as { commit?: { sha?: string } };
    if (!result.commit?.sha) throw new Error("GitHub initialized the repository but returned no commit SHA.");
    baseCommitSha = result.commit.sha;
  } else {
    throw new Error(`GitHub API ${refRes.status} on /repos/${fullName}/git/ref/heads/${branch}: ${(await refRes.text()).slice(0, 300)}`);
  }

  let baseTreeSha: string | null = null;
  if (baseCommitSha) {
    const baseCommit = (await (
      await gh(`/repos/${fullName}/git/commits/${baseCommitSha}`, token)
    ).json()) as { tree: { sha: string } };
    baseTreeSha = baseCommit.tree.sha;
  }

  // 3. create blobs for every file
  const treeItems: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
  let n = 0;
  for (const [path, content] of Object.entries(files)) {
    onProgress?.(`Uploading files… ${++n}/${Object.keys(files).length}`);
    const blob = (await (
      await gh(`/repos/${fullName}/git/blobs`, token, { method: "POST", body: JSON.stringify({ content, encoding: "utf-8" }) })
    ).json()) as { sha: string };
    treeItems.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }

  // 4. one tree + one commit
  onProgress?.("Creating commit…");
  const treePayload: Record<string, unknown> = { tree: treeItems };
  if (baseTreeSha) treePayload.base_tree = baseTreeSha;
  const tree = (await (
    await gh(`/repos/${fullName}/git/trees`, token, { method: "POST", body: JSON.stringify(treePayload) })
  ).json()) as { sha: string };

  const commitPayload: Record<string, unknown> = {
    message: "Build book website with Booklith",
    tree: tree.sha,
  };
  if (baseCommitSha) commitPayload.parents = [baseCommitSha];
  const commit = (await (
    await gh(`/repos/${fullName}/git/commits`, token, { method: "POST", body: JSON.stringify(commitPayload) })
  ).json()) as { sha: string };

  // 5. point the branch at the commit
  if (baseCommitSha) {
    await gh(`/repos/${fullName}/git/refs/heads/${encodeURIComponent(branch)}`, token, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } else {
    await gh(`/repos/${fullName}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
  }

  const repoUrl = `https://github.com/${fullName}`;
  const envKeys = "API_KEY,API_BASE_URL,API_MODEL,MODAL_TTS_URL,MODAL_TTS_INSTRUCT,MODAL_TTS_HEADERS,TAVILY_API_KEY";
  return {
    repoUrl,
    vercelUrl: `https://vercel.com/new/clone?repository-url=${encodeURIComponent(repoUrl)}&project-name=${encodeURIComponent(repoName)}&env=${envKeys}`,
    commitSha: commit.sha,
  };
}
