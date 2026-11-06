/* ==========================================================================
   校园档案 · 前端逻辑
   - 纯前端，无依赖，无构建
   - 数据来源：data/<分类>/list.json 与 data/<分类>/<id>.txt
   - 兼容 file:// 直接打开：fetch 失败时自动回退到 js/data-mirror.js 内嵌数据
   ========================================================================== */
(function (global) {
  'use strict';

  /* ----------------------------- 常量与配置 ----------------------------- */

  var TYPES = ['诸生', '师长', '校宰', '杂文'];        // 允许的分类，防止路径注入
  var DATA_ROOT = 'data/';                     // 数据根目录（相对路径，配置项）

  /* ------------------------------- 工具函数 ------------------------------- */

  // 转义 HTML，避免 txt 内容破坏页面结构
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, String.fromCharCode(38) + 'quot;')
      .replace(/'/g, '&#39;');
  }

  // 读取 URL 查询参数
  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  // 校验收到的分类名是否合法
  function normType(t) {
    t = (t || '').trim();
    return TYPES.indexOf(t) !== -1 ? t : '';
  }

  // 仅允许安全 id，杜绝 ../ 之类的越权路径
  function safeId(id) {
    return /^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,64}$/.test(id || '') ? id : '';
  }

  // 带超时的 fetch 文本
  function fetchText(url, timeout) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) { ctrl.abort(); } }, timeout || 6000);

    return fetch(url, {
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) { throw new Error('HTTP ' + res.status); }
      return res.text();
    }).then(function (text) {
      clearTimeout(timer);
      return text;
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // 内嵌数据镜像（file:// 场景的后备数据源

  // 统一获取列表：先网络文件，失败则用镜像
  function loadList(type) {
    var url = DATA_ROOT + encodeURIComponent(type) + '/list.json';

    return fetchText(url).then(function (txt) {
      var data = JSON.parse(txt);
      var items = Array.isArray(data) ? data : (data.items || []);
      return { items: items, source: 'file' };
    }).catch(function () {
      var m = mirror();
      if (m && m[type] && Array.isArray(m[type].list)) {
        return { items: m[type].list, source: 'mirror' };
      }
      throw new Error('无法加载列表数据');
    });
  }

  // 统一获取正文 txt：先网络文件，失败则用镜像
  function loadText(type, id) {
    var url = DATA_ROOT + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.txt';

    return fetchText(url).then(function (txt) {
      return { text: txt, source: 'file' };
    }).catch(function () {
      var m = mirror();
      if (m && m[type] && m[type].files && typeof m[type].files[id] === 'string') {
        return { text: m[type].files[id], source: 'mirror' };
      }
      throw new Error('无法加载正文内容');
    });
  }

  /* --------------------------- txt → HTML 渲染 --------------------------- */

  // 判断一行是否像小标题
  function isHeading(line) {
    return /^[■◆●【\[].*[】\]]?\s*$/.test(line) ||
           /^[一二三四五六七八九十]+[、.]/.test(line) ||
           (line.length <= 24 && /[：:]\s*$/.test(line));
  }

  // 判断一行是否像引用
  function isQuote(line) {
    return /^[>＞｜|]/.test(line);
  }

  // 把纯文本转成段落化 HTML，保留空行分段
  function textToHtml(raw) {
    var lines = String(raw == null ? '' : raw)
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '')
      .split('\n');

    var html = [];
    var buf = [];

    function flush() {
      if (!buf.length) { return; }
      html.push('<p>' + buf.map(esc).join('<br>') + '</p>');
      buf = [];
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+$/, '');
      var trim = line.trim();

      if (trim === '') { flush(); continue; }

      if (isQuote(trim)) {
        flush();
        html.push('<p class="line-q">' + esc(trim.replace(/^[>＞｜|]\s?/, '')) + '</p>');
        continue;
      }

      if (isHeading(trim)) {
        flush();
        html.push('<p class="line-h">' + esc(trim.replace(/^[■◆●]\s?/, '')) + '</p>');
        continue;
      }

      buf.push(line);
    }

    flush();

    return html.length ? html.join('') : '<p>（本文暂无内容）</p>';
  }

  /* ------------------------------- 列表页 ------------------------------- */

  function renderListPage() {
    var type = normType(qs('type'));
    var elTitle = document.getElementById('pageTitle');
    var elList = document.getElementById('list');
    var elLoad = document.getElementById('loading');
    var elEmpty = document.getElementById('empty');
    var elErr = document.getElementById('error');
    var elCount = document.getElementById('count');

    if (!type) {
      elTitle.textContent = '未知分类';
      elLoad.hidden = true;
      elErr.hidden = false;
      elErr.innerHTML = '分类参数无效。请从首页的按钮进入，或检查地址栏参数 <code>?type=</code> 是否正确。';
      return;
    }

    document.title = type + ' ';
    elTitle.textContent = type;

    loadList(type).then(function (res) {
      var items = res.items || [];
      elLoad.hidden = true;

      if (!items.length) {
        elEmpty.hidden = false;
        return;
      }

      var html = '';
      for (var i = 0; i < items.length; i++) {
        var it = items[i] || {};
        var id = safeId(it.id);
        if (!id) { continue; }

        var href = 'detail.html?type=' + encodeURIComponent(type) +
                   '&id=' + encodeURIComponent(id);

        html += '<li>' +
          '<a class="item-link" href="' + href + '">' +
            '<span class="item-no">' + (i + 1) + '</span>' +
            '<span class="item-body">' +
              '<span class="item-title">' + esc(it.title || id) + '</span>' +
              (it.desc ? '<span class="item-desc">' + esc(it.desc) + '</span>' : '') +
            '</span>' +
            '<span class="item-arrow">›</span>' +
          '</a>' +
        '</li>';
      }

      elList.innerHTML = html;

      if (!html) {
        elEmpty.hidden = false;
        return;
      }

      elCount.textContent = '共 ' + elList.children.length + ' 条';
    }).catch(function (err) {
      elLoad.hidden = true;
      elErr.hidden = false;
      elErr.innerHTML = '列表加载失败：' + esc(err.message) +
        '<br>请确认 <code>' + esc(DATA_ROOT + type + '/list.json') +
        '</code> 存在。若用浏览器直接打开本地文件（file://），' +
        '受同源策略限制会读取失败，此时将自动使用 <code>js/data-mirror.js</code> 的内嵌数据。';
    });
  }

  /* ------------------------------- 详情页 ------------------------------- */

  function renderDetailPage() {
    var type = normType(qs('type'));
    var id = safeId(qs('id'));
    var elTitle = document.getElementById('pageTitle');
    var elMeta = document.getElementById('meta');
    var elContent = document.getElementById('content');
    var elLoad = document.getElementById('loading');
    var elErr = document.getElementById('error');
    var elBack = document.getElementById('backLink');

    if (!type || !id) {
      elTitle.textContent = '参数有误';
      elLoad.hidden = true;
      elErr.hidden = false;
      elErr.innerHTML = '缺少或非法的地址参数，应形如 ' +
        '<code>detail.html?type=诸生&amp;id=s01</code>。';
      return;
    }

    // 返回按钮回到对应分类列表
    if (elBack) {
      elBack.setAttribute('href', 'list.html?type=' + encodeURIComponent(type));
    }

    document.title = '载入中…';

    // 先用列表里的标题占位，正文到达后替换
    loadList(type).then(function (res) {
      var found = null;
      for (var i = 0; i < res.items.length; i++) {
        if (res.items[i] && String(res.items[i].id) === id) { found = res.items[i]; break; }
      }
      if (found) {
        elTitle.textContent = found.title || id;
        document.title = (found.title || id) + ' · ' + type + ' ';
        elMeta.innerHTML =
          '<span class="tag">' + esc(type) + '</span>' +
          (found.date ? '<span class="tag">' + esc(found.date) + '</span>' : '');
      } else {
        elTitle.textContent = id;
      }
    }).catch(function () { /* 列表失败不影响正文渲染 */ });

    loadText(type, id).then(function (res) {
      elLoad.hidden = true;
      elContent.innerHTML = textToHtml(res.text);
    }).catch(function (err) {
      elLoad.hidden = true;
      elErr.hidden = false;
      elErr.innerHTML = '内容加载失败：' + esc(err.message) +
        '<br>请确认 <code>' + esc(DATA_ROOT + type + '/' + id + '.txt') +
        '</code> 存在，或该文件已写入 <code>js/data-mirror.js</code>。';
    });
  }

  /* ------------------------------- 导出 ------------------------------- */

  global.renderListPage = renderListPage;
  global.renderDetailPage = renderDetailPage;
  global.__ARCHIVE__ = { textToHtml: textToHtml, esc: esc };

})(window);
