import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(process.env.DASHBOARD_HTML || new URL('../intraday/index.html', import.meta.url), 'utf8');
const start = html.indexOf('let dashboardFlight =');
const end = html.indexOf("\nif (typeof document !== 'undefined') {", start);
assert.ok(start >= 0 && end > start, 'Chart calculation source must be present');
function calculations(comparison = 'VOO') {
  const context = vm.createContext({});
  vm.runInContext(html.slice(start, end) + '\nglobalThis.chart = { portfolioCurve, intradayWindow, intradayHeadline };', context);
  vm.runInContext('selectedBenchmark = ' + JSON.stringify(comparison), context);
  return context.chart;
}
const daily = [
  {date:'2026-10-15',nav:100,benchmark_nav:100,qqq_nav:100},
  {date:'2026-10-16',nav:98,benchmark_nav:101,qqq_nav:99}
];
const observations = [
  {timestamp:'2026-10-16T22:07:00Z',nav:96,benchmark_nav:101,qqq_nav:99,base_date:'2026-10-15',base_nav:100,base_benchmark_nav:100,base_qqq_nav:100},
  {timestamp:'2026-10-17T00:52:00Z',nav:null,kind:'partial',benchmark_nav:101,qqq_nav:99,base_date:'2026-10-15',base_nav:100,base_benchmark_nav:100,base_qqq_nav:100},
  {timestamp:'2026-10-19T05:07:00Z',nav:null,kind:'partial',benchmark_nav:101,qqq_nav:99,base_date:'2026-10-16',base_nav:98,base_benchmark_nav:101,base_qqq_nav:99},
  {timestamp:'2026-10-19T18:07:00Z',nav:97,benchmark_nav:102,qqq_nav:98,base_date:'2026-10-16',base_nav:98,base_benchmark_nav:101,base_qqq_nav:99}
];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' differs from ' + expected);

test('1D survives an incomplete prior observation and uses the actual preceding close', () => {
  const {portfolioCurve,intradayWindow} = calculations();
  const points = portfolioCurve(daily, observations);
  const window = intradayWindow(points, '1D');
  const base = window.base ?? window.selected[0];
  assert.equal(base.nav, 98);
  assert.equal(base.comparison, 101);
  assert.equal(window.baseDate, '2026-10-16');
  assert.equal(window.selected.length, 2);
  assert.ok(window.selected.every(point => point.day === '2026-10-19'));
  close((window.selected.at(-1).nav / base.nav - 1) * 100, -1.0204081632653061);
  close((window.selected.at(-1).comparison / base.comparison - 1) * 100, .9900990099009901);
  assert.equal(points.find(point => point.timestamp === observations[1].timestamp).nav, null);
});

test('QQQ uses its closing base for the same day as the strategy', () => {
  const {portfolioCurve,intradayWindow} = calculations('QQQ');
  const window = intradayWindow(portfolioCurve(daily, observations, 'QQQ'), '1D');
  assert.equal(window.base.nav, 98);
  assert.equal(window.base.comparison, 99);
  close((window.selected.at(-1).comparison / window.base.comparison - 1) * 100, -1.0101010101010102);
});

test('a temporary missing comparison does not discard its known closing base', () => {
  const {portfolioCurve,intradayWindow} = calculations('QQQ');
  const data = observations.map((point, index) => index === 3 ? {...point, qqq_nav:null, base_qqq_nav:null} : point);
  const window = intradayWindow(portfolioCurve(daily, data, 'QQQ'), '1D');
  assert.equal(window.base.comparison, 99);
  assert.equal(window.selected[0].comparison, 99);
  assert.equal(window.selected.at(-1).comparison, null);
});

test('a later reading based on the new same-day close does not reset the daily return', () => {
  const {portfolioCurve,intradayWindow} = calculations();
  const late = {...observations.at(-1),timestamp:'2026-10-20T01:07:00Z',nav:98.5,base_date:'2026-10-19',base_nav:98.5,base_benchmark_nav:102};
  const window = intradayWindow(portfolioCurve(daily, [...observations,late]), '1D');
  assert.equal(window.baseDate, '2026-10-16');
  assert.equal(window.base.nav, 98);
  assert.equal(window.selected.length, 3);
  close((window.selected.at(-1).nav / window.base.nav - 1) * 100, .5102040816326531);
});

test('zoom in the daily view keeps the validated closing base', () => {
  const {portfolioCurve,intradayWindow} = calculations();
  const points = portfolioCurve(daily, observations);
  const window = intradayWindow(points, '1D', [points.at(-2).time, points.at(-1).time]);
  assert.equal(window.selected.length, 2);
  assert.equal(window.base.nav, 98);
  assert.equal(window.baseDate, '2026-10-16');
});

test('unavailable strategy readings remain unavailable rather than being replaced by a close', () => {
  const {portfolioCurve,intradayWindow} = calculations();
  const data = observations.map(point => ({...point,nav:null,kind:'partial'}));
  const window = intradayWindow(portfolioCurve(daily, data), '1D');
  assert.equal(window.base.nav, 98);
  assert.ok(window.selected.every(point => point.nav === null));
});

test('total history and its headline retain every original observation', () => {
  const {portfolioCurve,intradayWindow,intradayHeadline} = calculations();
  const points = portfolioCurve(daily, observations);
  const window = intradayWindow(points, 'ALL');
  assert.equal(window.selected, points);
  assert.equal(points.filter(point => point.kind !== 'eod').length, observations.length);
  close(intradayHeadline(points).cum, -3);
});

test('a daily-only history keeps the original previous-close window', () => {
  const {portfolioCurve,intradayWindow} = calculations();
  const window = intradayWindow(portfolioCurve(daily, []), '1D');
  assert.equal(window.selected.length, 2);
  assert.equal(window.selected[0].nav, 100);
  assert.equal(window.partial, false);
});
