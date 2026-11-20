// 内容脚本入口：挂载面板、监听路由/页面变化，并响应工具栏与快捷键提取。
import { runtime } from './state.js';
import { HOST_ID, MSG } from '../shared/protocol.js';
import { getAdapter } from './sites/index.js';
import { mount, onExtract } from './ui/panel.js';
import { stopChat, resetChat, restoreChat } from './ui/chat.js';

function checkPage() {
  if (!runtime.ui || !document.getElementById(HOST_ID)) {
    mount();
    restoreChat();
    return;
  }
  const key = getAdapter().pageKey();
  if (key === runtime.lastPageKey) return;
  runtime.lastPageKey = key;
  runtime.lastData = null;
  runtime.ui.panel.hidden = true;
  // 换岗位后清空对话上下文，并尝试恢复该岗位上次的会话
  resetChat();
  restoreChat();
}

function init() {
  mount();
  runtime.lastPageKey = getAdapter().pageKey();
  restoreChat();

  // 用路由事件 + DOM 变更替代 1 秒轮询，静止页面不再产生脚本开销
  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(checkPage, 250);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('bz:locationchange', schedule);
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    clearTimeout(timer);
    stopChat();
  }, { once: true });
}

// 快捷键 / 点击工具栏图标时，由 background 转发过来
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== MSG.EXTRACT) return;
  if (!runtime.ui || !document.getElementById(HOST_ID)) mount();
  onExtract({ copyJson: true });
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
