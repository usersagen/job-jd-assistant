// 会话客户端：内容脚本经 background 读写会话（session storage 不对内容脚本开放）。
import { MSG } from './protocol.js';

function request(payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(payload, (result) => {
        void chrome.runtime.lastError;
        resolve(result || null);
      });
    } catch (err) {
      resolve(null);
    }
  });
}

export function readSession(key) {
  return request({ type: MSG.SESSION, op: 'get', key });
}

export function writeSession(key, record) {
  return request({ type: MSG.SESSION, op: 'set', key, record });
}

export function clearSession(key) {
  return request({ type: MSG.SESSION, op: 'clear', key });
}

export function listSessions() {
  return request({ type: MSG.SESSION, op: 'list' });
}
