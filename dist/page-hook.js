(() => {
  // src/page-hook/index.js
  (() => {
    "use strict";
    const ATTR = "data-bz-salary";
    const API_URL_RE = /wapi\/zpgeek\//;
    const records = /* @__PURE__ */ new Map();
    let flushTimer = 0;
    function flush() {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        try {
          document.documentElement.setAttribute(ATTR, JSON.stringify(Array.from(records.values())));
        } catch (err) {
        }
      }, 30);
    }
    function scan(node, depth) {
      if (!node || typeof node !== "object" || depth > 6) return;
      if (Array.isArray(node)) {
        node.forEach((item) => scan(item, depth + 1));
        return;
      }
      const salary = node.salaryDesc;
      const title = node.jobName;
      if (typeof salary === "string" && salary && typeof title === "string" && title) {
        const id = String(node.encryptJobId || "");
        const key = id || `${title}|${node.brandName || ""}`;
        if (!records.has(key)) {
          records.set(key, {
            id,
            title,
            company: String(node.brandName || ""),
            salary
          });
          flush();
        }
      }
      Object.keys(node).forEach((key) => scan(node[key], depth + 1));
    }
    function handle(url, text) {
      if (!text || text.indexOf("salaryDesc") === -1) return;
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
    if (typeof originalFetch === "function") {
      window.fetch = function(...args) {
        const input = args[0];
        const url = typeof input === "string" ? input : input && input.url || "";
        const result = originalFetch.apply(this, args);
        if (!API_URL_RE.test(url)) return result;
        result.then((response) => {
          try {
            response.clone().text().then((text) => handle(url, text)).catch(() => {
            });
          } catch (err) {
          }
        }).catch(() => {
        });
        return result;
      };
    }
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const originalOpen = XHR.prototype.open;
      const originalSend = XHR.prototype.send;
      XHR.prototype.open = function(method, url) {
        const target = String(url || "");
        this.__bzUrl = API_URL_RE.test(target) ? target : "";
        return originalOpen.apply(this, arguments);
      };
      XHR.prototype.send = function() {
        const url = this.__bzUrl;
        if (!url) return originalSend.apply(this, arguments);
        this.addEventListener("load", () => {
          try {
            const type = this.responseType;
            if (type === "" || type === "text") handle(url, this.responseText || "");
            else if (type === "json" && this.response) handle(url, JSON.stringify(this.response));
          } catch (err) {
          }
        });
        return originalSend.apply(this, arguments);
      };
    }
    ["pushState", "replaceState"].forEach((name) => {
      const original = window.history[name];
      if (typeof original !== "function") return;
      window.history[name] = function() {
        const result = original.apply(this, arguments);
        try {
          window.dispatchEvent(new CustomEvent("bz:locationchange"));
        } catch (err) {
        }
        return result;
      };
    });
  })();
})();
