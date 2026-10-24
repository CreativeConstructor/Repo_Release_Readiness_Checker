const { validateReport, buildEvidenceIndex } = require('../services/ai/validate_report');

const checkerResults = [
  {
    checkerId: 'secrets',
    score: 40,
    findings: [
      {
        id: 'SECRETS_RISKY_FILE_PRESENT',
        type: 'risk',
        title: 'Sensitive file committed: .env file',
        description: '.env should not be committed',
        evidence: 'File found in repository tree: .env',
        filePath: '.env',
      },
    ],
  },
  {
    checkerId: 'tests',
    score: 100,
    findings: [
      {
        id: 'TEST_FILES_PRESENT',
        type: 'success',
        title: 'Test files found',
        description: 'Tests exist',
        evidence: 'Found test files',
      },
    ],
  },
];

describe('validateReport', () => {
  test('buildEvidenceIndex collects finding ids and file paths', () => {
    const index = buildEvidenceIndex(checkerResults);
    expect(index.findingIds.has('SECRETS_RISKY_FILE_PRESENT')).toBe(true);
    expect(index.findingIds.has('TEST_FILES_PRESENT')).toBe(true);
    expect(index.filePaths.has('.env')).toBe(true);
  });

  test('accepts a well-formed grounded report', () => {
    const raw = {
      summary: 'Repo is not ready because a .env file is committed.',
      risks: [
        {
          title: 'Committed .env',
          severity: 'high',
          explanation: 'Credentials may be exposed.',
          relatedFindingIds: ['SECRETS_RISKY_FILE_PRESENT'],
          evidenceFilePaths: ['.env'],
        },
      ],
      recommendations: [
        {
          title: 'Remove .env from git history',
          priority: 'high',
          action: 'Rotate secrets and add .env to .gitignore.',
          relatedFindingIds: ['SECRETS_RISKY_FILE_PRESENT'],
          evidenceFilePaths: ['.env'],
        },
      ],
    };

    const result = validateReport(raw, checkerResults);
    expect(result.ok).toBe(true);
    expect(result.report.risks).toHaveLength(1);
    expect(result.report.recommendations).toHaveLength(1);
  });

  test('rejects missing summary', () => {
    const result = validateReport(
      { summary: '', risks: [], recommendations: [{ title: 'x', priority: 'low', action: 'y', relatedFindingIds: [], evidenceFilePaths: [] }] },
      checkerResults
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/summary/i);
  });

  test('rejects invented finding ids', () => {
    const raw = {
      summary: 'Bad evidence',
      risks: [
        {
          title: 'Fake risk',
          severity: 'high',
          explanation: 'Invented',
          relatedFindingIds: ['TOTALLY_FAKE_FINDING'],
          evidenceFilePaths: [],
        },
      ],
      recommendations: [
        {
          title: 'Do something',
          priority: 'high',
          action: 'Fix it',
          relatedFindingIds: ['TOTALLY_FAKE_FINDING'],
          evidenceFilePaths: [],
        },
      ],
    };

    const result = validateReport(raw, checkerResults);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/evidence|grounding/i);
  });

  test('rejects invented file paths', () => {
    const raw = {
      summary: 'Bad paths',
      risks: [
        {
          title: 'Path risk',
          severity: 'medium',
          explanation: 'Claims a fake path',
          relatedFindingIds: ['SECRETS_RISKY_FILE_PRESENT'],
          evidenceFilePaths: ['/etc/passwd'],
        },
      ],
      recommendations: [
        {
          title: 'Fix path',
          priority: 'medium',
          action: 'Remove fake path claim',
          relatedFindingIds: ['SECRETS_RISKY_FILE_PRESENT'],
          evidenceFilePaths: ['/etc/passwd'],
        },
      ],
    };

    const result = validateReport(raw, checkerResults);
    expect(result.ok).toBe(false);
  });

  test('strips unknown ids but keeps grounded items when mixed', () => {
    const raw = {
      summary: 'Mixed evidence',
      risks: [
        {
          title: 'Real risk',
          severity: 'high',
          explanation: 'Grounded',
          relatedFindingIds: ['SECRETS_RISKY_FILE_PRESENT', 'FAKE_ID'],
          evidenceFilePaths: ['.env', 'not-real.js'],
        },
      ],
      recommendations: [
        {
          title: 'Real fix',
          priority: 'high',
          action: 'Fix .env',
          relatedFindingIds: ['SECRETS_RISKY_FILE_PRESENT'],
          evidenceFilePaths: ['.env'],
        },
      ],
    };

    const result = validateReport(raw, checkerResults);
    expect(result.ok).toBe(true);
    expect(result.report.risks[0].relatedFindingIds).toEqual(['SECRETS_RISKY_FILE_PRESENT']);
    expect(result.report.risks[0].evidenceFilePaths).toEqual(['.env']);
  });

  test('rejects invalid severity enum', () => {
    const raw = {
      summary: 'Bad severity',
      risks: [
        {
          title: 'X',
          severity: 'critical',
          explanation: 'Y',
          relatedFindingIds: ['SECRETS_RISKY_FILE_PRESENT'],
          evidenceFilePaths: [],
        },
      ],
      recommendations: [
        {
          title: 'Fix',
          priority: 'high',
          action: 'Do it',
          relatedFindingIds: [],
          evidenceFilePaths: [],
        },
      ],
    };

    const result = validateReport(raw, checkerResults);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/risks failed evidence grounding/i);
  });
});
