import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(process.env.DASHBOARD_HTML||new URL('../intraday/index.html',import.meta.url),'utf8');
const start=html.indexOf('let dashboardFlight ='),end=html.indexOf("\nif (typeof document !== 'undefined') {",start);
assert.ok(start>=0&&end>start);
function runtime(comparison='VOO'){
  const context=vm.createContext({});
  vm.runInContext(html.slice(start,end)+'\nglobalThis.metrics={portfolioCurve,intradayHeadline,intradayMonthlyReturns};',context);
  vm.runInContext('selectedBenchmark='+JSON.stringify(comparison),context);
  return {context,...context.metrics};
}
const daily=[
  {date:'2026-09-22',nav:100,benchmark_nav:100,qqq_nav:100},
  {date:'2026-10-22',nav:98,benchmark_nav:101,qqq_nav:99},
  {date:'2026-10-23',nav:97,benchmark_nav:102,qqq_nav:100}
];
const full={timestamp:'2026-10-23T18:07:00Z',nav:96,benchmark_nav:103,qqq_nav:101,base_date:'2026-10-22',base_nav:98,base_benchmark_nav:101,base_qqq_nav:99,sources:[]};
const partial={...full,timestamp:'2026-10-24T04:52:00Z',kind:'partial',nav:null,benchmark_nav:107,qqq_nav:108,base_date:'2026-10-23',base_nav:97,base_benchmark_nav:102,base_qqq_nav:100};
const near=(a,b)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-9,a+' differs from '+b);

test('an incomplete attempt retains the complete valuation and its actual CAGR end time',()=>{
  const {portfolioCurve,intradayHeadline}=runtime();
  const history=daily.slice(0,2),points=portfolioCurve(history,[full,partial]);
  const h=intradayHeadline(points,history);
  near(h.cum,-4);
  assert.equal(h.last.timestamp,full.timestamp);
  const days=(Date.parse(full.timestamp)-Date.parse('2026-09-22T00:00:00-05:00'))/86400000;
  near(h.days,days);
  near(h.cagr,(Math.pow(.96,365.25/days)-1)*100);
  near(h.benchmark,3);
  assert.equal(points.at(-1).nav,null);
});

test('a published close supersedes an earlier reading from the same day',()=>{
  const {portfolioCurve,intradayHeadline}=runtime();
  const points=portfolioCurve(daily,[full,partial]),h=intradayHeadline(points,daily);
  assert.equal(h.last.kind,'eod');
  assert.equal(h.last.day,'2026-10-23');
  assert.equal(h.last.timestamp,null);
  near(h.cum,-3);
  near(h.cagr,(Math.pow(.97,365.25/31)-1)*100);
  near(h.benchmark,2);
  assert.ok(Number.isFinite(h.dd));
  assert.equal(points.at(-1).nav,null);
});

test('a complete observation after the close remains the latest valuation',()=>{
  const {portfolioCurve,intradayHeadline}=runtime();
  const after={...full,timestamp:'2026-10-24T01:07:00Z',nav:98,base_date:'2026-10-23'};
  const h=intradayHeadline(portfolioCurve(daily,[full,after,partial]),daily);
  assert.equal(h.last.timestamp,after.timestamp);
  near(h.cum,-2);
  near(h.benchmark,3);
});

test('QQQ comparisons use the same complete closing date as the strategy',()=>{
  const {portfolioCurve,intradayHeadline}=runtime('QQQ');
  const h=intradayHeadline(portfolioCurve(daily,[full,partial],'QQQ'),daily);
  near(h.cum,-3);
  near(h.benchmark,0);
  near(h.bcagr,0);
});

test('all partial observations can use a validated daily close without inventing a live quote',()=>{
  const {portfolioCurve,intradayHeadline}=runtime();
  const points=portfolioCurve(daily,[partial]);
  const h=intradayHeadline(points,daily);
  near(h.cum,-3);
  assert.equal(h.last.kind,'eod');
  assert.equal(h.last.timestamp,null);
  assert.equal(points.find(point=>point.timestamp===partial.timestamp).nav,null);
  assert.equal(intradayHeadline(portfolioCurve([],[partial])),null);
});

test('a zero return remains numeric after a later partial attempt',()=>{
  const {portfolioCurve,intradayHeadline}=runtime();
  const flat={...full,nav:100};
  const h=intradayHeadline(portfolioCurve(daily.slice(0,1),[flat,partial]));
  near(h.cum,0);
  near(h.cagr,0);
});

test('monthly and year returns retain a valid close when a partial observation arrives',()=>{
  const {portfolioCurve,intradayMonthlyReturns}=runtime();
  const point=portfolioCurve(daily,[partial]).at(-1);
  const rows=intradayMonthlyReturns(daily,point);
  near(rows[0].months[9].value,-3);
  near(rows[0].total.value,-3);
});

test('new complete observations resume metric updates after partial attempts',()=>{
  const {portfolioCurve,intradayHeadline}=runtime();
  const recovered={...full,timestamp:'2026-10-24T04:53:00Z',base_date:'2026-10-23',nav:99};
  const points=portfolioCurve(daily,[full,partial,recovered]),h=intradayHeadline(points,daily);
  near(h.cum,-1);
  assert.equal(h.last.timestamp,recovered.timestamp);
  assert.equal(points.filter(point=>point.kind!=='eod').length,3);
});

test('the actual headline renderer uses the selected valuation for cards, dates and monthly returns',()=>{
  const {context,portfolioCurve}=runtime();
  const points=portfolioCurve(daily,[full,partial]),cells=new Map(),numbers=new Map();
  let monthlyPoint;
  Object.assign(context,{
    livePayload:{daily},mappedPoints:()=>points,
    live:id=>{if(!cells.has(id))cells.set(id,{});return cells.get(id);},
    updateNumber:(id,value)=>numbers.set(id,value),
    refreshMonthly:point=>{monthlyPoint=point;},
    pct:value=>String(value),limaTime:value=>String(value)
  });
  const a=html.indexOf('  function refreshHeadlines(){'),b=html.indexOf('  function node(',a);
  assert.ok(a>=0&&b>a);
  vm.runInContext(html.slice(a,b)+'\nrefreshHeadlines();',context);
  near(numbers.get('cum'),-3);
  assert.ok(Number.isFinite(numbers.get('cagr')));
  assert.equal(monthlyPoint.kind,'eod');
  assert.equal(monthlyPoint.day,'2026-10-23');
  assert.match(cells.get('live-metrics-note').textContent,/cierre EOD 2026-10-23/);
  assert.ok(!cells.get('period-chip').textContent.includes(partial.timestamp));
});
