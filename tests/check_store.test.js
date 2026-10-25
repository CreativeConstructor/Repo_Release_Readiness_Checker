/**
 * Unit Tests for Check Store (services/check_store.js)
 */

const db = require('../db');
const checkStore = require('../services/check_store');

describe('Check Store (services/check_store.js)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findCachedCheck', () => {
    it('returns the row when a cached check is found', async () => {
      const mockRow = {
        id: 1,
        repo_name: 'owner/repo',
        head_sha: 'sha123',
        rule_score: 90,
        verdict: 'ready',
      };
      jest.spyOn(db, 'query').mockResolvedValueOnce({ rows: [mockRow] });

      const result = await checkStore.findCachedCheck({
        userId: 1,
        repoUrl: 'https://github.com/owner/repo',
        headSha: 'sha123',
      });

      expect(result).toEqual(mockRow);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE user_id = $1'), [
        1,
        'https://github.com/owner/repo',
        'sha123',
      ]);
    });

    it('returns null when no cached check exists', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({ rows: [] });

      const result = await checkStore.findCachedCheck({
        userId: 1,
        repoUrl: 'https://github.com/owner/repo',
        headSha: 'sha999',
      });

      expect(result).toBeNull();
    });
  });

  describe('createCheck', () => {
    it('persists analysis and returns generated id and created_at', async () => {
      const mockResult = { id: 42, created_at: new Date().toISOString() };
      jest.spyOn(db, 'query').mockResolvedValueOnce({ rows: [mockResult] });

      const saved = await checkStore.createCheck({
        userId: 5,
        repoUrl: 'https://github.com/owner/repo',
        repoName: 'owner/repo',
        headSha: 'abc456',
        ruleScore: 85,
        verdict: 'ready',
        report: { summary: 'Ready' },
        checkerResults: [],
        cached: false,
      });

      expect(saved).toEqual(mockResult);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO Checks'),
        expect.arrayContaining([
          5,
          'https://github.com/owner/repo',
          'owner/repo',
          'abc456',
          85,
          'ready',
        ])
      );
    });
  });

  describe('getCheckById', () => {
    it('returns check record when ID and user match', async () => {
      const mockCheck = { id: 10, user_id: 1, repo_name: 'owner/repo' };
      jest.spyOn(db, 'query').mockResolvedValueOnce({ rows: [mockCheck] });

      const check = await checkStore.getCheckById({ checkId: 10, userId: 1 });

      expect(check).toEqual(mockCheck);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 AND user_id = $2'),
        [10, 1]
      );
    });

    it('returns null if check ID belongs to another user (ownership enforcement)', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({ rows: [] });

      const check = await checkStore.getCheckById({ checkId: 10, userId: 99 });

      expect(check).toBeNull();
    });
  });

  describe('getChecksHistory', () => {
    it('returns paginated history with default parameters', async () => {
      jest
        .spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ total: 25 }] }) // count query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              repo_url: 'https://github.com/owner/repo',
              repo_name: 'owner/repo',
              head_sha: 'sha1',
              rule_score: 80,
              verdict: 'ready',
              cached: false,
              status: 'completed',
              created_at: new Date().toISOString(),
            },
          ],
        });

      const history = await checkStore.getChecksHistory({ userId: 1, page: 1, limit: 10 });

      expect(history.checks).toHaveLength(1);
      expect(history.pagination).toEqual({
        total: 25,
        page: 1,
        limit: 10,
        totalPages: 3,
      });
    });

    it('applies verdict and repo filters when supplied', async () => {
      jest
        .spyOn(db, 'query')
        .mockResolvedValueOnce({ rows: [{ total: 2 }] })
        .mockResolvedValueOnce({ rows: [] });

      await checkStore.getChecksHistory({
        userId: 2,
        page: 1,
        limit: 10,
        verdict: 'ready',
        repo: 'my-project',
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('verdict = $2 AND (repo_name ILIKE $3 OR repo_url ILIKE $3)'),
        expect.arrayContaining([2, 'ready', '%my-project%'])
      );
    });
  });
});
