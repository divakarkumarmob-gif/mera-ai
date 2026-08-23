// ---------------------------------------------------------------------------
// GitHub API wrapper for the coding agent.
//
// Uses the GitHub REST + Git Data API directly over HTTPS — no local git
// clone/push, which wouldn't survive Render's ephemeral filesystem anyway.
// Every write operation creates a NEW branch (never touches the base branch
// directly) and opens a Pull Request, so nothing lands on main without a
// human reviewing it on GitHub.
//
// Required env vars:
//   GITHUB_TOKEN        — fine-grained PAT scoped to this repo only
//                          (Contents: Read & write, Pull requests: Read & write)
//   GITHUB_REPO          — "owner/repo", e.g. "dk-username/mera-ai-master"
//   GITHUB_BASE_BRANCH   — optional, defaults to "main"
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";

function getConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const baseBranch = process.env.GITHUB_BASE_BRANCH || "main";
  if (!token || !repo) {
    throw new Error("[GitHubService] GITHUB_TOKEN and GITHUB_REPO must be set in the environment.");
  }
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`[GitHubService] GITHUB_REPO must be in "owner/repo" format, got: "${repo}"`);
  }
  return { token, owner, name, baseBranch };
}

async function ghFetch(path: string, init?: RequestInit) {
  const { token } = getConfig();
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`[GitHubService] ${init?.method || "GET"} ${path} failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  return res.json();
}

export interface RepoFile {
  path: string;
  content: string;
}

export interface FileChange {
  path: string;
  content: string; // full new file content
}

class GitHubService {
  /** Lists every file path in the repo (recursive), filtered to source-ish files only. */
  public async listRepoFiles(ref?: string): Promise<string[]> {
    const { owner, name, baseBranch } = getConfig();
    const branch = ref || baseBranch;
    const data = await ghFetch(`/repos/${owner}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const tree = (data.tree || []) as { path: string; type: string }[];
    const EXCLUDE = /(^|\/)(node_modules|dist|build|\.git)(\/|$)/;
    return tree
      .filter((t) => t.type === "blob" && !EXCLUDE.test(t.path))
      .map((t) => t.path);
  }

  /** Fetches the raw text content of a single file from the given ref (branch). */
  public async getFileContent(path: string, ref?: string): Promise<string | null> {
    const { owner, name, baseBranch } = getConfig();
    const branch = ref || baseBranch;
    try {
      const data = await ghFetch(`/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`);
      if (data.encoding === "base64" && typeof data.content === "string") {
        return Buffer.from(data.content, "base64").toString("utf-8");
      }
      return null;
    } catch (e) {
      console.error(`[GitHubService] Failed to fetch file "${path}":`, e);
      return null;
    }
  }

  public async getMultipleFiles(paths: string[], ref?: string): Promise<RepoFile[]> {
    const results: RepoFile[] = [];
    for (const path of paths) {
      const content = await this.getFileContent(path, ref);
      if (content !== null) results.push({ path, content });
    }
    return results;
  }

  public async getBaseBranch(): Promise<string> {
    const { owner, name } = getConfig();
    if (process.env.GITHUB_BASE_BRANCH) {
      return process.env.GITHUB_BASE_BRANCH;
    }
    try {
      const repoInfo = await ghFetch(`/repos/${owner}/${name}`);
      if (repoInfo.default_branch) {
        return repoInfo.default_branch;
      }
    } catch {}
    return "master";
  }

  /**
   * Creates a new branch off the base branch, commits the given file changes to it
   * (create or update — existing files are overwritten with new full content), and
   * opens a Pull Request against the base branch.
   */
  public async commitChangesAsPR(
    branchName: string,
    changes: FileChange[],
    commitMessage: string,
    prTitle: string,
    prBody: string
  ): Promise<{ branchUrl: string; prUrl: string; prNumber?: number }> {
    const { owner, name } = getConfig();
    const baseBranch = await this.getBaseBranch();

    if (changes.length === 0) {
      throw new Error("[GitHubService] No file changes to commit.");
    }

    // 1. Resolve base branch head commit + its tree.
    const baseRef = await ghFetch(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
    const baseCommitSha = baseRef.object.sha;
    const baseCommit = await ghFetch(`/repos/${owner}/${name}/git/commits/${baseCommitSha}`);
    const baseTreeSha = baseCommit.tree.sha;

    // 2. Create a blob for each changed file.
    const treeEntries = [];
    for (const change of changes) {
      const blob = await ghFetch(`/repos/${owner}/${name}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: change.content, encoding: "utf-8" }),
      });
      treeEntries.push({
        path: change.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    // 3. Create a new tree layered on top of the base tree.
    const newTree = await ghFetch(`/repos/${owner}/${name}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });

    // 4. Create the commit.
    const newCommit = await ghFetch(`/repos/${owner}/${name}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: commitMessage,
        tree: newTree.sha,
        parents: [baseCommitSha],
      }),
    });

    // 5. Create the new branch pointing at that commit.
    await ghFetch(`/repos/${owner}/${name}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: newCommit.sha }),
    });

    // 6. Open a Pull Request for human review/merge.
    let prUrl = `https://github.com/${owner}/${name}/tree/${branchName}`;
    let prNumber: number | undefined;
    try {
      const pr = await ghFetch(`/repos/${owner}/${name}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          title: prTitle,
          head: branchName,
          base: baseBranch,
          body: prBody,
        }),
      });
      prUrl = pr.html_url;
      prNumber = pr.number;
    } catch (e) {
      console.warn("[GitHubService] Pull request creation notice:", e);
    }

    return {
      branchUrl: `https://github.com/${owner}/${name}/tree/${branchName}`,
      prUrl,
      prNumber,
    };
  }

  /**
   * Commits the given file changes directly to the repository's base/main branch (e.g. master/main)
   * on GitHub origin.
   */
  public async commitChangesToBase(
    changes: FileChange[],
    commitMessage: string
  ): Promise<{ commitSha: string; commitUrl: string; baseBranch: string }> {
    const { owner, name } = getConfig();
    const baseBranch = await this.getBaseBranch();

    if (changes.length === 0) {
      throw new Error("[GitHubService] No file changes to commit.");
    }

    // 1. Resolve base branch head commit + its tree.
    const baseRef = await ghFetch(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
    const baseCommitSha = baseRef.object.sha;
    const baseCommit = await ghFetch(`/repos/${owner}/${name}/git/commits/${baseCommitSha}`);
    const baseTreeSha = baseCommit.tree.sha;

    // 2. Create a blob for each changed file.
    const treeEntries = [];
    for (const change of changes) {
      const blob = await ghFetch(`/repos/${owner}/${name}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: change.content, encoding: "utf-8" }),
      });
      treeEntries.push({
        path: change.path,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      });
    }

    // 3. Create a new tree layered on top of the base tree.
    const newTree = await ghFetch(`/repos/${owner}/${name}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });

    // 4. Create the commit.
    const newCommit = await ghFetch(`/repos/${owner}/${name}/git/commits`, {
      method: "POST",
      body: JSON.stringify({
        message: commitMessage,
        tree: newTree.sha,
        parents: [baseCommitSha],
      }),
    });

    // 5. Update the base branch reference to point directly to newCommit.
    await ghFetch(`/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(baseBranch)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommit.sha, force: false }),
    });

    return {
      commitSha: newCommit.sha,
      commitUrl: `https://github.com/${owner}/${name}/commit/${newCommit.sha}`,
      baseBranch,
    };
  }

  /**
   * Merges an existing Pull Request into the base branch if open.
   */
  public async mergePR(prNumber: number, commitMessage?: string): Promise<{ merged: boolean; sha: string; message: string }> {
    const { owner, name } = getConfig();
    return await ghFetch(`/repos/${owner}/${name}/pulls/${prNumber}/merge`, {
      method: "PUT",
      body: JSON.stringify({
        commit_title: commitMessage || "Merge pull request via Friday Coding Agent",
        merge_method: "merge",
      }),
    });
  }
}

export const githubService = new GitHubService();
