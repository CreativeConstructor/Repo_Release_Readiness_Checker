/**
 * Evidence-grounded Gemini report generation.
 *
 * Flow:
 *  1. Build a prompt from redacted checker findings + authoritative score
 *  2. Call Gemini with JSON structured output (when API key / client available)
 *  3. Validate schema + evidence against real findings
 *  4. Fall back to deterministic rule-based report on any failure
 *
 * Gemini NEVER owns ruleScore or verdict — those come from checkers/scorer.
 */

const { GoogleGenAI, Type } = require('@google/genai');
const { withRetry, isTransientError } = require('../../utils/retry');
const { validateReport } = require('./validate_report');
const { buildFallbackReport } = require('./fallback_report');

/** Default model for new projects (see Google Gemini models docs). */
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/**
 * JSON schema enforced via Gemini structured outputs.
 * Score/verdict are intentionally absent — AI explains, it does not score.
 */
const REPORT_JSON_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: '2-3 sentence overview of release readiness grounded in the findings.',
    },
    risks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          severity: { type: Type.STRING, description: 'high | medium | low' },
          explanation: { type: Type.STRING },
          relatedFindingIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Must be finding ids from the provided checker results only.',
          },
          evidenceFilePaths: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Must be file paths from the provided findings only.',
          },
        },
        propertyOrdering: [
          'title',
          'severity',
          'explanation',
          'relatedFindingIds',
          'evidenceFilePaths',
        ],
        required: ['title', 'severity', 'explanation', 'relatedFindingIds', 'evidenceFilePaths'],
      },
    },
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          priority: { type: Type.STRING, description: 'high | medium | low' },
          action: { type: Type.STRING, description: 'Concrete actionable fix.' },
          relatedFindingIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          evidenceFilePaths: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        propertyOrdering: ['title', 'priority', 'action', 'relatedFindingIds', 'evidenceFilePaths'],
        required: ['title', 'priority', 'action', 'relatedFindingIds', 'evidenceFilePaths'],
      },
    },
  },
  propertyOrdering: ['summary', 'risks', 'recommendations'],
  required: ['summary', 'risks', 'recommendations'],
};

/**
 * Creates a GoogleGenAI client when an API key is available.
 * Returns null when missing so callers can fall back cleanly.
 */
const createGeminiClient = (apiKey = process.env.GEMINI_API_KEY) => {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return null;
  }
  // Skip obvious placeholder values from .env.example
  if (apiKey.includes('your_gemini_api_key')) {
    return null;
  }
  return new GoogleGenAI({ apiKey: apiKey.trim() });
};

/**
 * Reduces checker results to a compact, redacted payload for the prompt.
 * Never includes raw secret values (findings already redact them).
 */
const buildPromptPayload = (checkerResults, scoringResult) => {
  const checkers = (checkerResults || []).map((result) => ({
    checkerId: result.checkerId,
    name: result.name,
    score: result.score,
    passed: result.passed,
    findings: (result.findings || []).map((f) => ({
      id: f.id,
      type: f.type,
      title: f.title,
      description: f.description,
      evidence: f.evidence,
      ...(f.filePath ? { filePath: f.filePath } : {}),
    })),
  }));

  return {
    ruleScore: scoringResult?.ruleScore,
    verdict: scoringResult?.verdict,
    note: 'ruleScore and verdict are authoritative. Do not invent or override them. Explain and recommend only.',
    checkers,
  };
};

const buildSystemInstruction = () =>
  [
    'You are a release-readiness analyst for public GitHub repositories.',
    'Use ONLY the provided checker findings as evidence.',
    'Do not invent file paths or finding ids that are not in the input.',
    'Do not include raw secrets, tokens, or passwords in any field.',
    'Do not output a score or verdict field — those are already decided by rules.',
    'severity and priority must each be exactly one of: high, medium, low.',
    'Provide at least one actionable recommendation.',
  ].join(' ');

/**
 * True when a Gemini / network error should be retried.
 */
