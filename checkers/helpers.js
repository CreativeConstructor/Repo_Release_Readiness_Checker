/**
 * Finding severity classifications for readiness checkers.
 */
const FindingType = {
  RISK: 'risk',
  WARNING: 'warning',
  SUCCESS: 'success',
  INFO: 'info',
};

/**
 * Creates a standardized finding object conforming to the system contract.
 *
 * @param {Object} params
 * @param {string} params.id - Unique uppercase alphanumeric finding identifier (e.g. 'DOCKERFILE_FOUND')
 * @param {string} params.type - One of 'risk', 'warning', 'success', 'info'
 * @param {string} params.title - Concise human-readable title
 * @param {string} params.description - Detailed explanation and justification
 * @param {string} params.evidence - Specific proof (e.g. file path, matching line, or missing requirement)
 * @param {string} [params.filePath] - Specific file path if applicable
 * @returns {Object} Finding object
 */
const createFinding = ({ id, type, title, description, evidence, filePath = null }) => {
  if (!id || !type || !title || !description || !evidence) {
    throw new Error(
      `Invalid finding: id, type, title, description, and evidence are mandatory fields. Received: ${JSON.stringify(
        { id, type, title }
      )}`
    );
  }

  const validTypes = Object.values(FindingType);
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid finding type: "${type}". Expected one of: ${validTypes.join(', ')}`);
  }

  return {
    id,
    type,
    title,
    description,
    evidence,
    ...(filePath ? { filePath } : {}),
  };
};

/**
 * Clamps a numerical score between 0 and 100 inclusive.
 */
const clampScore = (score) => {
  if (typeof score !== 'number' || isNaN(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
};

/**
 * Creates a standardized checker result object.
 *
 * @param {Object} params
 * @param {string} params.checkerId - Unique identifier (e.g. 'docker', 'ci')
 * @param {string} params.name - Human-readable display name (e.g. 'Docker & Containerization')
 * @param {number} params.score - 0 to 100 score
 * @param {Array<Object>} [params.findings=[]] - Array of finding objects
 * @param {Object} [params.metadata={}] - Arbitrary checker-specific metadata
 * @returns {Object} Normalized checker result
 */
const createCheckerResult = ({ checkerId, name, score, findings = [], metadata = {} }) => {
  const normalizedScore = clampScore(score);
  const hasCriticalRisk = findings.some((f) => f.type === FindingType.RISK);
  // A checker is considered passed if its score is at least 70 and has no unmitigated critical risks
  const passed = normalizedScore >= 70 && !hasCriticalRisk;

  return {
    checkerId,
    name,
    passed,
    score: normalizedScore,
    findings,
    metadata,
  };
};

/**
 * Checks whether any file path in the list matches the target string or RegExp.
 */
const hasFile = (filePaths = [], pattern) => {
  if (!Array.isArray(filePaths)) return false;
  if (typeof pattern === 'string') {
    const lower = pattern.toLowerCase();
    return filePaths.some((p) => p.toLowerCase() === lower);
  }
  if (pattern instanceof RegExp) {
    return filePaths.some((p) => pattern.test(p));
  }
  return false;
};

/**
 * Returns all file paths matching the given string or RegExp pattern.
 */
const findFiles = (filePaths = [], pattern) => {
  if (!Array.isArray(filePaths)) return [];
  if (typeof pattern === 'string') {
    const lower = pattern.toLowerCase();
    return filePaths.filter((p) => p.toLowerCase() === lower);
  }
  if (pattern instanceof RegExp) {
    return filePaths.filter((p) => pattern.test(p));
  }
  return [];
};

/**
 * Returns the first file path matching the given string or RegExp pattern, or null.
 */
const findFile = (filePaths = [], pattern) => {
  const matched = findFiles(filePaths, pattern);
  return matched.length > 0 ? matched[0] : null;
};

module.exports = {
  FindingType,
  createFinding,
  clampScore,
  createCheckerResult,
  hasFile,
  findFiles,
  findFile,
};
