import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [template, styles, core, dashboard, worker] = await Promise.all([
  readFile(resolve(root, 'src/index.html'), 'utf8'),
  readFile(resolve(root, 'src/styles.css'), 'utf8'),
  readFile(resolve(root, 'src/scripts/core.js'), 'utf8'),
  readFile(resolve(root, 'src/scripts/dashboard.js'), 'utf8'),
  readFile(resolve(root, 'index.js'), 'utf8'),
]);
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

for (const [name, source] of [['core.js', core], ['dashboard.js', dashboard]]) {
  try { new vm.Script(source, { filename: name }); }
  catch (error) { failures.push(`${name} syntax: ${error.message}`); }
}
const workerCheck = spawnSync(process.execPath, ['--check', resolve(root, 'index.js')], { encoding: 'utf8' });
if (workerCheck.status !== 0) failures.push(`Worker ES module syntax: ${workerCheck.stderr || workerCheck.stdout}`);

for (const [marker, label] of [
  ['<!-- HM_STYLES -->', 'styles'],
  ['<!-- HM_CORE_SCRIPT -->', 'core script'],
  ['<!-- HM_DASHBOARD_SCRIPT -->', 'dashboard script'],
]) assert(template.split(marker).length - 1 === 1, `Template must contain one ${label} marker`);

assert(styles.includes(':root') && styles.includes('--bg') && styles.includes('--panel') && styles.includes('--hm-accent'), 'Central CSS custom properties must exist');
assert(core.includes('const API=') && core.includes('async function req('), 'Existing API client must remain in the core script');
assert(dashboard.includes('const hmMetric=') && dashboard.includes('function hmStatusFor('), 'Metric and data-state helpers must exist');
assert(dashboard.includes('function hmNavigate(') && dashboard.includes("'/devices'"), 'Deep-link navigation must support devices');
assert(dashboard.includes('function hmClimateComfortConfig('), 'Climate comfort limits must use centralized config mapping');
assert(dashboard.includes('function hmParseTimestamp(') && dashboard.includes('function hmWeatherLabel('), 'Location timezone helpers must exist');
assert(!dashboard.includes('??(+month.energy_day||0)'), 'Missing tariff values must not be coerced to zero');
assert(!dashboard.includes("attention||'—'"), 'A confirmed zero count must not be displayed as missing');
assert(worker.includes('smart-home-api-v2.mykola-taran-88.workers.dev'), 'Worker CSP must allow the existing API origin');
assert(worker.includes('function isDashboardRoute') && worker.includes('frame-ancestors'), 'Worker routes and security headers must exist');

const staticMarkup = template.split('<!-- HM_CORE_SCRIPT -->')[0];
const ids = [...staticMarkup.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicates.length === 0, `Duplicate static HTML IDs: ${[...new Set(duplicates)].join(', ')}`);

if (failures.length) {
  console.error(`Quality checks failed (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Quality checks passed: source syntax, Worker ESM syntax, template markers, API/state/config contracts, and ${ids.length} unique static IDs.`);
}
