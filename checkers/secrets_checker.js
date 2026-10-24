/**
 * Secrets Checker
 *
 * Scans a repository snapshot for accidentally committed secrets and
 * risky file patterns. Uses a CAPPED content scan:
 *  - Skips binary files (null bytes detected in first 8 KB)
 *  - Skips files larger than 100 KB
 *  - Scans at most MAX_FILES_TO_SCAN files total
 *  - Fetches raw content via the Git Blob API (base64-decoded)
 *  - REDACTS detected secrets — never stores the raw secret value
 *
 * Checks:
 *  1. Risky file paths present in the tree (instant, no API call)
 *  2. .env listed in .gitignore (content-based, if .gitignore present)
 *  3. Capped content scan for token patterns across text files
 *
 * Snapshot inputs (from snapshot_service):
 *  - filePaths, tree, owner, repo (required for path checks)
 *  - gitignore: { content } (optional; enables .env ignore verification)
 *  - octokit (optional; enables blob content scanning)
 */

const { withRetry } = require('../utils/retry');
const { FindingType, createFinding, createCheckerResult, hasFile } = require('./helpers');

const CHECKER_ID = 'secrets';
const CHECKER_NAME = 'Secrets & Sensitive Data';

/** Maximum number of files whose content we will fetch and scan. */
const MAX_FILES_TO_SCAN = 50;

/** Maximum file size in bytes we will scan (100 KB). */
const MAX_FILE_SIZE_BYTES = 100 * 1024;

/**
 * Risky file paths/patterns whose mere presence in the tree is a risk signal.
 * We do NOT read their content — presence alone is the signal.
 */
const RISKY_PATH_PATTERNS = [
  { pattern: /(^|\/)\.env$/, label: '.env file' },
  { pattern: /(^|\/)\.env\.local$/, label: '.env.local file' },
  { pattern: /(^|\/)\.env\.production$/, label: '.env.production file' },
  { pattern: /(^|\/)\.env\.staging$/, label: '.env.staging file' },
  { pattern: /\/id_rsa$/, label: 'RSA private key (id_rsa)' },
  { pattern: /\/id_dsa$/, label: 'DSA private key (id_dsa)' },
  { pattern: /\/id_ecdsa$/, label: 'ECDSA private key (id_ecdsa)' },
  { pattern: /\/id_ed25519$/, label: 'Ed25519 private key (id_ed25519)' },
  { pattern: /\.pem$/i, label: '.pem certificate/key file' },
  { pattern: /\.pfx$/i, label: '.pfx certificate bundle' },
  { pattern: /\.p12$/i, label: '.p12 certificate bundle' },
  { pattern: /(^|\/)credentials\.json$/i, label: 'credentials.json (GCP service account)' },
  { pattern: /(^|\/)service[-_]account\.json$/i, label: 'service account JSON' },
  { pattern: /(^|\/)\.npmrc$/, label: '.npmrc (may contain auth tokens)' },
  { pattern: /(^|\/)\.pypirc$/, label: '.pypirc (may contain PyPI credentials)' },
  { pattern: /(^|\/)secrets\.json$/i, label: 'secrets.json' },
  { pattern: /(^|\/)secrets\.yaml$/i, label: 'secrets.yaml' },
  { pattern: /(^|\/)secrets\.yml$/i, label: 'secrets.yml' },
];

/**
 * Regex patterns for common secret tokens.
 * Each entry: { id, label, pattern }
 * Patterns may capture for matching, but we NEVER return or store matched text.
 */
