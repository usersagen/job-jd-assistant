// 企查查 MCP 工具：查询企业年报人数，字段压缩后交给模型。
import { linkAbort } from './ai.js';

const QCC_MCP_URL = 'https://agent.qcc.com/mcp/company/stream';
const QCC_TIMEOUT = 15 * 1000;

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_company_annual_reports',
      description:
        '查询企业在工商年报中公示的年度从业人数与社会保险参保人数，可用于判断公司规模与人员变化趋势。',
      parameters: {
        type: 'object',
        properties: {
          searchKey: {
            type: 'string',
            description: '企业名称，优先使用当前岗位对应的公司全称'
          }
        },
        required: ['searchKey']
      }
    }
  }
];

export async function fetchAnnualReports(searchKey, rawKey) {
  const key = String(rawKey || '').trim().replace(/^Bearer\s+/i, '');
  if (!key) return { error: '未配置企查查 API Key' };

  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'get_annual_reports', arguments: { searchKey } }
  };

  const link = linkAbort(null);
  const timer = setTimeout(() => link.abort(), QCC_TIMEOUT);
  try {
    const response = await fetch(QCC_MCP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify(payload),
      signal: link.signal
    });
    if (!response.ok) return { error: `企查查接口返回 ${response.status}` };

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    let event = null;

    if (contentType.includes('text/event-stream')) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!event) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('\n');
          if (!data || data === '[DONE]') continue;
          let parsed = null;
          try {
            parsed = JSON.parse(data);
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
        // 已结束
      }
    } else {
      event = await response.json();
    }

    if (!event) return { error: '企查查未返回结果' };
    if (event.error) return { error: `企查查调用失败：${JSON.stringify(event.error).slice(0, 200)}` };

    const text =
      event.result && event.result.content && event.result.content[0] && event.result.content[0].text;
    if (!text) return { error: '企查查返回结构异常' };

    let data = null;
    try {
      data = JSON.parse(text);
    } catch (err) {
      return { error: '企查查返回内容无法解析' };
    }

    const reports = data['企业年报信息'] || [];
    if (!reports.length) return { company: searchKey, reports: [], note: '未查询到企业年报' };

    return {
      company: searchKey,
      reports: reports.slice(0, 8).map((report) => {
        const basic = report['企业基本信息'] || {};
        const social = report['社保信息'] || {};
        return {
          年度: report['年报年度'] || '',
          从业人数: basic['从业人数'] || '',
          参保人数:
            social['城镇职工基本养老保险'] || social['职工基本医疗保险'] || ''
        };
      })
    };
  } catch (err) {
    if (err && err.name === 'AbortError') return { error: '企查查接口请求超时' };
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function runTool(call, settings) {
  if (call.name !== 'get_company_annual_reports') {
    return { error: `未知工具：${call.name}` };
  }
  let args = {};
  try {
    args = JSON.parse(call.args || '{}');
  } catch (err) {
    return { error: '工具参数不是合法 JSON' };
  }
  const searchKey = String(args.searchKey || '').trim();
  if (!searchKey) return { error: '缺少企业名称 searchKey' };
  return fetchAnnualReports(searchKey, settings.qccApiKey);
}
