const { FindingType, createFinding, createCheckerResult, findFile } = require('./helpers');

const CHECKER_ID = 'docker';
const CHECKER_NAME = 'Docker & Containerization';

/**
 * Detects whether Dockerfile content copies the entire directory
 * (e.g., `COPY . .`, `COPY . /app`, `ADD . .`, `ADD . /app`)
 */
const detectBlindCopy = (content) => {
  if (!content || typeof content !== 'string') return null;

  const lines = content.split('\n');
  const copyPattern = /^\s*(COPY|ADD)\s+\.\s+(\S+)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip comments
    if (line.startsWith('#')) continue;

    const match = line.match(copyPattern);
    if (match) {
      return {
        line: line,
        lineNumber: i + 1,
      };
    }
  }

  return null;
};

/**
 * Analyzes repository containerization readiness.
 *
 * Checks:
 * 1. Dockerfile presence
 * 2. .dockerignore presence
 * 3. Docker Compose presence
 * 4. Critical "COPY . . without .dockerignore" leak vulnerability
 *
 * @param {Object} snapshot - Repository snapshot from snapshot_service
 * @returns {Object} Standardized CheckerResult
 */
const run = (snapshot = {}) => {
  const filePaths = snapshot.filePaths || [];
  const findings = [];
  let score = 0;

  // 1. Check for Dockerfile
  const dockerfilePath =
    findFile(filePaths, /(^|\/)Dockerfile(\.[a-zA-Z0-9_-]+)?$/i) ||
    findFile(filePaths, /\.dockerfile$/i);

  // 2. Check for .dockerignore
  const dockerignorePath = findFile(filePaths, /(^|\/)\.dockerignore$/i);
  const hasDockerignore = Boolean(dockerignorePath);

  // 3. Check for Docker Compose
  const composePath = findFile(filePaths, /(^|\/)(docker-compose|compose)\.(ya?ml)$/i);

  if (dockerfilePath) {
    findings.push(
      createFinding({
        id: 'DOCKERFILE_PRESENT',
        type: FindingType.SUCCESS,
        title: 'Dockerfile Found',
        description: 'Repository contains a Dockerfile defining containerized runtime packaging.',
        evidence: `Located at ${dockerfilePath}`,
        filePath: dockerfilePath,
      })
    );
    score += 40;

    // Check .dockerignore status
    if (hasDockerignore) {
      findings.push(
        createFinding({
          id: 'DOCKERIGNORE_PRESENT',
          type: FindingType.SUCCESS,
          title: '.dockerignore Configured',
          description:
            '.dockerignore prevents build context bloat and prevents leaking local secrets or node_modules into the image.',
          evidence: `Located at ${dockerignorePath}`,
          filePath: dockerignorePath,
        })
      );
      score += 30;
    } else {
      findings.push(
        createFinding({
          id: 'DOCKERIGNORE_MISSING',
          type: FindingType.WARNING,
          title: '.dockerignore Missing',
          description:
            'No .dockerignore file was found. Building this container may inadvertently include large local caches, logs, or uncommitted files in the build context.',
          evidence: 'No .dockerignore file found in repository tree',
        })
      );
    }

    // 4. Critical Check: "COPY . ." without .dockerignore
    const dockerfileContent =
      (snapshot.dockerfile && snapshot.dockerfile.content) ||
      (typeof snapshot.dockerfileContent === 'string' ? snapshot.dockerfileContent : null);

    if (dockerfileContent && !hasDockerignore) {
      const blindCopy = detectBlindCopy(dockerfileContent);
      if (blindCopy) {
        findings.push(
          createFinding({
            id: 'DOCKER_COPY_WITHOUT_IGNORE',
            type: FindingType.RISK,
            title: 'Critical: Dockerfile copies entire directory without .dockerignore',
            description: `Dockerfile copies the entire repository context ("${blindCopy.line}") without a .dockerignore. This is a severe release vulnerability that risks baking .env credentials, node_modules, and git history directly into public container layers.`,
            evidence: `${dockerfilePath}: line ${blindCopy.lineNumber} ("${blindCopy.line}") without .dockerignore`,
            filePath: dockerfilePath,
          })
        );
        // Severe penalty for potential secret leakage
        score = Math.min(score, 25);
      }
    }
  } else {
    findings.push(
      createFinding({
        id: 'DOCKERFILE_MISSING',
        type: FindingType.RISK,
        title: 'Dockerfile Missing',
        description:
          'No Dockerfile was detected. Cloud runtimes and orchestrators (ECS, Cloud Run, Kubernetes) require container definitions for immutable, reproducible deployments.',
        evidence: 'No Dockerfile or *.dockerfile found in repository tree',
      })
    );
  }

  // Docker Compose evaluation
  if (composePath) {
    findings.push(
      createFinding({
        id: 'DOCKER_COMPOSE_PRESENT',
        type: FindingType.SUCCESS,
        title: 'Docker Compose Detected',
        description:
          'Multi-service configuration found, enabling one-step local or staging deployment.',
        evidence: `Located at ${composePath}`,
        filePath: composePath,
      })
    );
    score += 30;
  } else if (dockerfilePath) {
    findings.push(
      createFinding({
        id: 'DOCKER_COMPOSE_MISSING',
        type: FindingType.INFO,
        title: 'Docker Compose Not Found',
        description:
          'No docker-compose.yml found. While optional for single-container services, Compose simplifies local integration testing and developer onboarding.',
        evidence: 'No docker-compose.yml or compose.yml found in repository tree',
      })
    );
  }

  return createCheckerResult({
    checkerId: CHECKER_ID,
    name: CHECKER_NAME,
    score,
    findings,
    metadata: {
      dockerfilePath,
      dockerignorePath,
      composePath,
      hasDockerignore,
    },
  });
};

module.exports = {
  CHECKER_ID,
  CHECKER_NAME,
  detectBlindCopy,
  run,
};