const SECRET_PATTERNS = [
  {
    id: 'GITHUB_PAT',
    label: 'GitHub Personal Access Token',
    pattern: /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})\b/,
  },
  {
    id: 'AWS_ACCESS_KEY',
    label: 'AWS Access Key ID',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: 'AWS_SECRET_KEY',
    label: 'AWS Secret Access Key',
    pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?[A-Za-z0-9+/]{40}["']?/i,
  },
  {
    id: 'SLACK_TOKEN',
    label: 'Slack API Token',
    pattern: /\b(xox[baprs]-[0-9A-Za-z]{10,48})\b/,
  },
  {
    id: 'STRIPE_SECRET',
    label: 'Stripe Secret Key',
    pattern: /\bsk_live_[0-9A-Za-z]{24,}\b/,
  },
  {
    id: 'GOOGLE_API_KEY',
    label: 'Google API Key',
    pattern: /\bAIza[0-9A-Za-z-_]{35}\b/,
  },
  {
    id: 'PRIVATE_KEY_BLOCK',
    label: 'PEM Private Key Block',
    pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    id: 'GENERIC_SECRET_ASSIGN',
    label: 'Generic secret assignment',
    pattern:
      /(?:^|[^A-Za-z])(?:secret|password|passwd|api_key|apikey|auth_token|access_token)\s*[=:]\s*["']?[A-Za-z0-9+/!@#$%^&*]{16,}["']?/im,
  },
];

/**
 * Returns true if the buffer looks like a binary file.
 * Strategy: check the first 8 KB for null bytes (0x00).
 */
const isBinary = (buffer) => {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
};

/**
 * Scans text content for secret patterns.
 * Returns an array of { id, label } for each matched pattern.
 * NEVER returns the raw matched text.
 */
const scanForSecrets = (content) => {
  const hits = [];
  for (const { id, label, pattern } of SECRET_PATTERNS) {
    // Reset lastIndex for global/multiline patterns reused across files
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      hits.push({ id, label });
    }
  }
  return hits;
};

/**
 * Fetches a single blob from the Git Blob API via Octokit.
 * Returns decoded text content, or null if skipped (binary / too large).
 *
 * @param {Object} octokit - Authenticated Octokit client
 * @param {string} owner
 * @param {string} repo
 * @param {string} sha - Git blob SHA from the tree
 * @param {number} size - File size in bytes (from tree entry)
 */
const fetchBlobContent = async (octokit, owner, repo, sha, size) => {
  // Skip oversized files without an API call
  if (size > MAX_FILE_SIZE_BYTES) return null;

  const { data } = await withRetry(() =>
    octokit.rest.git.getBlob({
      owner,
      repo,
      file_sha: sha,
    })
  );

  const buffer = Buffer.from(data.content, 'base64');

  if (isBinary(buffer)) return null;

  return buffer.toString('utf-8');
};

/**
 * Checks whether `.env` is listed in `.gitignore`.
 * Returns true (safe), false (missing), or null (no .gitignore content available).
 *
 * @param {Object} snapshot
 */
