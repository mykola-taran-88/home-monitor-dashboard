import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../index.js';

const root = new URL('../', import.meta.url);
const [template, styles, core, dashboard] = await Promise.all([
  readFile(new URL('src/index.html', root), 'utf8'),
  readFile(new URL('src/styles.css', root), 'utf8'),
  readFile(new URL('src/scripts/core.js', root), 'utf8'),
  readFile(new URL('src/scripts/dashboard.js', root), 'utf8'),
]);

async function appHtml(path = '/') {
  const response = await worker.fetch(new Request(`https://dashboard.test${path}`));
  assert.equal(response.status, 200);
  return response.text();
}

test('spec: delivered SVG is vector-only, uses required viewBox, and includes all five rooms', async () => {
  const html = await appHtml('/climate');
  assert.match(html, /<svg id="floorPlanSvg" viewBox="0 0 1200 600"/);
  for (const id of ['room-kids', 'room-hallway', 'room-bedroom', 'room-kitchen', 'room-bathroom']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /floor-plan\.png/);
  assert.match(html, /Немає датчика/);
  assert.match(styles, /aspect-ratio:2\/1/);
  assert.doesNotMatch(styles, /aspect-ratio:1200\/760/);
  assert.match(html, /id="room-kitchen" class="svgRoom unmappedRoom" data-plan-room="4"/);
  assert.match(html, /id="room-bathroom" class="svgRoom unmappedRoom" data-plan-room="3"/);
  assert.doesNotMatch(html, /floorPlanTools|data-plan-action/);
  assert.match(dashboard, /poly\.style\.setProperty\('fill',floorPlanColor\(d\),'important'\)/);
  assert.match(dashboard, /return value<20\?'#438dbb':value<=cfg\.temperatureMax\?'#579a7c':value<=26\?'#df9250':'#cc625a'/);
});

test('spec: climate defaults to a simple fixed-scale temperature graph and keeps missing samples as gaps', async () => {
  const html = await appHtml('/climate?room=room-kids');
  assert.match(html, /data-metric="temperature" class="active">Температура/);
  assert.match(html, /data-smart-scope="climate"><button data-p="day" class="active"/);
  assert.match(dashboard, /showTemp=mode!=='humidity',showHum=mode==='humidity'/);
  assert.match(dashboard, /Math\.ceil\(allKeys\.length\/240\)/);
  assert.match(dashboard, /makeChart\('climateTempChart'.*?0,40\)/s);
  assert.match(dashboard, /spanGaps:false/);
  assert.match(dashboard, /slicedKeys=timeKeys\.slice/);
  assert.match(dashboard, /keys\.indexOf\(timeKey\)/);
});

test('spec: room selection focuses and can clear a selected room without hiding all other series', () => {
  assert.match(dashboard, /state\.climateRoomFocus=id;state\.climateSelectedRooms=\[id\]/);
  assert.match(dashboard, /state\.climateRoomFocus=null;state\.climateSelectedRooms=\[\]/);
  assert.match(dashboard, /const fade=focus\?'':'44'/);
});

test('spec: switching history aborts prior requests and aborted requests are not coalesced', () => {
  assert.match(dashboard, /state\.smartControllers\[scope\]\?\.abort\(\)/);
  assert.match(dashboard, /new AbortController\(\)/);
  assert.match(dashboard, /signal:controller\.signal/);
  assert.match(core, /dedupe=method==='GET'&&!opt\.signal/);
  assert.match(core, /if\(state\.activeRequests\.get\(cacheKey\)===task\)state\.activeRequests\.delete\(cacheKey\)/);
});

test('spec: climate, energy, and weather preferences persist while fullscreen/zoom remain transient', () => {
  assert.match(dashboard, /localStorage\.setItem\(HM_PREF_KEY/);
  assert.match(dashboard, /climateMode:state\.chartMetrics\.climate/);
  assert.match(dashboard, /planMetric:state\.floorPlanMetric/);
  assert.match(dashboard, /periods:\{climate:state\.smartPeriods\.climate\|\|'day',energy2:state\.smartPeriods\.energy2\|\|'day',weather:state\.weatherHorizon\|\|'48h'\}/);
  assert.doesNotMatch(dashboard.match(/function hmSavePreferences\(\)[\s\S]*?\nfunction hmRestorePreferences/)?.[0] || '', /floorPlanZoom|chartViewport|fullscreen/i);
});

test('spec: weather defaults to temperature plus precipitation, with probability scale and a useful hourly rail', async () => {
  const html = await appHtml('/weather?horizon=48h');
  assert.match(html, /data-wmetric="temperature" class="active">Температура \+ опади/);
  assert.match(dashboard, /y1=\{position:'right',min:0,max:100/);
  assert.match(dashboard, /const rail=hourlyRows\.slice\(0,12\)/);
  assert.match(dashboard, /class="hourlyItem nowHourlyItem" data-weather-index="now"/);
  assert.match(dashboard, /wind_gusts\?\?x\.wind_gust/);
  assert.match(dashboard, /hmDayNightBands/);
  assert.match(dashboard, /severeWarning\?null:/);
});

test('spec: energy defaults to power/day and only shows tariff bands when configuration exists', async () => {
  const html = await appHtml('/energy?metric=power&period=day');
  assert.match(html, /data-metric="power" class="active"/);
  assert.match(html, /data-smart-scope="energy2"><button data-p="day" class="active"/);
  assert.match(dashboard, /function renderChartsEnergy\(\)/);
  assert.match(dashboard, /if\(!opts\?\.configured\|\|!chart\.chartArea\|\|!chart\.scales\.x\)return/);
  assert.match(dashboard, /function hmCumulativeEnergyValues\(points\)/);
  assert.match(dashboard, /label:'Накоплене споживання',data:hmCumulativeEnergyValues\(points\)/);
  assert.match(dashboard, /total\+=interval;return total/);
  assert.match(dashboard, /options\.scales\.y\.min=0/);
});

test('spec: home widgets cap events and recommendations and avoid inventing null as zero', () => {
  assert.match(dashboard, /events\.slice\(0,2\)/);
  assert.match(dashboard, /slice\(0,3\)/);
  assert.match(dashboard, /const hmNumber=v=>/);
  assert.match(dashboard, /n===null\?'—':fmt\(n,digits\)/);
});
