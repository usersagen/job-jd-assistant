// 运行在页面主世界（document_start），在页面自己的网络请求里找明文薪资。
// BOSS 的薪资数字用自定义字体渲染成私有区字符（如 \ue031），但接口返回的
// salaryDesc 是明文，这里把结果写到 <html data-bz-salary> 供内容脚本读取。
(() => {
  'use strict';

  const ATTR = 'data-bz-salary';
  const API_URL_RE = /wapi\/zpgeek\//;
  const records = new Map();
  let flushTimer = 0;

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      try {
        document.documentElement.setAttribute(ATTR, JSON.stringify(Array.from(records.values())));
      } catch (err) {
        // 页面还没创建 documentElement 时忽略，下次捕获会再写
      }
    }, 30);
  }

  function scan(node, depth) {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach((item) => scan(item, depth + 1));
      return;
    }

    const salary = node.salaryDesc;
    const title = node.jobName;
    if (typeof salary === 'string' && salary && typeof title === 'string' && title) {
      const id = String(node.encryptJobId || '');
      const key = id || `${title}|${node.brandName || ''}`;
      if (!records.has(key)) {
        records.set(key, {
          id,
          title,
          company: String(node.brandName || ''),
          salary
        });
        flush();
      }
    }

    Object.keys(node).forEach((key) => scan(node[key], depth + 1));
  }

  // 只处理 BOSS 招聘接口，且响应里确实带 salaryDesc 才解析
  function handle(url, text) {
    if (!text || text.indexOf('salaryDesc') === -1) return;
    if (!API_URL_RE.test(url)) return;
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return;
    }
    scan(data, 0);
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (...args) {
      const input = args[0];
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const result = originalFetch.apply(this, args);
      // 非招聘接口直接放行，避免把图片/脚本等大响应体复制进内存
      if (!API_URL_RE.test(url)) return result;
      result
        .then((response) => {
          try {
            response.clone().text().then((text) => handle(url, text)).catch(() => {});
          } catch (err) {
            // 响应体不可克隆时跳过
          }
        })
        .catch(() => {});
      return result;
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      const target = String(url || '');
      // 只标记招聘接口，其余请求不挂载监听，减少无谓的响应体读取
      this.__bzUrl = API_URL_RE.test(target) ? target : '';
      return originalOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      const url = this.__bzUrl;
      if (!url) return originalSend.apply(this, arguments);
      this.addEventListener('load', () => {
        try {
          const type = this.responseType;
          if (type === '' || type === 'text') handle(url, this.responseText || '');
          else if (type === 'json' && this.response) handle(url, JSON.stringify(this.response));
        } catch (err) {
          // 忽略读取失败
        }
      });
      return originalSend.apply(this, arguments);
    };
  }

  // 单页应用切换岗位时主动通知内容脚本，替代每秒轮询
  ['pushState', 'replaceState'].forEach((name) => {
    const original = window.history[name];
    if (typeof original !== 'function') return;
    window.history[name] = function () {
      const result = original.apply(this, arguments);
      try {
        window.dispatchEvent(new CustomEvent('bz:locationchange'));
      } catch (err) {
        // 派发失败时忽略，内容脚本仍有 DOM 变更兜底
      }
      return result;
    };
  });
})();
