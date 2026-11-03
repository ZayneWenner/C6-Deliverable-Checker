/*!
 * test/engine.test.js — 规则引擎单元测试（零依赖，node test/engine.test.js）
 * 用例全部来自真实踩过的坑：C1/C2 的「AI协作日志」、C4D 的英文名交付物。
 */
'use strict';

var E = require('../assets/engine.js');

var pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}
function eq(a, b, name) { ok(a === b, name, { got: a, want: b }); }

console.log('\n[1] 模式解析');
var pats = E.parsePatterns('*app链接*,*demo*,*repo链接*,*AI日志*');
eq(pats.length, 4, 'C6 四个模式切成 4 项');
eq(pats[0], '*app链接*', '保留原文，不做变更');
eq(E.parsePatterns('').length, 0, '空串 → 0 项');
eq(E.parsePatterns('*AAR*,*反思*').length, 2, '逗号分隔正常');

console.log('\n[2] 文件名匹配（平台语义：*X* = 包含 X，忽略大小写）');
ok(E.matchPattern('*AI日志*', '贾静文_C6_AI日志.md'), '中文连续名命中');
ok(!E.matchPattern('*AI日志*', 'AI协作日志.md'), '「AI协作日志」不命中 —— C1/C2 的坑');
ok(!E.matchPattern('*AI日志*', 'AI_LOG.md'), '「AI_LOG.md」不命中 —— 英文名陷阱');
ok(!E.matchPattern('*AI日志*', 'AI 日志.md'), '中间带空格「AI 日志」不命中');
ok(E.matchPattern('*ai日志*', '贾静文_C6_AI日志.md'), '模式小写也能匹配大写文件名');
ok(E.matchPattern('README.md', 'README.md'), '无星号 → 完全相等命中');
ok(E.matchPattern('README.md', 'repo/README.md'), '带子目录时按文件名命中');
ok(!E.matchPattern('README.md', 'README.md.bak'), '无星号不做包含匹配');
ok(E.matchPattern('*demo*', '贾静文_C6_demo.mp4'), 'demo 视频命中');
ok(E.matchPattern('*app链接*', 'sub/贾静文_C6_app链接.md'), '子目录里的链接文件也能命中');

console.log('\n[3] C6 完整文件集（应当全部命中）');
var c6 = {
  id: 'ch-20260717031519-qqqx60',
  title: 'C6 Web Application',
  deliverables: '*app链接*,*demo*,*repo链接*,*AI日志*'
};
var goodFiles = [
  { name: '贾静文_C6_app链接.md', size: 812 },
  { name: '贾静文_C6_demo.mp4', size: 1048576 },
  { name: '贾静文_C6_repo链接.md', size: 705 },
  { name: '贾静文_C6_AI日志.md', size: 6100 },
  { name: '贾静文_C6_拿来说明.md', size: 900 }
];
var r1 = E.check(goodFiles, c6);
eq(r1.total, 4, '共 4 项交付物');
eq(r1.hitCount, 4, '4 项全部命中');
eq(r1.ready, true, 'ready = true');
eq(r1.unmatched.length, 1, '「拿来说明」是多余文件（不属 4 项模式）');
eq(r1.level, 'ok', '无警告时 level = ok');

console.log('\n[4] 缺一项时应判定不可提交');
var badFiles = goodFiles.filter(function (f) { return f.name.indexOf('demo') < 0; });
var r2 = E.check(badFiles, c6);
eq(r2.hitCount, 3, '只命中 3 项');
eq(r2.ready, false, 'ready = false');
eq(r2.missing.length, 1, '缺 1 项');
eq(r2.missing[0], '*demo*', '缺的正是 *demo*');
eq(r2.level, 'bad', 'level = bad');

console.log('\n[5] 命名体检能识别错误命名并给出警告');
var badName = [{ name: 'AI协作日志.md', size: 1000 }, { name: '贾静文_C6_demo.mp4', size: 10 }];
var r3 = E.check(badName, c6);
eq(r3.ready, false, '用错名 → 不可提交');
ok(r3.lint.some(function (i) { return /不连续/.test(i.msg); }), '提示「AI日志」四字必须连续');
ok(r3.unmatched.some(function (f) { return f.name === 'AI协作日志.md'; }), '错名文件进入未归因列表');

console.log('\n[6] 0 字节文件应报错级别');
var r4 = E.check([{ name: '贾静文_C6_AI日志.md', size: 0 }], c6);
ok(r4.lint.some(function (i) { return i.level === 'bad'; }), '空文件被标为 bad');

console.log('\n[7] 报告导出');
var md = E.toMarkdown(r1, goodFiles);
ok(md.indexOf('# 交付物体检报告') === 0, 'Markdown 以标题开头');
ok(md.indexOf('4 / 4') >= 0, 'Markdown 含命中比');
var csv = E.toCSV(r2);
eq(csv.split('\n').length, 5, 'CSV 一行表头 + 4 行数据');
ok(csv.indexOf('missing') >= 0, 'CSV 标出缺失项');

console.log('\n---------------------------------------');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
