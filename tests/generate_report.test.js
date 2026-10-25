const {
  generateReport,
  buildPromptPayload,
  createGeminiClient,
} = require('../services/ai/generate_report');

const scoringResult = { ruleScore: 55, verdict: 'needs_work' };

const checkerResults = [
  {
    checkerId: 'docker',
    name: 'Docker',
    score: 0,
    passed: false,
    findings: [
      {
        id: 'DOCKERFILE_MISSING',
        type: 'risk',
        title: 'Dockerfile missing',
        description: 'Add a Dockerfile for reproducible deploys.',
        evidence: 'No Dockerfile in tree',
      },
    ],
  },
];

const groundedGeminiJson = {
  summary: 'Needs work because Docker packaging is missing.',
  risks: [
    {
      title: 'No Dockerfile',
      severity: 'high',
      explanation: 'Without a Dockerfile releases are harder to reproduce.',
      relatedFindingIds: ['DOCKERFILE_MISSING'],
      evidenceFilePaths: [],
    },
  ],
  recommendations: [
    {
      title: 'Add a Dockerfile',
      priority: 'high',
      action: 'Create a multi-stage Dockerfile for the Node app.',
      relatedFindingIds: ['DOCKERFILE_MISSING'],
      evidenceFilePaths: [],
    },
  ],
};

describe('generateReport', () => {
  test('createGeminiClient returns null for missing or placeholder keys', () => {
    expect(createGeminiClient('')).toBeNull();
    expect(createGeminiClient('your_gemini_api_key_here')).toBeNull();
  });

  test('buildPromptPayload includes authoritative score and redacted findings only', () => {
    const payload = buildPromptPayload(checkerResults, scoringResult);
    expect(payload.ruleScore).toBe(55);
    expect(payload.verdict).toBe('needs_work');
    expect(payload.checkers[0].findings[0].id).toBe('DOCKERFILE_MISSING');
    expect(payload.note).toMatch(/authoritative/i);
  });

  test('uses fallback when no API key / client is available', async () => {
    const previous = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const report = await generateReport({ checkerResults, scoringResult });

    expect(report.source).toBe('fallback');
    expect(report.fallbackReason).toBe('missing_api_key');
    expect(report.ruleScore).toBe(55);
    expect(report.verdict).toBe('needs_work');
    expect(report.risks[0].relatedFindingIds).toContain('DOCKERFILE_MISSING');
    expect(report).not.toHaveProperty('score'); // AI must not invent alternate score field ownership

    process.env.GEMINI_API_KEY = previous;
  });

  test('forceFallback skips Gemini even when a client is injected', async () => {
    const client = {
      models: {
        generateContent: jest.fn(),
      },
    };

    const report = await generateReport({
      checkerResults,
      scoringResult,
      client,
      forceFallback: true,
    });

    expect(client.models.generateContent).not.toHaveBeenCalled();
    expect(report.source).toBe('fallback');
    expect(report.fallbackReason).toBe('forced');
  });

  test('returns gemini source when mocked client returns grounded JSON', async () => {
    const client = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify(groundedGeminiJson),
        }),
      },
    };

    const report = await generateReport({
      checkerResults,
      scoringResult,
      client,
      model: 'gemini-3.5-flash-lite',
    });

    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
    expect(report.source).toBe('gemini');
    expect(report.model).toBe('gemini-3.5-flash-lite');
    expect(report.summary).toMatch(/Docker/i);
    expect(report.ruleScore).toBe(55);
    expect(report.verdict).toBe('needs_work');
    expect(report.recommendations[0].relatedFindingIds).toEqual(['DOCKERFILE_MISSING']);
  });

  test('falls back when Gemini returns ungrounded finding ids', async () => {
    const client = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify({
            summary: 'Invented',
            risks: [
              {
                title: 'Fake',
                severity: 'high',
                explanation: 'Nope',
                relatedFindingIds: ['NOT_A_REAL_FINDING'],
                evidenceFilePaths: [],
              },
            ],
            recommendations: [
              {
                title: 'Fake fix',
                priority: 'high',
                action: 'Nope',
                relatedFindingIds: ['NOT_A_REAL_FINDING'],
                evidenceFilePaths: [],
              },
            ],
          }),
        }),
      },
    };

    const report = await generateReport({
      checkerResults,
      scoringResult,
      client,
    });

    expect(report.source).toBe('fallback');
    expect(report.fallbackReason).toMatch(/grounding|evidence/i);
    expect(report.ruleScore).toBe(55);
  });

  test('falls back on rate-limit errors without exposing internals', async () => {
    const err = new Error('Resource exhausted');
    err.status = 429;

    const client = {
      models: {
        generateContent: jest.fn().mockRejectedValue(err),
      },
    };

    const report = await generateReport({
      checkerResults,
      scoringResult,
      client,
    });

    expect(report.source).toBe('fallback');
    expect(report.fallbackReason).toBe('rate_limited');
    expect(JSON.stringify(report)).not.toMatch(/stack/i);
  });

  test('falls back when Gemini returns invalid JSON', async () => {
    const client = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: 'not-json{{{',
        }),
      },
    };

    const report = await generateReport({
      checkerResults,
      scoringResult,
      client,
    });

    expect(report.source).toBe('fallback');
    expect(report.fallbackReason).toBe('gemini_unavailable');
  });

  test('authoritative score from scorer is never overridden by Gemini fields', async () => {
    const client = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          text: JSON.stringify({
            ...groundedGeminiJson,
            ruleScore: 99,
            verdict: 'ready',
            score: 99,
          }),
        }),
      },
    };

    const report = await generateReport({
      checkerResults,
      scoringResult: { ruleScore: 55, verdict: 'needs_work' },
      client,
    });

    expect(report.source).toBe('gemini');
    expect(report.ruleScore).toBe(55);
    expect(report.verdict).toBe('needs_work');
  });
});
