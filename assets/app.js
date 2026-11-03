/*!
 * app.js — 交付物体检站交互层
 */
(function () {
  'use strict';

  var state = {
    files: [],        /* {name, size, name_only?, preview?, isText?} */
    challenge: null,
    result: null,
    aiResult: null,
    busy: false
  };

  var $ = function (id) { return document.getElementById(id); };

  var CHALLENGES = (window.CHALLENGE_DATA || []).slice();

  /* 1 字节以上才读文本；超过 64KB 只取开头 */
  var PREVIEW_MAX = 4000;
  var TEXT_EXT = /\.(md|markdown|txt|csv|json|ya?ml|html?|css|js|jsx|ts|tsx|py|java|c|cpp|go|rs|sql|log|tex)$/i;

  function fmt(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* ---------- 挑战选择 ---------- */
  function renderChallengeOptions(filter) {
    var sel = $('chSelect');
    var kw = String(filter || '').trim().toLowerCase();
    var list = CHALLENGES.filter(function (c) {
      if (!kw) return true;
      return (c.title + ' ' + c.id).toLowerCase().indexOf(kw) >= 0;
    });
    sel.innerHTML = '';
    if (!list.length) {
      var o = document.createElement('option');
      o.textContent = '没有匹配的挑战';
      o.disabled = true;
      sel.appendChild(o);
      return;
    }
    list.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.title;
      sel.appendChild(o);
    });
    if (state.challenge) {
      var still = list.some(function (c) { return c.id === state.challenge.id; });
      sel.value = still ? state.challenge.id : list[0].id;
    }
    onSelectChallenge();
  }

  function onSelectChallenge() {
    var id = $('chSelect').value;
    var c = CHALLENGES.filter(function (x) { return x.id === id; })[0] || null;
    state.challenge = c;
    var box = $('chMeta');
    if (!c) { box.innerHTML = ''; return; }
    var pats = window.Engine.parsePatterns(c.deliverables);
    box.innerHTML =
      '<span class="pill">交付物 <b>' + pats.length + '</b> 项</span>' +
      '<span class="pill">截止 <b>' + esc(c.deadline || '—') + '</b></span>' +
      '<span class="pill">' + pats.map(function (p) { return esc(p); }).join(' · ') + '</span>';
  }

  /* ---------- 文件收集 ---------- */
  function addFiles(items) {
    var seen = {};
    state.files.forEach(function (f) { seen[f.name] = true; });
    var added = 0;
    items.forEach(function (f) {
      if (!f || !f.name) return;
      if (seen[f.name]) return;
      seen[f.name] = true;
      state.files.push(f);
      added++;
    });
    renderChips();
    if (added) setHint('已加入 ' + added + ' 个文件，共 ' + state.files.length + ' 个。');
  }

  function readAsFileObj(file, relPath) {
    var name = relPath || file.webkitRelativePath || file.name;
    var obj = { name: name, size: file.size, isText: TEXT_EXT.test(name) };
    if (!obj.isText || file.size === 0) return Promise.resolve(obj);
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () {
        obj.preview = String(r.result || '').slice(0, PREVIEW_MAX);
        resolve(obj);
      };
      r.onerror = function () { resolve(obj); };
      r.readAsText(file.slice(0, PREVIEW_MAX));
    });
  }

  function handleFileList(fileList) {
    var arr = Array.prototype.slice.call(fileList || []);
    return Promise.all(arr.map(function (f) { return readAsFileObj(f); })).then(addFiles);
  }

  /* 拖入文件夹：递归遍历（Chromium / Safari 支持 webkitGetAsEntry） */
  function walkEntry(entry, prefix, out) {
    return new Promise(function (resolve) {
      if (!entry) return resolve();
      if (entry.isFile) {
        entry.file(function (file) {
          readAsFileObj(file, prefix + entry.name).then(function (o) {
            out.push(o);
            resolve();
          });
        }, function () { resolve(); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader();
        var all = [];
        var readBatch = function () {
          reader.readEntries(function (entries) {
            if (!entries.length) {
              return Promise.all(all.map(function (e) {
                return walkEntry(e, prefix + entry.name + '/', out);
              })).then(function () { resolve(); });
            }
            all = all.concat(Array.prototype.slice.call(entries));
            readBatch();
          }, function () { resolve(); });
        };
        readBatch();
      } else { resolve(); }
    });
  }

  function handleDrop(dt) {
    var items = dt.items;
    var entries = [];
    if (items && items.length && typeof items[0].webkitGetAsEntry === 'function') {
      for (var i = 0; i < items.length; i++) {
        var e = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
        if (e) entries.push(e);
      }
    }
    if (entries.length) {
      var out = [];
      return Promise.all(entries.map(function (e) { return walkEntry(e, '', out); }))
        .then(function () { addFiles(out); });
    }
    return handleFileList(dt.files);
  }

  function renderChips() {
    var box = $('fileList');
    box.innerHTML = '';
    if (!state.files.length) {
      setHint('');
      return;
    }
    state.files.forEach(function (f, i) {
      var d = document.createElement('span');
      d.className = 'chip';
      d.innerHTML = esc(window.Engine.baseName(f.name)) +
        (f.name.indexOf('/') >= 0 ? ' <span class="muted">（子目录）</span>' : '') +
        ' <span class="x" data-i="' + i + '">×</span>';
      d.title = f.name + ' · ' + fmt(f.size);
      box.appendChild(d);
    });
    $('fileList').onclick = function (ev) {
      var t = ev.target;
      if (!t.classList.contains('x')) return;
      var i = Number(t.getAttribute('data-i'));
      state.files.splice(i, 1);
      renderChips();
    };
    setHint(state.files.length + ' 个文件待体检');
  }

  function setHint(s) { $('hint').textContent = s || ''; }

  /* ---------- 体检 ---------- */
  function runCheck() {
    if (!state.challenge) { setHint('先选一个挑战。'); return; }
    if (!state.files.length) { setHint('还没有文件。拖进来或粘贴一份清单。'); return; }

    var res = window.Engine.check(state.files, state.challenge);
    state.result = res;
    state.aiResult = null;

    $('result').hidden = false;

    var v = $('verdict');
    v.className = 'card verdict ' + res.level;
    v.innerHTML =
      '<div><div class="vbig">' + res.hitCount + ' / ' + res.total + ' 项交付物命中</div>' +
      '<div class="vsub">' + esc(res.conclusion) + '</div></div>';

    var tb = $('tblPatterns').querySelector('tbody');
    tb.innerHTML = '';
    res.rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><code>' + esc(r.pattern) + '</code></td>' +
        '<td class="files">' + (r.hits.length ? r.hits.map(esc).join('<br>') : '—') + '</td>' +
        '<td>' + (r.ok ? '<span class="tagok">命中</span>' : '<span class="tagbad">缺失</span>') + '</td>';
      tb.appendChild(tr);
    });

    var um = $('unmatched');
    um.innerHTML = '';
    $('unmatchedCount').textContent = res.unmatched.length
      ? '（' + res.unmatched.length + ' 个）' : '';
    if (!res.unmatched.length) {
      um.innerHTML = '<p class="empty">没有多余文件，每个文件都对上了某项交付物。</p>';
    } else {
      res.unmatched.forEach(function (f) {
        var d = document.createElement('div');
        d.className = 'ufile';
        d.textContent = f.name + '  ·  ' + fmt(f.size);
        um.appendChild(d);
      });
    }

    if (res.lint.length) {
      res.lint.forEach(function (i) {
        var d = document.createElement('div');
        d.className = 'err';
        d.textContent = '命名提示 · ' + i.file + '：' + i.msg;
        um.appendChild(d);
      });
    }

    $('aiOut').innerHTML = '<p class="empty">' +
      (res.unmatched.length || res.missing.length
        ? '点上面的按钮，让 AI 判断这些没归上的文件各是什么、该改成什么名字。'
        : '这次没有需要归因的文件。') + '</p>';

    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- AI ---------- */
  function renderAI(r) {
    var box = $('aiOut');
    box.innerHTML = '';
    var add = function (html) {
      var d = document.createElement('div');
      d.className = 'aitem';
      d.innerHTML = html;
      box.appendChild(d);
    };

    if (r.attributions.length) {
      r.attributions.forEach(function (a) {
        add(
          '<div class="h"><span class="fname">' + esc(a.file) + '</span>' +
          '<span class="conf">' + esc(a.confidence || '?') + '</span>' +
          '<span class="muted small">→ ' + esc(a.pattern || '') + '</span></div>' +
          '<div class="reason">' + esc(a.reason || '') + '</div>' +
          (a.renameTo ? '<div class="rename">建议改名：' + esc(a.renameTo) + '</div>' : '')
        );
      });
    }
    if (r.gaps && r.gaps.length) {
      r.gaps.forEach(function (g) {
        add('<div class="h"><span class="tagbad">仍然缺</span><span class="muted small">' +
          esc(g.pattern || '') + '</span></div><div class="reason">' + esc(g.advice || '') + '</div>');
      });
    }
    if (r.risks && r.risks.length) {
      add('<div class="h"><span class="muted small">整体风险</span></div><div class="reason">' +
        r.risks.map(function (x) { return '· ' + esc(x); }).join('<br>') + '</div>');
    }
    if (!box.children.length) {
      box.innerHTML = '<p class="empty">模型没有给出可用的归因结果。</p>';
    }
    var foot = document.createElement('p');
    foot.className = 'muted small';
    foot.style.marginTop = '6px';
    foot.textContent = '由 ' + r.model + ' 生成 · AI 结论仅供参考，最终以平台预检为准。';
    box.appendChild(foot);
  }

  function doAI() {
    if (!state.result) return;
    var cfg = window.AI.loadConfig();
    if (!cfg) {
      $('aiOut').innerHTML = '<div class="err">还没有配置模型 Key。点右上角「AI 设置」填入你自己的 Key——' +
        '本站不内置任何密钥，Key 只存在你本机浏览器里。</div>';
      $('settings').showModal();
      return;
    }
    var btn = $('btnAI');
    btn.disabled = true;
    btn.textContent = '分析中…';
    $('aiOut').innerHTML = '<p class="empty">正在把 ' +
      state.result.unmatched.length + ' 个未归因文件交给 ' + esc(cfg.model) + ' 判断…</p>';

    window.AI.analyze({
      patterns: state.result.rows.map(function (r) { return r.pattern; }),
      files: state.result.unmatched.map(function (f) {
        return { name: f.name, size: f.size, preview: f.preview || '' };
      }),
      cfg: cfg
    }).then(function (r) {
      state.aiResult = r;
      renderAI(r);
    }).catch(function (err) {
      $('aiOut').innerHTML = '<div class="err">' + esc(err.message || String(err)) +
        '<br><br>可以点右上角「AI 设置」换服务商或 base 地址；不配 AI 也能用上面的规则结论完成体检。</div>';
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '用 AI 分析';
    });
  }

  /* ---------- 导出 ---------- */
  function download(name, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function exportMD() {
    if (!state.result) return;
    var md = window.Engine.toMarkdown(state.result, state.files);
    if (state.aiResult) {
      md += '\n## AI 归因\n\n';
      state.aiResult.attributions.forEach(function (a) {
        md += '- `' + a.file + '` → ' + a.pattern + '（' + a.confidence + '）：' + a.reason +
          (a.renameTo ? '　建议改名 `' + a.renameTo + '`' : '') + '\n';
      });
      if (state.aiResult.gaps && state.aiResult.gaps.length) {
        md += '\n### 仍缺\n\n';
        state.aiResult.gaps.forEach(function (g) { md += '- ' + g.pattern + '：' + g.advice + '\n'; });
      }
      md += '\n> 归因由 ' + state.aiResult.model + ' 生成，仅供参考。\n';
    }
    download('交付物体检_' + (state.challenge ? state.challenge.title.replace(/\s+/g, '') : 'report') + '.md', md, 'text/markdown');
  }

  function exportCSV() {
    if (!state.result) return;
    download('交付物体检.csv', window.Engine.toCSV(state.result), 'text/csv');
  }

  /* ---------- 设置弹窗 ---------- */
  function openSettings() {
    var c = window.AI.loadConfig() || {};
    var p = c.provider || 'openai';
    $('cfgProvider').value = p;
    $('cfgBase').value = c.base || window.AI.PRESETS[p].base;
    $('cfgModel').value = c.model || window.AI.PRESETS[p].model;
    $('cfgKey').value = c.key || '';
    $('settings').showModal();
  }

  function refreshModeBadge() {
    var c = window.AI.loadConfig();
    var b = $('modeBadge');
    if (c) {
      b.className = 'badge ai';
      b.textContent = 'AI 就绪 · ' + c.model;
    } else {
      b.className = 'badge rule';
      b.textContent = '规则模式';
    }
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    $('chSearch').addEventListener('input', function () { renderChallengeOptions(this.value); });
    $('chSelect').addEventListener('change', onSelectChallenge);

    var drop = $('drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault(); drop.classList.add('hot');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault(); drop.classList.remove('hot');
      });
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer) handleDrop(e.dataTransfer).then(runCheck);
    });
    /* 整个页面也可拖入，避免拖到别处被浏览器直接打开文件 */
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    $('btnPick').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function () {
      handleFileList(this.files).then(runCheck);
      this.value = '';
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) {
          x.classList.remove('on');
        });
        t.classList.add('on');
        var which = t.getAttribute('data-tab');
        $('pane-drop').hidden = which !== 'drop';
        $('pane-paste').hidden = which !== 'paste';
      });
    });

    $('btnParse').addEventListener('click', function () {
      var lines = $('pasteBox').value.split(/[\r\n]+/)
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      if (!lines.length) { setHint('清单是空的。'); return; }
      addFiles(lines.map(function (n) { return { name: n, size: null }; }));
      runCheck();
    });

    $('btnCheck').addEventListener('click', runCheck);
    $('btnReset').addEventListener('click', function () {
      state.files = [];
      state.result = null;
      state.aiResult = null;
      renderChips();
      $('result').hidden = true;
      $('pasteBox').value = '';
      setHint('');
    });

    $('btnAI').addEventListener('click', doAI);
    $('btnMD').addEventListener('click', exportMD);
    $('btnCSV').addEventListener('click', exportCSV);

    $('btnSettings').addEventListener('click', openSettings);
    $('cfgProvider').addEventListener('change', function () {
      var p = this.value;
      $('cfgBase').value = window.AI.PRESETS[p].base;
      $('cfgModel').value = window.AI.PRESETS[p].model;
    });
    $('btnSaveCfg').addEventListener('click', function () {
      var cfg = {
        provider: $('cfgProvider').value,
        base: $('cfgBase').value.trim() || window.AI.PRESETS.openai.base,
        model: $('cfgModel').value.trim() || 'gpt-4o-mini',
        key: $('cfgKey').value.trim()
      };
      if (!cfg.key) { setHint('Key 是空的，没有保存。'); return; }
      window.AI.saveConfig(cfg);
      refreshModeBadge();
      $('settings').close();
      setHint('AI 配置已保存在本机浏览器。');
    });
    $('btnClearCfg').addEventListener('click', function () {
      window.AI.clearConfig();
      refreshModeBadge();
      $('cfgKey').value = '';
      setHint('已清除本机的 Key。');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    renderChallengeOptions('');
    refreshModeBadge();
    /* 默认选 C6：这是本工具最常用的场景 */
    var c6 = CHALLENGES.filter(function (c) { return /C6/.test(c.title); })[0];
    if (c6) {
      $('chSelect').value = c6.id;
      onSelectChallenge();
    }
  });
})();
