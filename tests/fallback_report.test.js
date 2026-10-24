const { buildFallbackReport } = require('../services/ai/fallback_report');

describe('buildFallbackReport', () => {
  const scoringResult = { ruleScore: 42, verdict: 'not_ready' };

  const checkerResults = [
    {
      checkerId: 'secrets',
      findings: [
        {
          id: 'SECRETS_RISKY_FILE_PRESENT',
          type: 'risk',
          title: 'Sensitive file committed: .env file',
          description: 'Remove .env from the repository.',
          evidence: 'File found: .env',
          filePath: '.env',
        },
      ],
    },
    {
      checkerId: 'ci',
      findings: [
        {
          id: 'CI_MISSING',
          type: 'risk',
          title: 'No CI configuration found',
          description: 'Add a GitHub Actions workflow.',
          evidence: 'No CI files detected',
        },
      ],
    },
  ];

  test('produces summary, risks, and recommendations from findings', () => {
    const report = buildFallbackReport({ checkerResults, scoringResult });

    expect(report.summary).toMatch(/42/);
    expect(report.summary).toMatch(/not ready/i);
    expect(report.risks.length).toBe(2);
    expect(report.risks[0].relatedFindingIds).toContain('SECRETS_RISKY_FILE_PRESENT');
    expect(report.risks[0].evidenceFilePaths).toEqual(['.env']);
    expect(report.recommendations.length).toBeGreaterThanOrEqual(2);
    expect(report.recommendations[0].priority).toBe('high');
  });

  test('is deterministic for identical inputs', () => {
    const a = buildFallbackReport({ checkerResults, scoringResult });
    const b = buildFallbackReport({ checkerResults, scoringResult });
    expect(a).toEqual(b);
  });

  test('still returns a recommendation when there are no risks', () => {
    const report = buildFallbackReport({
      checkerResults: [
        {
          checkerId: 'readme',
          findings: [
            {
              id: 'README_PRESENT',
              type: 'success',
              title: 'README found',
              description: 'Good docs',
              evidence: 'README.md',
            },
          ],
        },
      ],
      scoringResult: { ruleScore: 90, verdict: 'ready' },
    });

    expect(report.risks).toHaveLength(0);
    expect(report.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(report.summary).toMatch(/ready/i);
  });
});
