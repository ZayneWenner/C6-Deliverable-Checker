/*!
 * ai.js — AI 归因模块（BYOK，自带 Key）
 *
 * 为什么这样设计：C6 要求 AI 是核心功能且 Key 不得硬编码前端。
 * 因此不内置任何密钥，由用户填入自己的模型服务商与 Key，直接从前端
 * 发往该服务商；本站无任何后端，也不中转请求。
 *
 * 两种协议：OpenAI 兼容（/chat/completions）、Anthropic（/v1/messages）。
 */
(function (root) {
  'use strict';

  var LS_KEY = 'dc_ai_cfg_v1';

  var PRESETS = {
    openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    anthropic: { base: 'https://api.anthropic.com', model: 'claude-3-5-haiku-latest' }
  };

  function loadConfig() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.key) return null;
      return c;
    } catch (e) { return null; }
  }

  function saveConfig(cfg) {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  }

  function clearConfig() {
    localStorage.removeItem(LS_KEY);
  }

  /* 从模型回复里挖 JSON：容忍 ```json 围栏、前后废话 */
  function extractJSON(text) {
    if (!text) throw new Error('模型返回空内容');
    var s = String(text).trim();
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    var i = s.indexOf('{');
    var j = s.lastIndexOf('}');
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
    return JSON.parse(s);
  }

  function buildPrompt(payload) {
    var patterns = payload.patterns || [];
    var files = payload.files || [];

    var sys = [
      '你是 EduSeed 课程交付物体检助手。学生要把一批文件提交到平台的挑战任务，',
      '平台按 deliverables 模式串校验文件名，未命中的交付物记 0 分。',
      '任务：判断每个"未归因文件"实际属于哪个交付物，给出应改成的文件名，并指出还缺什么。',
      '',
      '输出严格的 JSON（不要任何解释文字），结构：',
      '{',
      '  "attributions": [{"file":"原文件名","pattern":"它对应的交付物模式","confidence":"high|medium|low","reason":"一句话依据","renameTo":"建议文件名"}],',
      '  "gaps": [{"pattern":"仍然没有合适文件的交付物","advice":"具体要补什么内容才能得分"}],',
      '  "risks": ["整体风险提示，最多 3 条"]',
      '}',
      '',
      '硬约束：',
      '1. 只能使用给定的交付物模式原文，不要编造新模式。',
      '2. 文件名必须含该模式去掉 * 后的中文关键词；平台按"包含匹配"，中文必须连续。',
      '3. 若文件内容与任何交付物都不匹配，不要硬塞，attributions 里不放它，在 risks 里说明。',
      '4. 建议文件名格式：姓名_挑战号_关键词.扩展名。'
    ].join('\n');

    var user = [
      '## 平台要求的交付物（共 ' + patterns.length + ' 项）',
      patterns.map(function (p) { return '- ' + p; }).join('\n'),
      '',
      '## 未归因文件（共 ' + files.length + ' 个，附开头内容）',
      files.map(function (f, i) {
        return '### ' + (i + 1) + '. ' + f.name +
          '\n大小：' + (f.size == null ? '未知' : f.size + ' 字节') +
          '\n开头内容：\n' + (f.preview ? f.preview.slice(0, 500) : '（二进制或无法读取文本）');
      }).join('\n\n'),
      '',
      '请只输出 JSON。'
    ].join('\n');

    return { system: sys, user: user };
  }

  function callOpenAI(cfg, prompt, signal) {
    var url = cfg.base.replace(/\/+$/, '') + '/chat/completions';
    return fetch(url, {
      method: 'POST',
      signal: signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ]
      })
    }).then(readResponse).then(function (data) {
      var t = data && data.choices && data.choices[0] && data.choices[0].message &&
        data.choices[0].message.content;
      if (!t) throw new Error('返回结构不符合 OpenAI 格式');
      return t;
    });
  }

  function callAnthropic(cfg, prompt, signal) {
    var url = cfg.base.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/messages';
    return fetch(url, {
      method: 'POST',
      signal: signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
        /* 浏览器直连 Anthropic 必须显式声明，否则被 CORS 拦 */
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 1200,
        temperature: 0,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }]
      })
    }).then(readResponse).then(function (data) {
      var blocks = (data && data.content) || [];
      var t = blocks.filter(function (b) { return b.type === 'text'; })
        .map(function (b) { return b.text; }).join('\n');
      if (!t) throw new Error('返回结构不符合 Anthropic 格式');
      return t;
    });
  }

  function readResponse(res) {
    return res.text().then(function (body) {
      var data = null;
      try { data = JSON.parse(body); } catch (e) { /* 非 JSON */ }
      if (!res.ok) {
        var msg = (data && (data.error && (data.error.message || data.error)) ) ||
          body.slice(0, 200) || ('HTTP ' + res.status);
        throw new Error('服务商返回 ' + res.status + '：' + (typeof msg === 'string' ? msg : JSON.stringify(msg)));
      }
      if (data == null) throw new Error('服务商返回了非 JSON 内容：' + body.slice(0, 120));
      return data;
    });
  }

  /* 主入口：analyze({patterns, files, cfg}) → 结构化结果 */
  function analyze(payload) {
    var cfg = payload.cfg || loadConfig();
    if (!cfg || !cfg.key) {
      return Promise.reject(new Error('还没有配置模型 Key。点右上角「AI 设置」填一个，或直接用下面的规则模式结论。'));
    }
    var prompt = buildPrompt(payload);
    var ctrl = null;
    var signal;
    if (typeof AbortController !== 'undefined') {
      ctrl = new AbortController();
      signal = ctrl.signal;
      setTimeout(function () { ctrl.abort(); }, 45000);
    }

    var call = cfg.provider === 'anthropic' ? callAnthropic : callOpenAI;
    return call(cfg, prompt, signal).then(function (text) {
      var parsed = extractJSON(text);
      return {
        ok: true,
        raw: text,
        attributions: Array.isArray(parsed.attributions) ? parsed.attributions : [],
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        model: cfg.model
      };
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('请求超时（45 秒）。可能是网络不通或服务商被墙，换一个 base 地址试试。');
      }
      throw err;
    });
  }

  var AI = {
    PRESETS: PRESETS,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    buildPrompt: buildPrompt,
    extractJSON: extractJSON,
    analyze: analyze
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
  else root.AI = AI;
})(typeof window !== 'undefined' ? window : this);
