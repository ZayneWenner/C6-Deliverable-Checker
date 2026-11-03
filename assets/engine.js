/*!
 * engine.js — 交付物校验引擎（纯函数，无依赖）
 * 浏览器：window.Engine    Node：module.exports
 *
 * 规则依据：EduSeed 平台 list-challenges 返回的 deliverables 字段，
 * 形如 "*AI日志*,*AAR*,*反思*"，用逗号分隔；含 * 表示"文件名包含中间那串文字"，
 * 不含 * 表示"文件名完全相等"。匹配一律忽略大小写。
 */
(function (root) {
  'use strict';

  /* 平台模式的真实语义：*X* = 文件名包含 X（大小写不敏感），X = 文件名相等 */
  function parsePatterns(spec) {
    if (!spec) return [];
    if (Array.isArray(spec)) spec = spec.join(',');
    return String(spec)
      .split(/[,，;；]/)
      .map(function (t) { return t.trim(); })
      .filter(Boolean);
  }

  function coreOf(pattern) {
    return pattern.replace(/\*/g, '').trim();
  }

  function baseName(path) {
    var s = String(path).replace(/\\/g, '/');
    var i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function matchPattern(pattern, fileName) {
    var p = String(pattern).toLowerCase();
    var n = String(fileName).toLowerCase();
    if (p.indexOf('*') >= 0) {
      var core = p.replace(/\*/g, '').trim();
      return core.length > 0 && n.indexOf(core) >= 0;
    }
    return baseName(n) === p || n === p;
  }

  /* 常见"看起来像但不是"的英文命名 → 提示改中文连续名 */
  var EN_HINTS = [
    { zh: 'AI日志', re: /ai[\s_\-]*(collab\w*)?[\s_\-]*log|ailog|ai[\s_\-]*日记/i, hint: 'AI_LOG.md / AI协作日志.md 都不命中' },
    { zh: '数据截图', re: /screenshot|shot|stastic|statistic|stats|数据快照/i, hint: 'screenshot.png 不命中' },
    { zh: '文章标题', re: /title|标题表/i, hint: 'title.md 不命中' },
    { zh: '拿来说明', re: /attribution|credit|来源说明/i, hint: 'ATTRIBUTION.md 不命中' },
    { zh: '反思', re: /reflection|retro/i, hint: 'reflection.md 不命中' },
    { zh: 'repo链接', re: /repo[\s_\-]*link|repository/i, hint: 'repo-link.md 不命中' }
  ];

  /* 逐文件做命名体检，返回可解释的提示项（不阻塞提交，只提醒） */
  function lint(files, patterns) {
    var out = [];
    var pats = (patterns || []).map(function (p) { return p.toLowerCase(); });

    (files || []).forEach(function (f) {
      var name = f.name || '';
      var lower = name.toLowerCase();

      /* 1) 平台 *AI日志* 要求"AI日志"四个字连续 */
      if (/日志/.test(name) && lower.indexOf('ai日志') < 0 && /ai/i.test(name)) {
        out.push({
          level: 'warn', file: name,
          msg: '文件名里有"AI"和"日志"，但「AI日志」不连续（如 AI协作日志、AI_日志、AI 日志），平台 *AI日志* 模式不命中。'
        });
      }

      /* 2) 用英文名替代中文交付物名 */
      EN_HINTS.forEach(function (h) {
        var needZh = pats.some(function (p) { return p.indexOf(h.zh.toLowerCase()) >= 0; });
        if (!needZh) return;
        if (h.re.test(name) && name.indexOf(h.zh) < 0) {
          out.push({
            level: 'warn', file: name,
            msg: '平台要求文件名含「' + h.zh + '」，' + h.hint + '。建议重命名为 姓名_挑战_' + h.zh + '.md。'
          });
        }
      });

      /* 3) 空文件 */
      if (typeof f.size === 'number' && f.size === 0) {
        out.push({ level: 'bad', file: name, msg: '文件是 0 字节，平台会当成空交付物。' });
      }
    });
    return out;
  }

  /* 主校验：给定文件清单与挑战，算命中矩阵、未归因文件、结论 */
  function check(files, challenge) {
    var patterns = parsePatterns(challenge && challenge.deliverables);
    var list = files || [];
    var used = {};

    var rows = patterns.map(function (pat) {
      var hits = list.filter(function (f) { return matchPattern(pat, f.name); });
      hits.forEach(function (h) { used[h.name] = true; });
      return {
        pattern: pat,
        label: coreOf(pat) || pat,
        hits: hits.map(function (h) { return h.name; }),
        ok: hits.length > 0,
        count: hits.length
      };
    });

    var unmatched = list.filter(function (f) { return !used[f.name]; });
    var missing = rows.filter(function (r) { return !r.ok; }).map(function (r) { return r.pattern; });
    var lintItems = lint(list, patterns);
    var badLint = lintItems.filter(function (i) { return i.level === 'bad'; });

    var level = 'ok';
    if (missing.length > 0 || badLint.length > 0) level = 'bad';
    else if (lintItems.length > 0) level = 'warn';

    var hitCount = rows.length - missing.length;
    return {
      challengeId: challenge && challenge.id,
      title: challenge && challenge.title,
      rows: rows,
      missing: missing,
      unmatched: unmatched,
      lint: lintItems,
      hitCount: hitCount,
      total: rows.length,
      ready: missing.length === 0,
      level: level,
      conclusion: level === 'ok'
        ? '交付物齐全，命名也符合平台模式，可以提交。'
        : (level === 'warn'
          ? '交付物齐全，但有文件名可能不命中平台模式，建议按提示改名后再提交。'
          : '有交付物未命中平台模式，直接提交会导致该项记 0 分。')
    };
  }

  /* 报告导出 */
  function toMarkdown(res, files) {
    var L = [];
    L.push('# 交付物体检报告');
    L.push('');
    L.push('- 挑战：' + (res.title || '（未选择）'));
    L.push('- 挑战 ID：' + (res.challengeId || '-'));
    L.push('- 检出时间：' + new Date().toISOString());
    L.push('- 文件数：' + (files ? files.length : 0));
    L.push('- 交付物命中：' + res.hitCount + ' / ' + res.total);
    L.push('- 结论：' + res.conclusion);
    L.push('');
    L.push('## 交付物命中情况');
    L.push('');
    L.push('| 平台要求 | 命中文件 | 结论 |');
    L.push('| --- | --- | --- |');
    res.rows.forEach(function (r) {
      L.push('| ' + r.pattern + ' | ' + (r.hits.join('<br>') || '—') + ' | ' + (r.ok ? '命中' : '缺失') + ' |');
    });
    L.push('');
    if (res.unmatched.length) {
      L.push('## 未归因文件');
      L.push('');
      res.unmatched.forEach(function (f) { L.push('- ' + f.name); });
      L.push('');
    }
    if (res.lint.length) {
      L.push('## 命名体检');
      L.push('');
      res.lint.forEach(function (i) { L.push('- [' + i.level + '] `' + i.file + '` — ' + i.msg); });
      L.push('');
    }
    return L.join('\n');
  }

  function toCSV(res) {
    var esc = function (s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; };
    var out = ['pattern,label,hit_files,count,status'];
    res.rows.forEach(function (r) {
      out.push([esc(r.pattern), esc(r.label), esc(r.hits.join(' | ')), r.count, r.ok ? 'hit' : 'missing'].join(','));
    });
    return out.join('\n');
  }

  var Engine = {
    parsePatterns: parsePatterns,
    coreOf: coreOf,
    baseName: baseName,
    matchPattern: matchPattern,
    lint: lint,
    check: check,
    toMarkdown: toMarkdown,
    toCSV: toCSV
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : this);
