const { withRetry } = require('../../utils/retry');
const { mapGitHubError } = require('./error_mapper');

let CachedOctokit = null;

/**
 * Dynamically loads Octokit class to support both CommonJS and ESM environments.
 */
const getOctokitClass = async () => {
  if (!CachedOctokit) {
    const module = await import('@octokit/rest');
    CachedOctokit = module.Octokit || module.default?.Octokit || module.default;
  }
  return CachedOctokit;
};

/**
 * Creates an Octokit instance with optional auth token and default timeout.
 */
const createOctokitClient = async (token = process.env.GITHUB_TOKEN) => {
  const Octokit = await getOctokitClass();
  const options = {
    request: {
      timeout: 10000, // 10s request timeout
    },
  };

  if (token && typeof token === 'string' && token.trim().length > 0) {
    options.auth = token.trim();
  }

  return new Octokit(options);
};

/**
 * Fetches the default branch and the HEAD commit SHA for a repository.
 */
const fetchHeadInfo = async (octokit, owner, repo) => {
  return withRetry(async () => {
    const { data: repoData } = await octokit.rest.repos.get({
      owner,
      repo,
    });

    const defaultBranch = repoData.default_branch || 'main';

    const { data: commitData } = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: defaultBranch,
    });

    return {
      defaultBranch,
      headSha: commitData.sha,
    };
  });
};

/**
 * Fetches the complete recursive tree for a given commit SHA.
 */
const fetchRepositoryTree = async (octokit, owner, repo, treeSha) => {
  return withRetry(async () => {
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: treeSha,
      recursive: 'true',
    });

    const items = Array.isArray(data.tree) ? data.tree : [];

    const tree = items.map((item) => ({
      path: item.path,
      mode: item.mode,
      type: item.type, // 'blob' (file) or 'tree' (directory)
      sha: item.sha,
      size: item.size || 0,
    }));

    const filePaths = tree.filter((item) => item.type === 'blob').map((item) => item.path);

    return {
      tree,
      filePaths,
      truncated: Boolean(data.truncated),
    };
  });
};

/**
 * Fetches the last 20 commits on the repository's default branch.
 */
const fetchRecentCommits = async (octokit, owner, repo, perPage = 20) => {
  return withRetry(async () => {
    const { data } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: perPage,
    });

    return data.map((item) => ({
      sha: item.sha,
      message: item.commit.message,
      author: {
        name: item.commit.author?.name || 'Unknown',
        email: item.commit.author?.email || '',
        date: item.commit.author?.date || null,
      },
      url: item.html_url,
    }));
  });
};

/**
 * Fetches and decodes the repository README file, if present.
 */
const fetchReadme = async (octokit, owner, repo) => {
  try {
    return await withRetry(async () => {
      const { data } = await octokit.rest.repos.getReadme({
        owner,
        repo,
      });

      const content = data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : '';

      return {
        exists: true,
        filename: data.name || 'README.md',
        path: data.path || 'README.md',
        size: data.size || content.length,
        content,
      };
    });
  } catch (error) {
    if (error.status === 404) {
      return {
        exists: false,
        filename: null,
        path: null,
        size: 0,
        content: null,
      };
    }
    throw error;
  }
};

/**
 * Fetches and parses package.json if present in the repository tree.
 */
const fetchPackageJson = async (octokit, owner, repo, filePaths) => {
  const hasPackageJson = filePaths.some((p) => p.toLowerCase() === 'package.json');
  if (!hasPackageJson) {
    return {
      exists: false,
      parsed: null,
      raw: null,
      parseError: null,
    };
  }

  try {
    return await withRetry(async () => {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: 'package.json',
      });

      if (!data.content) {
        return {
          exists: true,
          parsed: null,
          raw: '',
          parseError: 'Empty package.json content',
        };
      }

      const raw = Buffer.from(data.content, 'base64').toString('utf-8');
      let parsed = null;
      let parseError = null;

      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        parseError = `Invalid JSON: ${err.message}`;
      }

      return {
        exists: true,
        parsed,
        raw,
        parseError,
      };
    });
  } catch (error) {
    if (error.status === 404) {
      return {
        exists: false,
        parsed: null,
        raw: null,
        parseError: null,
      };
    }
    throw error;
  }
};

