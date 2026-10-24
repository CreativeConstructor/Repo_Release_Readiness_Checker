const { FindingType, createFinding, createCheckerResult } = require('./helpers');

const CHECKER_ID = 'readme';
const CHECKER_NAME = 'README & Documentation';

/**
 * Standard documentation section patterns in Markdown headings.
 */
const DOCUMENTATION_SECTIONS = [
  {
    key: 'setup',
    title: 'Installation & Setup',
    pattern: /^#+\s+.*(install|setup|getting\s+started|quick\s*start|prerequisites)/im,
    points: 15,
  },
  {
    key: 'usage',
    title: 'Usage & API Examples',
    pattern: /^#+\s+.*(usage|how\s+to\s+run|running|examples?|api|endpoints)/im,
    points: 15,
  },
  {
    key: 'overview',
    title: 'Overview & Architecture',
    pattern: /^#+\s+.*(overview|about|features|architecture|design|concept)/im,
    points: 10,
  },
  {
    key: 'testing_or_contributing',
    title: 'Testing / Contributing / License',
    pattern: /^#+\s+.*(test|testing|contribut|license)/im,
    points: 10,
  },
];

/**
 * Analyzes repository documentation quality and readiness.
 *
 * Checks:
 * 1. README presence
 * 2. Minimum content depth (length and structure)
 * 3. Essential developer lifecycle sections (Installation, Usage, Architecture)
 *
 * @param {Object} snapshot - Repository snapshot from snapshot_service
 * @returns {Object} Standardized CheckerResult
 */
const run = (snapshot = {}) => {
  const readme = snapshot.readme || {};
  const findings = [];
  let score = 0;

  // 1. Verify existence of README file
  if (
    !readme.exists ||
    !readme.content ||
    typeof readme.content !== 'string' ||
    readme.content.trim().length === 0
  ) {
    findings.push(
      createFinding({
        id: 'README_MISSING',
        type: FindingType.RISK,
        title: 'README Missing or Empty',
        description:
          'No README file was found in the repository root. Documentation is required for software release readiness to guide deployment, configuration, and API consumption.',
        evidence: 'No README.md found in repository snapshot',
      })
    );

    return createCheckerResult({
      checkerId: CHECKER_ID,
      name: CHECKER_NAME,
      score: 0,
      findings,
      metadata: {
        hasReadme: false,
        length: 0,
      },
    });
  }

  const content = readme.content.trim();
  const filename = readme.filename || 'README.md';

  findings.push(
    createFinding({
      id: 'README_PRESENT',
      type: FindingType.SUCCESS,
      title: 'README File Detected',
      description: `Project documentation is provided via ${filename}.`,
      evidence: `Located at ${filename} (${content.length} characters)`,
      filePath: filename,
    })
  );
  score += 30;

  // 2. Assess content depth
  if (content.length < 100) {
    findings.push(
      createFinding({
        id: 'README_TOO_SHORT',
        type: FindingType.WARNING,
        title: 'README Content Too Brief',
        description: `The README file is only ${content.length} characters long. A release-ready README should describe what the project does, how to configure it, and how to start it.`,
        evidence: `${filename} length is ${content.length} characters (recommended minimum: 100 characters)`,
        filePath: filename,
      })
    );
  } else {
    findings.push(
      createFinding({
        id: 'README_LENGTH_ADEQUATE',
        type: FindingType.SUCCESS,
        title: 'README Depth Adequate',
        description: 'README provides substantive introductory content.',
        evidence: `${content.length} characters in ${filename}`,
        filePath: filename,
      })
    );
    score += 20;

    // Bonus for comprehensive documentation (500+ characters)
    if (content.length >= 500) {
      score += 10;
    }
  }

  // 3. Scan for standard structural sections
  const detectedSections = [];
  const missingSections = [];

  for (const section of DOCUMENTATION_SECTIONS) {
    if (section.pattern.test(content)) {
      detectedSections.push(section.title);
      score += section.points;
    } else {
      missingSections.push(section.title);
    }
  }

  if (detectedSections.length > 0) {
    findings.push(
      createFinding({
        id: 'README_SECTIONS_FOUND',
        type: FindingType.SUCCESS,
        title: 'Essential Documentation Sections Present',
        description: `README contains key sections: ${detectedSections.join(', ')}.`,
        evidence: `Detected sections: ${detectedSections.join(', ')}`,
        filePath: filename,
      })
    );
  }

  if (
    missingSections.includes('Installation & Setup') ||
    missingSections.includes('Usage & API Examples')
  ) {
    const keyMissing = missingSections.filter(
      (s) => s === 'Installation & Setup' || s === 'Usage & API Examples'
    );
    findings.push(
      createFinding({
        id: 'README_CRITICAL_SECTIONS_MISSING',
        type: FindingType.WARNING,
        title: 'Key Operational Sections Missing in README',
        description: `README lacks critical operational sections: ${keyMissing.join(' and ')}. Operators and consumers cannot easily set up or execute the release.`,
        evidence: `Missing expected markdown headings for: ${keyMissing.join(', ')}`,
        filePath: filename,
      })
    );
  }

  return createCheckerResult({
    checkerId: CHECKER_ID,
    name: CHECKER_NAME,
    score,
    findings,
    metadata: {
      hasReadme: true,
      filename,
      length: content.length,
      detectedSections,
      missingSections,
    },
  });
};

module.exports = {
  CHECKER_ID,
  CHECKER_NAME,
  DOCUMENTATION_SECTIONS,
  run,
};
