(() => {
  // src/shared/protocol.js
  var MSG = {
    EXTRACT: "boss-jd-extract",
    OPEN_OPTIONS: "boss-open-options",
    SESSION: "boss-jd-session"
  };
  var PORT_AI_CHAT = "ai-chat";

  // src/shared/settings.js
  function getBackgroundSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [
          "deepseekApiKey",
          "deepseekBaseUrl",
          "deepseekModel",
          "deepseekThinking",
          "allowCustomBaseUrl",
          "qccApiKey"
        ],
        (items) => resolve(items || {})
      );
    });
  }

  // src/background/ai.js
  var DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
  var DEFAULT_MODEL = "deepseek-flash";
  var TRUSTED_API_HOSTS = ["api.deepseek.com"];
  var HEADER_TIMEOUT = 30 * 1e3;
  var TOTAL_TIMEOUT = 180 * 1e3;
  function validateBaseUrl(raw, allowCustom) {
    let url = null;
    try {
      url = new URL(String(raw || "").trim());
    } catch (err) {
      return { error: "Base URL 格式不正确，请在设置页检查。" };
    }
    if (url.protocol !== "https:") return { error: "Base URL 必须使用 https。" };
    if (TRUSTED_API_HOSTS.includes(url.hostname) || allowCustom === true) {
      return { url: url.href.replace(/\/+$/, "") };
    }
    return { error: "为保护 API Key，自定义 API 域名需先在设置页勾选「允许自定义 API 域名」。" };
  }
  function linkAbort(externalSignal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", onAbort, { once: true });
    }
    return {
      signal: controller.signal,
      abort: () => controller.abort(),
      release: () => {
        if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
      }
    };
  }

  // src/background/tools.js
  var QCC_MCP_URL = "https://agent.qcc.com/mcp/company/stream";
  var QCC_TIMEOUT = 15 * 1e3;
  var TOOLS = [
    {
      type: "function",
      function: {
        name: "get_company_annual_reports",
        description: "查询企业在工商年报中公示的年度从业人数与社会保险参保人数，可用于判断公司规模与人员变化趋势。",
        parameters: {
          type: "object",
          properties: {
            searchKey: {
              type: "string",
              description: "企业名称，优先使用当前岗位对应的公司全称"
            }
          },
          required: ["searchKey"]
        }
      }
    }
  ];
  async function fetchAnnualReports(searchKey, rawKey) {
    const key = String(rawKey || "").trim().replace(/^Bearer\s+/i, "");
    if (!key) return { error: "未配置企查查 API Key" };
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_annual_reports", arguments: { searchKey } }
    };
    const link = linkAbort(null);
    const timer = setTimeout(() => link.abort(), QCC_TIMEOUT);
    try {
      const response = await fetch(QCC_MCP_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream"
        },
        body: JSON.stringify(payload),
        signal: link.signal
      });
      if (!response.ok) return { error: `企查查接口返回 ${response.status}` };
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      let event = null;
      if (contentType.includes("text/event-stream")) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!event) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() || "";
          for (const block of blocks) {
            const data2 = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
            if (!data2 || data2 === "[DONE]") continue;
            let parsed = null;
            try {
              parsed = JSON.parse(data2);
            } catch (err) {
              continue;
            }
            if (parsed.error) return { error: `企查查调用失败：${JSON.stringify(parsed.error).slice(0, 200)}` };
            if (parsed.result) event = parsed;
          }
        }
        try {
          await reader.cancel();
        } catch (err) {
        }
      } else {
        event = await response.json();
      }
      if (!event) return { error: "企查查未返回结果" };
      if (event.error) return { error: `企查查调用失败：${JSON.stringify(event.error).slice(0, 200)}` };
      const text = event.result && event.result.content && event.result.content[0] && event.result.content[0].text;
      if (!text) return { error: "企查查返回结构异常" };
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (err) {
        return { error: "企查查返回内容无法解析" };
      }
      const reports = data["企业年报信息"] || [];
      if (!reports.length) return { company: searchKey, reports: [], note: "未查询到企业年报" };
      return {
        company: searchKey,
        reports: reports.slice(0, 8).map((report) => {
          const basic = report["企业基本信息"] || {};
          const social = report["社保信息"] || {};
          return {
            年度: report["年报年度"] || "",
            从业人数: basic["从业人数"] || "",
            参保人数: social["城镇职工基本养老保险"] || social["职工基本医疗保险"] || ""
          };
        })
      };
    } catch (err) {
      if (err && err.name === "AbortError") return { error: "企查查接口请求超时" };
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  async function runTool(call, settings) {
    if (call.name !== "get_company_annual_reports") {
      return { error: `未知工具：${call.name}` };
    }
    let args = {};
    try {
      args = JSON.parse(call.args || "{}");
    } catch (err) {
      return { error: "工具参数不是合法 JSON" };
    }
    const searchKey = String(args.searchKey || "").trim();
    if (!searchKey) return { error: "缺少企业名称 searchKey" };
    return fetchAnnualReports(searchKey, settings.qccApiKey);
  }

  // src/background/sse.js
  async function streamTurn({ baseUrl, apiKey, model, thinking, messages, useTools, omitThinking, signal, send }) {
    const payload = {
      model,
      messages,
      stream: true,
      temperature: 0.7
    };
    if (!omitThinking) payload.thinking = { type: thinking === false ? "disabled" : "enabled" };
    if (useTools) payload.tools = TOOLS;
    const link = linkAbort(signal);
    let timedOut = false;
    const headerTimer = setTimeout(() => {
      timedOut = true;
      link.abort();
    }, HEADER_TIMEOUT);
    const totalTimer = setTimeout(() => {
      timedOut = true;
      link.abort();
    }, TOTAL_TIMEOUT);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: link.signal
      });
      clearTimeout(headerTimer);
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`请求失败（${response.status}）${detail.slice(0, 200)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      const collected = /* @__PURE__ */ new Map();
      for (; ; ) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let json = null;
            try {
              json = JSON.parse(data);
            } catch (err) {
              continue;
            }
            const choice = json.choices && json.choices[0];
            if (!choice) continue;
            const delta = choice.delta || {};
            if (delta.reasoning_content) send({ type: "reasoning", text: delta.reasoning_content });
            if (delta.content) {
              content += delta.content;
              send({ type: "delta", text: delta.content });
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const part of delta.tool_calls) {
                const index = part.index || 0;
                const current = collected.get(index) || { id: "", name: "", args: "" };
                if (part.id) current.id = part.id;
                if (part.function && part.function.name) current.name += part.function.name;
                if (part.function && part.function.arguments) current.args += part.function.arguments;
                collected.set(index, current);
              }
            }
          }
        }
      }
      const calls = Array.from(collected.entries()).sort((a, b) => a[0] - b[0]).map(([, item]) => ({
        id: item.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: item.name,
        args: item.args || "{}"
      })).filter((item) => item.name);
      return { content, calls };
    } catch (err) {
      if (timedOut && !(signal && signal.aborted)) {
        const timeoutErr = new Error("请求超时，请检查网络或稍后重试。");
        timeoutErr.name = "TimeoutError";
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(headerTimer);
      clearTimeout(totalTimer);
      link.release();
    }
  }

  // src/background/session.js
  var PREFIX = "chat:";
  var MAX_MESSAGES = 60;
  var MAX_SESSIONS = 40;
  var area = () => chrome.storage.session || chrome.storage.local;
  function get(key) {
    return new Promise((resolve) => {
      area().get(key, (items) => resolve(items || {}));
    });
  }
  function set(items) {
    return new Promise((resolve) => {
      area().set(items, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }
  function remove(keys) {
    return new Promise((resolve) => {
      area().remove(keys, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }
  function getAll() {
    return new Promise((resolve) => {
      area().get(null, (items) => resolve(items || {}));
    });
  }
  async function readSession(key) {
    const storageKey = PREFIX + key;
    const items = await get(storageKey);
    const record = items[storageKey];
    return record && Array.isArray(record.messages) ? record : null;
  }
  async function writeSession(key, record) {
    const storageKey = PREFIX + key;
    await set({
      [storageKey]: {
        ...record,
        messages: (record.messages || []).slice(-MAX_MESSAGES)
      }
    });
    await prune();
  }
  function clearSession(key) {
    return remove([PREFIX + key]);
  }
  async function listSessions() {
    const all = await getAll();
    return Object.keys(all).filter((key) => key.startsWith(PREFIX)).map((key) => {
      const record = all[key] || {};
      return {
        key: key.slice(PREFIX.length),
        title: record.title || "",
        company: record.company || "",
        url: record.url || "",
        updatedAt: record.updatedAt || 0,
        count: Array.isArray(record.messages) ? record.messages.length : 0
      };
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async function prune() {
    const all = await getAll();
    const keys = Object.keys(all).filter((key) => key.startsWith(PREFIX));
    if (keys.length <= MAX_SESSIONS) return;
    keys.sort((a, b) => (all[a] && all[a].updatedAt || 0) - (all[b] && all[b].updatedAt || 0));
    await remove(keys.slice(0, keys.length - MAX_SESSIONS));
  }

  // src/background/index.js
  var MAX_TOOL_ROUNDS = 2;
  chrome.action.onClicked.addListener((tab) => {
    if (!tab.id) return;
    chrome.tabs.sendMessage(tab.id, { type: MSG.EXTRACT }, () => {
      void chrome.runtime.lastError;
    });
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;
    if (message.type === MSG.OPEN_OPTIONS) {
      chrome.runtime.openOptionsPage();
      return;
    }
    if (message.type !== MSG.SESSION) return;
    if (message.op === "list") {
      Promise.resolve(listSessions()).then((list) => sendResponse(list || [])).catch(() => sendResponse([]));
      return true;
    }
    const key = String(message.key || "");
    if (!key) {
      sendResponse(null);
      return;
    }
    let task;
    if (message.op === "set") task = writeSession(key, message.record || {});
    else if (message.op === "clear") task = clearSession(key);
    else task = readSession(key);
    Promise.resolve(task).then((result) => sendResponse(result || null)).catch(() => sendResponse(null));
    return true;
  });
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_AI_CHAT) return;
    let controller = null;
    const send = (payload) => {
      try {
        port.postMessage(payload);
      } catch (err) {
      }
    };
    const abort = () => {
      if (controller) {
        controller.abort();
        controller = null;
      }
    };
    port.onDisconnect.addListener(abort);
    port.onMessage.addListener(async (message) => {
      if (!message) return;
      if (message.type === "abort") {
        abort();
        return;
      }
      if (message.type !== "chat") return;
      abort();
      controller = new AbortController();
      const signal = controller.signal;
      try {
        const settings = await getBackgroundSettings();
        if (!settings.deepseekApiKey) {
          send({ type: "error", message: "未配置 DeepSeek API Key，请打开扩展设置页填写。" });
          return;
        }
        const baseCheck = validateBaseUrl(
          settings.deepseekBaseUrl || DEFAULT_BASE_URL,
          settings.allowCustomBaseUrl === true
        );
        if (baseCheck.error) {
          send({ type: "error", message: baseCheck.error });
          return;
        }
        const baseUrl = baseCheck.url;
        const model = (settings.deepseekModel || DEFAULT_MODEL).trim().replace(/^deepseek:/, "");
        let thinking = settings.deepseekThinking !== false;
        let useTools = Boolean(settings.qccApiKey);
        const convo = message.messages.slice();
        const requestTurn = (omitThinking = false) => streamTurn({
          baseUrl,
          apiKey: settings.deepseekApiKey,
          model,
          thinking,
          messages: convo,
          useTools,
          omitThinking,
          signal,
          send
        });
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          let turn = null;
          try {
            turn = await requestTurn();
          } catch (err) {
            const detail = String(err && err.message || err);
            if (round === 0 && /请求失败（400）/.test(detail) && (thinking || useTools)) {
              thinking = false;
              useTools = false;
              send({ type: "notice", message: "当前端点不支持思考/工具参数，已自动降级重试" });
              turn = await requestTurn(true);
            } else {
              throw err;
            }
          }
          if (!turn.calls.length) break;
          convo.push({
            role: "assistant",
            content: turn.content || null,
            tool_calls: turn.calls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.args }
            }))
          });
          for (const call of turn.calls) {
            send({ type: "tool", name: call.name, status: "running" });
            let output = null;
            try {
              output = await runTool(call, settings);
            } catch (err) {
              output = { error: String(err && err.message || err) };
            }
            send({ type: "tool", name: call.name, status: "done", error: Boolean(output && output.error) });
            convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
          }
        }
        send({ type: "done" });
      } catch (err) {
        if (err && err.name === "AbortError") send({ type: "done" });
        else send({ type: "error", message: String(err && err.message || err) });
      } finally {
        controller = null;
      }
    });
  });
})();
