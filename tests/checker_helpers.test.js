const {
  FindingType,
  createFinding,
  clampScore,
  createCheckerResult,
  hasFile,
  findFiles,
  findFile,
} = require('../checkers/helpers');

describe('Checker Helpers & Contract', () => {
  describe('createFinding', () => {
    test('creates valid finding object with all required fields', () => {
      const finding = createFinding({
        id: 'TEST_ID',
        type: FindingType.SUCCESS,
        title: 'Test Title',
        description: 'Test Description',
        evidence: 'file.js line 1',
        filePath: 'file.js',
      });

      expect(finding).toEqual({
        id: 'TEST_ID',
        type: 'success',
        title: 'Test Title',
        description: 'Test Description',
        evidence: 'file.js line 1',
        filePath: 'file.js',
      });
    });

    test('throws error if mandatory fields are missing', () => {
      expect(() => createFinding({ id: 'X', type: 'risk', title: 'T' })).toThrow(/mandatory/);
    });

    test('throws error if finding type is invalid', () => {
      expect(() =>
        createFinding({
          id: 'X',
          type: 'invalid_type',
          title: 'T',
          description: 'D',
          evidence: 'E',
        })
      ).toThrow(/Invalid finding type/);
    });
  });

  describe('clampScore', () => {
    test('clamps scores correctly between 0 and 100', () => {
      expect(clampScore(120)).toBe(100);
      expect(clampScore(-15)).toBe(0);
      expect(clampScore(85.4)).toBe(85);
      expect(clampScore(NaN)).toBe(0);
    });
  });

  describe('createCheckerResult', () => {
    test('marks passed = true when score >= 70 and no critical risks exist', () => {
      const result = createCheckerResult({
        checkerId: 'test',
        name: 'Test Checker',
        score: 80,
        findings: [
          createFinding({
            id: 'A',
            type: FindingType.SUCCESS,
            title: 'T',
            description: 'D',
            evidence: 'E',
          }),
        ],
      });

      expect(result.passed).toBe(true);
      expect(result.score).toBe(80);
    });

    test('marks passed = false if score is below 70 even without risks', () => {
      const result = createCheckerResult({
        checkerId: 'test',
        name: 'Test Checker',
        score: 50,
      });

      expect(result.passed).toBe(false);
    });

    test('marks passed = false if critical risk exists even if score >= 70', () => {
      const result = createCheckerResult({
        checkerId: 'test',
        name: 'Test Checker',
        score: 80,
        findings: [
          createFinding({
            id: 'RISK_1',
            type: FindingType.RISK,
            title: 'Severe Flaw',
            description: 'Description',
            evidence: 'Evidence',
          }),
        ],
      });

      expect(result.passed).toBe(false);
    });
  });

  describe('file matching helpers', () => {
    const files = ['src/index.js', 'Dockerfile', 'docker-compose.yaml', '.dockerignore'];

    test('hasFile checks case-insensitive string and regex', () => {
      expect(hasFile(files, 'dockerfile')).toBe(true);
      expect(hasFile(files, /\.ya?ml$/i)).toBe(true);
      expect(hasFile(files, 'nonexistent.txt')).toBe(false);
    });

    test('findFiles returns all matching paths', () => {
      expect(findFiles(files, /docker/i)).toEqual([
        'Dockerfile',
        'docker-compose.yaml',
        '.dockerignore',
      ]);
    });

    test('findFile returns first match or null', () => {
      expect(findFile(files, /compose/i)).toBe('docker-compose.yaml');
      expect(findFile(files, 'missing')).toBeNull();
    });
  });
});