/**
 * Fetches and decodes the repository Dockerfile if present in the tree.
 */
const fetchDockerfile = async (octokit, owner, repo, filePaths) => {
  const dockerfilePath = filePaths.find((p) => /(^|\/)Dockerfile(\.[a-zA-Z0-9_-]+)?$/i.test(p));
  if (!dockerfilePath) {
    return {
      exists: false,
      path: null,
      content: null,
    };
  }

  try {
    return await withRetry(async () => {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: dockerfilePath,
      });

      const content = data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : '';

      return {
        exists: true,
        path: dockerfilePath,
        content,
      };
    });
  } catch (error) {
    if (error.status === 404) {
      return {
        exists: false,
        path: null,
        content: null,
      };
    }
    throw error;
  }
};

/**
 * Fetches root .gitignore content when present in the tree.
 * Used by the secrets checker to verify .env exclusion rules.
 */
const fetchGitignore = async (octokit, owner, repo, filePaths) => {
  const hasGitignore = filePaths.some((p) => p.toLowerCase() === '.gitignore');
  if (!hasGitignore) {
    return {
      exists: false,
      path: null,
      content: null,
    };
  }

  try {
    return await withRetry(async () => {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: '.gitignore',
      });

      const content = data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : '';

      return {
        exists: true,
        path: '.gitignore',
        content,
      };
    });
  } catch (error) {
    if (error.status === 404) {
      return {
        exists: false,
        path: null,
        content: null,
      };
    }
    throw error;
  }
};

/**
 * Fetches a full repository snapshot required by the Release Readiness Checkers.
 *
 * @param {Object} params
 * @param {string} params.owner - GitHub repository owner
 * @param {string} params.repo - GitHub repository name
 * @param {string} [params.token] - Optional GitHub PAT
 * @param {Octokit} [params.octokitClient] - Optional injected Octokit client for testing
 * @returns {Promise<Object>} Snapshot containing tree, commits, README, package.json,
 *   Dockerfile, .gitignore, HEAD SHA, and the Octokit client for follow-up blob scans
 */
const fetchRepositorySnapshot = async ({ owner, repo, token, octokitClient }) => {
  const client = octokitClient || (await createOctokitClient(token));

  try {
    // 1. Resolve HEAD commit SHA and default branch
    const { defaultBranch, headSha } = await fetchHeadInfo(client, owner, repo);

    // 2. Concurrently fetch Git Tree, Recent Commits, and README
    const [treeResult, commits, readme] = await Promise.all([
      fetchRepositoryTree(client, owner, repo, headSha),
      fetchRecentCommits(client, owner, repo, 20),
      fetchReadme(client, owner, repo),
    ]);

    // 3. Fetch package.json, Dockerfile, and .gitignore if present in the tree
    const [packageJson, dockerfile, gitignore] = await Promise.all([
      fetchPackageJson(client, owner, repo, treeResult.filePaths),
      fetchDockerfile(client, owner, repo, treeResult.filePaths),
      fetchGitignore(client, owner, repo, treeResult.filePaths),
    ]);

    return {
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      defaultBranch,
      headSha,
      tree: treeResult.tree,
      filePaths: treeResult.filePaths,
      treeTruncated: treeResult.truncated,
      commits,
      readme,
      packageJson,
      dockerfile,
      gitignore,
      // Explicit client for checkers that need extra GitHub calls (e.g. blob content scans).
      // Same instance used to build this snapshot — no second client is created.
      octokit: client,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw mapGitHubError(error, { owner, repo });
  }
};

module.exports = {
  createOctokitClient,
  fetchHeadInfo,
  fetchRepositoryTree,
  fetchRecentCommits,
  fetchReadme,
  fetchPackageJson,
  fetchDockerfile,
  fetchGitignore,
  fetchRepositorySnapshot,
};
