const checkQueue = require('../services/queue/check_queue');

describe('Check Queue (services/queue/check_queue.js)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('enqueueCheckJob', () => {
    it('enqueues a job with user details and returns job id', async () => {
      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'job-12345' }),
      };
      jest.spyOn(checkQueue, 'getCheckQueue').mockReturnValue(mockQueue);

      const jobId = await checkQueue.enqueueCheckJob({
        userId: 10,
        repoUrl: 'https://github.com/owner/repo',
        force: true,
      });

      expect(jobId).toBe('job-12345');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'analyze-repo',
        expect.objectContaining({
          userId: 10,
          repoUrl: 'https://github.com/owner/repo',
          force: true,
        })
      );
    });
  });

  describe('getJobStatus', () => {
    it('returns job state and result when user is owner', async () => {
      const mockJob = {
        id: 'job-12345',
        data: { userId: 5, enqueuedAt: '2026-10-25T12:00:00Z' },
        getState: jest.fn().mockResolvedValue('completed'),
        progress: 100,
        returnvalue: { ruleScore: 90, verdict: 'ready' },
        failedReason: null,
        finishedOn: 1700000000000,
      };

      const mockQueue = {
        getJob: jest.fn().mockResolvedValue(mockJob),
      };
      jest.spyOn(checkQueue, 'getCheckQueue').mockReturnValue(mockQueue);

      const status = await checkQueue.getJobStatus({ jobId: 'job-12345', userId: 5 });

      expect(status).toEqual(
        expect.objectContaining({
          jobId: 'job-12345',
          status: 'completed',
          progress: 100,
          result: { ruleScore: 90, verdict: 'ready' },
        })
      );
    });

    it('throws 404 when job does not exist in queue', async () => {
      const mockQueue = {
        getJob: jest.fn().mockResolvedValue(null),
      };
      jest.spyOn(checkQueue, 'getCheckQueue').mockReturnValue(mockQueue);

      await expect(
        checkQueue.getJobStatus({ jobId: 'nonexistent-job', userId: 5 })
      ).rejects.toMatchObject({
        statusCode: 404,
        message: 'Job not found',
      });
    });

    it('throws 404 when job belongs to another user (ownership enforcement)', async () => {
      const mockJob = {
        id: 'job-99999',
        data: { userId: 99 }, // Belongs to user 99
      };

      const mockQueue = {
        getJob: jest.fn().mockResolvedValue(mockJob),
      };
      jest.spyOn(checkQueue, 'getCheckQueue').mockReturnValue(mockQueue);

      // User 5 attempts to access user 99's job
      await expect(
        checkQueue.getJobStatus({ jobId: 'job-99999', userId: 5 })
      ).rejects.toMatchObject({
        statusCode: 404,
        message: 'Job not found',
      });
    });
  });
});