const checkEnvInGitignore = (snapshot) => {
  const gitignoreContent = snapshot.gitignore?.content;
  if (!gitignoreContent || typeof gitignoreContent !== 'string') return null;

  const lines = gitignoreContent
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  // Accept common exclusions: .env, .env*, *.env, **/.env, **/.env*
  return lines.some((line) => {
    const normalized = line.replace(/^\*\*\//, '');
    return (
      normalized === '.env' ||
      normalized === '.env*' ||
      normalized === '*.env' ||
      /^\.env(\*|(\.[A-Za-z0-9_-]+))?$/.test(normalized)
    );
  });
};

/**
 * Main checker entry point.
 *
 * @param {Object} snapshot
 * @returns {Promise<Object>} Standardized CheckerResult
 */
const run = async (snapshot = {}) => {
  const { filePaths = [], tree = [], owner, repo, octokit } = snapshot;
  const findings = [];
  let score = 100;

  // ─── Step 1: Risky Path Scan (no API calls) ────────────────────────────────
  const riskyPathsFound = [];

  for (const { pattern, label } of RISKY_PATH_PATTERNS) {
    const match = filePaths.find((p) => pattern.test(p));
    if (match) {
      riskyPathsFound.push({ path: match, label });
    }
  }

  if (riskyPathsFound.length > 0) {
    for (const { path, label } of riskyPathsFound) {
      findings.push(
        createFinding({
          id: 'SECRETS_RISKY_FILE_PRESENT',
          type: FindingType.RISK,
          title: `Sensitive file committed: ${label}`,
          description: `The file "${path}" should never be committed to version control. It likely contains credentials, certificates, or tokens that are now part of the permanent git history.`,
          evidence: `File found in repository tree: ${path}`,
          filePath: path,
        })
      );
      score -= 30;
    }
  }

  // ─── Step 2: .env in .gitignore ────────────────────────────────────────────
  const gitignoreExists = hasFile(filePaths, '.gitignore');

  if (!gitignoreExists) {
    findings.push(
      createFinding({
        id: 'SECRETS_NO_GITIGNORE',
        type: FindingType.RISK,
        title: 'No .gitignore found',
        description:
          'Repository has no .gitignore. Without one, local .env files, node_modules, and OS-generated files risk being accidentally committed.',
        evidence: 'No .gitignore file found in repository tree',
      })
    );
    score -= 25;
  } else {
    const envIgnored = checkEnvInGitignore(snapshot);
    if (envIgnored === false) {
      findings.push(
        createFinding({
          id: 'SECRETS_ENV_NOT_GITIGNORED',
          type: FindingType.RISK,
          title: '.env not listed in .gitignore',
          description:
            'A .gitignore exists but does not exclude .env files. Any developer who runs the app locally risks accidentally committing credentials.',
          evidence: '.gitignore present but does not contain a .env exclusion rule',
          filePath: '.gitignore',
        })
      );
      score -= 20;
    } else if (envIgnored === true) {
      findings.push(
        createFinding({
          id: 'SECRETS_ENV_GITIGNORED',
          type: FindingType.SUCCESS,
          title: '.env excluded in .gitignore',
          description:
            '.gitignore correctly excludes .env files, preventing accidental credential commits.',
          evidence: '.gitignore contains a .env exclusion rule',
          filePath: '.gitignore',
        })
      );
    }
    // envIgnored === null → content unavailable; no finding either way
  }

  // ─── Step 3: Capped Content Scan ────────────────────────────────────────────
  const contentScanHits = [];
  let filesScanned = 0;

  if (octokit && owner && repo) {
    const blobs = tree
      .filter(
        (item) =>
          item.type === 'blob' &&
          item.sha &&
          item.size != null &&
          item.size <= MAX_FILE_SIZE_BYTES &&
          item.size > 0
      )
      .slice(0, MAX_FILES_TO_SCAN);

    for (const blob of blobs) {
      let content;
      try {
        content = await fetchBlobContent(octokit, owner, repo, blob.sha, blob.size);
      } catch {
        // Network / API error on a single blob — skip and continue
        continue;
      }

      if (!content) continue; // Binary, oversized, or empty

      filesScanned += 1;

      const hits = scanForSecrets(content);
      for (const hit of hits) {
        contentScanHits.push({ path: blob.path, id: hit.id, label: hit.label });
        findings.push(
          createFinding({
            id: 'SECRETS_TOKEN_DETECTED',
            type: FindingType.RISK,
            title: `Potential secret detected: ${hit.label}`,
            description: `A pattern matching a ${hit.label} was found in "${blob.path}". The matched value has been redacted. Rotate any affected credentials immediately and consider using git-filter-repo to purge the secret from history.`,
            evidence: `Pattern "${hit.id}" matched in ${blob.path} (value redacted)`,
            filePath: blob.path,
          })
        );
        score -= 25;
      }
    }
  }

  if (findings.length === 0) {
    findings.push(
      createFinding({
        id: 'SECRETS_NO_ISSUES_FOUND',
        type: FindingType.SUCCESS,
        title: 'No secrets or sensitive files detected',
        description:
          'No risky file paths, missing .gitignore rules, or common secret patterns were found in the scanned files.',
        evidence: `Scanned ${filesScanned} files; no matches`,
      })
    );
  }

  return createCheckerResult({
    checkerId: CHECKER_ID,
    name: CHECKER_NAME,
    score,
    findings,
    metadata: {
      riskyPathsFound: riskyPathsFound.map((r) => r.path),
      contentScanEnabled: Boolean(octokit && owner && repo),
      filesScanned,
      secretsDetected: contentScanHits.length,
    },
  });
};

module.exports = {
  CHECKER_ID,
  CHECKER_NAME,
  MAX_FILES_TO_SCAN,
  MAX_FILE_SIZE_BYTES,
  isBinary,
  scanForSecrets,
  checkEnvInGitignore,
  run,
};
