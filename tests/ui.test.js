const request = require('supertest');
const app = require('../app');

describe('Static Frontend UI & Root Endpoints', () => {
  it('serves the HTML UI when requested with Accept: text/html at /', async () => {
    const res = await request(app).get('/').set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('Release Readiness Checker');
  });

  it('serves JSON status when requested with Accept: application/json at /', async () => {
    const res = await request(app).get('/').set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        name: 'Repository Release Readiness Checker API',
        status: 'running',
        health: '/health',
      })
    );
  });

  it('serves static frontend assets like style.css and ui.js', async () => {
    const cssRes = await request(app).get('/style.css');
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers['content-type']).toMatch(/css/);

    const jsRes = await request(app).get('/ui.js');
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers['content-type']).toMatch(/javascript/);
  });
});