const isGeminiTransient = (error) => {
  if (isTransientError(error)) return true;
  const status = error?.status || error?.statusCode || error?.code;
  if (status === 429 || status === 'RESOURCE_EXHAUSTED') return true;
  if (typeof status === 'number' && status >= 500) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('rate') || message.includes('unavailable') || message.includes('timeout');
};

/**
 * Calls Gemini generateContent and parses JSON text.
 *
 * @param {Object} params
 * @param {import('@google/genai').GoogleGenAI} params.client
 * @param {string} params.model
 * @param {Object} params.promptPayload
 * @returns {Promise<Object>} Parsed JSON object
 */
const callGemini = async ({ client, model, promptPayload }) => {
  const response = await withRetry(
    () =>
      client.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Analyze this release-readiness checker output and return the JSON report.\n\n${JSON.stringify(promptPayload)}`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: buildSystemInstruction(),
          responseMimeType: 'application/json',
          responseJsonSchema: REPORT_JSON_SCHEMA,
          temperature: 0.2,
        },
      }),
    {
      retries: 2,
      baseDelayMs: 300,
      shouldRetry: isGeminiTransient,
    }
  );

  const text = response?.text;
  if (!text || typeof text !== 'string') {
    throw new Error('Gemini returned empty response text');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Gemini returned non-JSON text');
  }
};

/**
 * Generates an evidence-grounded report.
 *
 * @param {Object} params
 * @param {Array<Object>} params.checkerResults
 * @param {{ ruleScore: number, verdict: string, checkerBreakdown?: Array }} params.scoringResult
 * @param {import('@google/genai').GoogleGenAI} [params.client] - Injected client (tests)
 * @param {string} [params.model]
 * @param {boolean} [params.forceFallback=false] - Skip Gemini (tests / kill-switch)
 * @returns {Promise<Object>} Report with source metadata and authoritative score/verdict
 */
const generateReport = async ({
  checkerResults = [],
  scoringResult,
  client: injectedClient,
  model = process.env.GEMINI_MODEL || DEFAULT_MODEL,
  forceFallback = false,
} = {}) => {
  const authoritative = {
    ruleScore: scoringResult?.ruleScore ?? 0,
    verdict: scoringResult?.verdict ?? 'not_ready',
  };

  const attachMeta = (body, source, usedModel, reason = null) => ({
    ...body,
    ruleScore: authoritative.ruleScore,
    verdict: authoritative.verdict,
    source,
    model: usedModel,
    ...(reason ? { fallbackReason: reason } : {}),
  });

  if (forceFallback) {
    return attachMeta(
      buildFallbackReport({ checkerResults, scoringResult }),
      'fallback',
      null,
      'forced'
    );
  }

  const client = injectedClient || createGeminiClient();
  if (!client) {
    return attachMeta(
      buildFallbackReport({ checkerResults, scoringResult }),
      'fallback',
      null,
      'missing_api_key'
    );
  }

  try {
    const promptPayload = buildPromptPayload(checkerResults, scoringResult);
    const raw = await callGemini({ client, model, promptPayload });
    const validated = validateReport(raw, checkerResults);

    if (!validated.ok) {
      return attachMeta(
        buildFallbackReport({ checkerResults, scoringResult }),
        'fallback',
        model,
        validated.reason
      );
    }

    return attachMeta(validated.report, 'gemini', model);
  } catch (error) {
    // Never leak API keys or stack traces to callers
    const safeReason =
      error?.status === 429 ||
      String(error?.message || '')
        .toLowerCase()
        .includes('rate')
        ? 'rate_limited'
        : 'gemini_unavailable';

    return attachMeta(
      buildFallbackReport({ checkerResults, scoringResult }),
      'fallback',
      model,
      safeReason
    );
  }
};

module.exports = {
  DEFAULT_MODEL,
  REPORT_JSON_SCHEMA,
  createGeminiClient,
  buildPromptPayload,
  callGemini,
  generateReport,
};
