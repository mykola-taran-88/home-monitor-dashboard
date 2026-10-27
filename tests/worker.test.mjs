import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';

const base = 'https://dashboard.test';
const routes = [
  '/', '/index.html', '/home', '/climate?room=room-kids', '/energy?metric=power&period=day',
  '/weather?horizon=48h&timestamp=2026-10-27', '/devices', '/devices?status=attention',
  '/devices/sensor-1', '/timeline', '/admin', '/about',
];

test('serves the same complete HTML app at supported direct routes', async () => {
  for (const path of routes) {
    const response = await worker.fetch(new Request(`${base}${path}`));
    assert.equal(response.status, 200, `${path} should resolve to the app`);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const html = await response.text();
    assert.match(html, /id="floorPlanSvg"/);
    assert.match(html, /id="climateTempChart"/);
    assert.match(html, /id="climateHumidityChart"/);
    assert.match(html, /id="homeEvents"/);
  }
});

test('unknown routes return 404 and methods other than GET/HEAD return 405', async () => {
  assert.equal((await worker.fetch(new Request(`${base}/not-a-page`))).status, 404);
  assert.equal((await worker.fetch(new Request(`${base}/climate`, { method: 'POST' }))).status, 405);
});

test('HEAD returns route headers without a body', async () => {
  const response = await worker.fetch(new Request(`${base}/climate`, { method: 'HEAD' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.equal(await response.text(), '');
});

test('HTML has no scanned floor-plan dependency and uses distinct empty-value markers', async () => {
  const response = await worker.fetch(new Request(`${base}/`));
  const html = await response.text();
  assert.doesNotMatch(html, /floor-plan\.png/);
  assert.match(html, /data-floor-metric="comfort"/);
  assert.match(html, /data-floor-metric="none"/);
  assert.match(html, /const hmNumber=v=>/);
  assert.match(html, /value===null/);
});


test('responses include the expected baseline security headers', async () => {
  const response = await worker.fetch(new Request(`${base}/`));
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
});
