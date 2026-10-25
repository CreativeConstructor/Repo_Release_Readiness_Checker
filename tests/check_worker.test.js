const { processCheckJob } = require('../workers/check_worker');
const checkOrchestrator = require('../services/check_orchestrator');

describe('Check Worker (workers/check_worker.js)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delegates job processing to checkOrchestrator.runFullCheck with job parameters', async () => {
    const mockJob = {
      id: 'job-101',
      data: {
        userId: 7,
        repoUrl: 'https://github.com/owner/target-repo',
        force: false,
      },
    };

    const mockAnalysis = {
      checkId: 50,
      ruleScore: 85,
      verdict: 'ready',
    };

    jest.spyOn(checkOrchestrator, 'runFullCheck').mockResolvedValueOnce(mockAnalysis);

    const result = await processCheckJob(mockJob);

    expect(result).toEqual(mockAnalysis);
    expect(checkOrchestrator.runFullCheck).toHaveBeenCalledWith({
      userId: 7,
      repoUrl: 'https://github.com/owner/target-repo',
      force: false,
    });
  });
});
