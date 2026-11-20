# 岗位信息提取助手

Chrome MV3 扩展：在 BOSS 直聘、智联招聘、厦门人才网、猎聘的职位页一键提取岗位信息，复制为 Markdown / JSON，并结合简历与岗位进行 AI 对话分析，可选调用企查查查询企业年报。

当前版本：1.7.0

## 功能

- 字段提取：职位名称、公司、公司规模、薪资、城市、经验、学历、标签、HR、地址、职位描述、链接
- 复制为 Markdown 或 JSON
- AI 对话：结合当前岗位与简历回答，支持快捷追问、流式输出、思考过程展示、随时停止
- 企业年报：配置企查查 Key 后，可让模型调用工具查询近三年从业人数 / 参保人数
- 单页应用适配：BOSS 列表页（`/web/geek/jobs`、公司职位页 `/gongsi/job/`）切换岗位时自动重置上下文
- 薪资还原：BOSS 用私有区字符渲染薪资时，从页面接口响应中还原明文

## 支持站点

| 站点 | 适用页面 |
| --- | --- |
| BOSS 直聘 | `*.zhipin.com/job_detail/*`、`*.zhipin.com/web/geek/jobs*`、`*.zhipin.com/gongsi/job/*` |
| 智联招聘 | `*.zhaopin.com/jobdetail/*`、`xiaoyuan.zhaopin.com/job/*` |
| 厦门人才网 | `*.xmrc.com.cn/Recruit/RecruitInfo/*` |
| 猎聘 | `*.liepin.com/job/*`、`*.liepin.com/lptjob/*` |

## 安装

1. 打开 `chrome://extensions`，开启右上角「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本目录 `job-jd-assistant`。
3. 打开上述任一职位页，右下角出现「AI 岗位助手」即安装成功。

## 使用

- 点击右下角「AI 岗位助手」：提取当前岗位并切到对话视图。
- 快捷键 `Alt+Shift+S`（或点击工具栏图标）：提取并自动复制 JSON。
- 面板顶部按钮：`JD / 对话` 切换视图、`查` 查询企业年报、齿轮打开设置页。
- 面板底部：`复制 Markdown`、`复制 JSON`。
- 首次进入对话会有一条引导消息；换岗位后对话上下文自动清空。

### 设置项

在扩展选项页填写：

| 设置 | 说明 |
| --- | --- |
| DeepSeek API Key | 必填，AI 对话使用 |
| 企查查 API Key | 可选，启用企业年报工具 |
| Base URL | 默认 `https://api.deepseek.com/v1`，仅允许 https |
| 允许自定义 API 域名 | 默认只允许 `api.deepseek.com`，第三方网关需显式勾选 |
| 模型 | 默认 `deepseek-flash`，支持 `deepseek:` 前缀写法 |
| 思考模式 | 默认开启；端点不支持时会自动降级重试 |
| 自定义提示词 | 替换默认「回答要求」，岗位与简历仍自动附带 |
| 我的简历 | 纯文本，最多发送 4000 字 |

密钥仅保存在本机 `chrome.storage.local`，请求只发往 DeepSeek 与企查查。

## 目录结构

```
job-jd-assistant/
├── manifest.json          # MV3 清单，指向 dist/
├── package.json           # build / test 脚本，无运行时依赖
├── scripts/
│   └── build.mjs          # npx esbuild 打包脚本
├── src/
│   ├── shared/            # protocol / dom / settings / markdown / clipboard
│   ├── content/
│   │   ├── index.js       # 内容脚本入口：挂载、路由监听、消息响应
│   │   ├── extract.js     # 与站点无关的提取主流程
│   │   ├── state.js       # 运行时单例状态
│   │   ├── sites/         # 站点适配器：base + boss / zhilian / xmrc / liepin
│   │   └── ui/            # styles / panel / chat
│   ├── background/        # index / sse / ai / tools
│   ├── page-hook/         # 主世界脚本，截获页面接口里的明文薪资
│   └── options/           # 设置页
├── test/                  # node:test 单元测试
└── dist/                  # 构建产物，扩展实际加载
```

## 开发

### 构建

```powershell
npm run build
```

通过 `npx esbuild@0.28.2` 打包，不安装本地依赖。首次在无缓存环境执行时会联网下载一次，之后可离线。产物输出到 `dist/`，改完代码重新构建后在扩展页点「重新加载」。

构建失败时不会清空 `dist/`，上一份可用产物仍保留。

### 测试

```powershell
npm test
```

使用 Node 自带 `node:test`，共 29 个用例，覆盖：

- 文本清洗 `clean`
- 元信息解析 `parseMeta`、公司信息分类 `parseCompanyInfo`
- 薪资私有区字符还原 `resolveSalary`
- 四站点的职位 ID、规范链接、页面签名
- 各站点元信息分类与标签合并
- 域名路由与后缀边界

测试只覆盖纯逻辑，不依赖真实浏览器，也不会自动运行。

## 技术说明

- Manifest V3，`content_scripts` 在 `document_idle` 注入；`page-hook` 以 `world: "MAIN"` 在 `document_start` 运行。
- 内容脚本通过长连接 `ai-chat` 把请求交给 background，由 background 直接请求模型，绕过页面 CORS，并把 SSE 增量回传。
- 超时控制：响应头 30 秒、整轮 180 秒、企查查 15 秒。
- 兼容端点返回 400 时，自动去掉 `thinking` 与 `tools` 参数重试一次。
- BOSS 薪资明文由 `page-hook` 写入 `<html data-bz-salary>`，内容脚本按岗位 ID / 标题匹配还原。

## 常见问题

- 字段为空：页面可能未加载完，或站点已改版。改版时优先修改 `src/content/sites/<站点>.js` 里的 `SELECTORS`，然后重新构建。
- 提示「扩展已更新，请刷新页面」：扩展重新加载后，原页面里的内容脚本已失效，刷新页面即可。
- AI 请求失败：先在设置页确认 Key、Base URL 与「允许自定义 API 域名」是否正确。
- 厦门人才网城市为空：城市片段需包含「市 / 区 / 县」，否则会归入标签，这是既有提取规则。

## 许可证

[MIT](LICENSE)
