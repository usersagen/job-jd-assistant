// Markdown 输出与轻量渲染（先转义再生成标签，避免注入）。
export function toMarkdown(data) {
  const lines = [`# ${data.title || '(未提取到职位名称)'}`, ''];
  const push = (label, value) => {
    if (value && String(value).trim()) lines.push(`- **${label}**：${value}`);
  };
  push('公司', data.company);
  push('公司规模', data.companyScale);
  push('薪资', data.salary);
  push('城市', data.city);
  push('经验', data.experience);
  push('学历', data.degree);
  if (data.tags.length) push('标签', data.tags.join(' / '));
  push('HR', data.hr);
  push('地址', data.address);
  push('链接', data.url);
  lines.push('', '## 职位描述', '', data.description || '(未提取到职位描述)');
  return lines.join('\n');
}

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

function esc(text) {
  return String(text).replace(/[&<>]/g, (ch) => ESCAPE[ch]);
}

// 行内格式：行内代码、加粗、斜体、删除线、链接
function inline(text) {
  return esc(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function splitRow(row) {
  return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
}

export function formatMessage(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = '';

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = '';
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块
    if (/^\s*```/.test(line)) {
      closeList();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    // 分割线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      closeList();
      out.push('<hr>');
      continue;
    }

    // 标题
    const head = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (head) {
      closeList();
      out.push(`<b class="h">${inline(head[1])}</b>`);
      continue;
    }

    // 引用
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    // 表格：当前行有 | 且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      closeList();
      const headCells = splitRow(line);
      i++;
      const rows = [];
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) {
        rows.push(splitRow(lines[i + 1]));
        i++;
      }
      out.push('<table><thead><tr>');
      headCells.forEach((cell) => out.push(`<th>${inline(cell)}</th>`));
      out.push('</tr></thead><tbody>');
      rows.forEach((cells) => {
        out.push('<tr>');
        cells.forEach((cell) => out.push(`<td>${inline(cell)}</td>`));
        out.push('</tr>');
      });
      out.push('</tbody></table>');
      continue;
    }

    // 无序列表
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    // 有序列表
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ordered) {
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }

  closeList();
  return out.join('');
}
