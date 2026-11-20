// API 配置、地址校验与请求取消控制。
export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
export const DEFAULT_MODEL = 'deepseek-flash';
export const TRUSTED_API_HOSTS = ['api.deepseek.com'];
export const HEADER_TIMEOUT = 30 * 1000;
export const TOTAL_TIMEOUT = 180 * 1000;

export { getBackgroundSettings as getSettings } from '../shared/settings.js';

// 只允许 https；非 DeepSeek 官方域名需在设置页显式开启，避免 API Key 被发往未知站点
export function validateBaseUrl(raw, allowCustom) {
  let url = null;
  try {
    url = new URL(String(raw || '').trim());
  } catch (err) {
    return { error: 'Base URL 格式不正确，请在设置页检查。' };
  }
  if (url.protocol !== 'https:') return { error: 'Base URL 必须使用 https。' };
  if (TRUSTED_API_HOSTS.includes(url.hostname) || allowCustom === true) {
    return { url: url.href.replace(/\/+$/, '') };
  }
  return { error: '为保护 API Key，自定义 API 域名需先在设置页勾选「允许自定义 API 域名」。' };
}

// 绑定外部取消信号，便于与超时控制合并
export function linkAbort(externalSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    release: () => {
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  };
}
