// 面板样式：挂在 Shadow DOM 内，避免与宿主页面样式互相影响。
export const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap {
      position: fixed; right: 20px; bottom: 96px; z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      font-size: 13px; color: #1f2328; text-align: left;
    }
    .trigger {
      display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 16px;
      border: none; border-radius: 20px; background: #00a6a7; color: #fff;
      font-size: 13px; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 166, 167, .35);
      transition: transform .15s, box-shadow .15s;
    }
    .trigger:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0, 166, 167, .45); }
    .trigger[disabled] { opacity: .65; cursor: default; transform: none; }
    .panel {
      position: absolute; right: 0; bottom: 52px; width: min(400px, calc(100vw - 40px));
      height: min(680px, calc(100vh - 170px));
      display: flex; flex-direction: column; background: #fff;
      border: 1px solid #e5e7eb; border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, .16); overflow: hidden;
    }
    .panel[hidden] { display: none; }
    .head {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px; border-bottom: 1px solid #f0f1f2;
    }
    .head h2 { margin: 0; flex: 1; min-width: 0; font-size: 15px; line-height: 20px; font-weight: 600; word-break: break-all; }
    .head-actions { flex: none; display: flex; align-items: center; gap: 4px; }
    .close,
    .gear {
      flex: none; display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; padding: 0; margin: 0; border: none; border-radius: 6px;
      background: none; color: #585858; font-size: 13px; font-weight: 600; line-height: 1;
      cursor: pointer;
    }
    .close:hover { background: #f2f4f5; color: #00a6a7; }
    .gear svg,
    .close svg { display: block; width: 18px; height: 18px; }
    /* 关闭图标的实际笔画范围较小，放大 2px 与其它图标视觉等大 */
    .close svg { width: 20px; height: 20px; }
    .body { padding: 10px 14px; overflow-y: auto; }
    .row { display: flex; gap: 8px; margin-bottom: 6px; line-height: 1.5; }
    .row b { flex: 0 0 52px; color: #6b7280; font-weight: 500; }
    .row span { flex: 1; word-break: break-word; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }
    .chip { padding: 2px 8px; border-radius: 4px; background: #f2f4f5; color: #4b5563; font-size: 12px; }
    .desc {
      margin: 10px 0 0; padding-top: 10px; border-top: 1px dashed #e5e7eb;
      white-space: pre-wrap; line-height: 1.65; word-break: break-word;
      color: #374151;
    }
    .warn { margin-top: 8px; padding: 6px 8px; border-radius: 6px; background: #fff7e6; color: #b45309; font-size: 12px; }
    .foot { display: flex; gap: 8px; padding: 10px 14px 12px; border-top: 1px solid #f0f1f2; }
    .act {
      flex: 1; height: 32px; border-radius: 6px; border: 1px solid #d7dadd;
      background: #fff; color: #1f2328; font-size: 13px; cursor: pointer;
    }
    .act.primary { background: #00a6a7; border-color: #00a6a7; color: #fff; font-weight: 600; }
    .act:hover { opacity: .88; }

    .gear:hover,
    .gear.active { background: #f2f4f5; color: #00a6a7; }
    .view { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .view[hidden] { display: none; }
    .view-job .body { flex: 1; min-height: 0; }
    .history-list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; }
    .history-item {
      display: flex; align-items: stretch; margin-bottom: 6px;
      border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; background: #fff;
    }
    .history-main {
      flex: 1; min-width: 0; padding: 8px 10px; border: none; background: none;
      font: inherit; text-align: left; cursor: pointer;
    }
    .history-main:hover { background: #f6f7f8; }
    .history-title {
      color: #1f2328; font-size: 13px; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .history-meta {
      margin-top: 2px; color: #9ca3af; font-size: 12px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .history-del {
      flex: none; width: 30px; border: none; background: none;
      color: #9ca3af; font-size: 16px; line-height: 1; cursor: pointer;
    }
    .history-del:hover { background: #fff1f0; color: #b91c1c; }
    .history-empty {
      padding: 28px 18px; color: #9ca3af; font-size: 12px;
      line-height: 1.7; text-align: center;
    }
    .history-empty[hidden] { display: none; }
    .thread {
      flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .msg { padding: 8px 10px; border-radius: 8px; line-height: 1.65; font-size: 13px; word-break: break-word; }
    .msg.user {
      align-self: flex-end; max-width: 88%; background: #00a6a7; color: #fff;
      white-space: pre-wrap;
    }
    .msg.bot {
      align-self: flex-start; max-width: 96%; background: #f6f7f8; color: #1f2328;
      white-space: pre-wrap;
    }
    .msg.err { background: #fff1f0; color: #b91c1c; }
    .think {
      margin-bottom: 6px; padding: 6px 8px; border-left: 2px solid #d1d5db;
      background: #fafafa; border-radius: 0 4px 4px 0; color: #6b7280;
      font-size: 12px; line-height: 1.55;
      white-space: pre-wrap;
    }
    .think[hidden] { display: none; }
    .think .tt {
      display: flex; align-items: center; gap: 4px; margin-bottom: 2px;
      color: #6b7280; font-size: 12px; font-weight: 600;
      cursor: pointer; user-select: none;
    }
    .think .tt:hover { color: #00a6a7; }
    .think .arr { flex: none; font-size: 10px; }
    .think .tb { max-height: 120px; overflow-y: auto; }
    .think.collapsed .tb { display: none; }
    .tool-note {
      margin-bottom: 6px; color: #6b7280; font-size: 12px;
      display: flex; align-items: center; gap: 4px;
    }
    .tool-note[hidden] { display: none; }
    .meta {
      display: flex; align-items: center; gap: 8px; margin-top: 6px;
      white-space: normal;
    }
    .meta[hidden] { display: none; }
    .copy {
      padding: 1px 8px; border: 1px solid #e0e2e5; border-radius: 10px;
      background: #fff; color: #6b7280; font: inherit; font-size: 12px;
      line-height: 18px; cursor: pointer;
    }
    .copy:hover { border-color: #00a6a7; color: #00a6a7; }
    .elapsed { color: #9ca3af; font-size: 12px; font-variant-numeric: tabular-nums; }
    .msg code {
      padding: 1px 4px; border-radius: 4px; background: #e9ecef;
      font-family: Consolas, Menlo, monospace; font-size: 12px;
    }
    .msg p { margin: 0 0 6px; }
    .msg p:last-child { margin-bottom: 0; }
    .msg .h { display: block; margin: 8px 0 4px; font-size: 13.5px; }
    .msg ul, .msg ol { margin: 4px 0 6px; padding-left: 20px; }
    .msg li { margin: 1px 0; }
    .msg blockquote { margin: 4px 0; padding: 2px 8px; border-left: 3px solid #d7dadd; color: #4b5563; }
    .msg hr { margin: 8px 0; border: none; border-top: 1px dashed #d7dadd; }
    .msg pre {
      margin: 6px 0; padding: 8px; border-radius: 6px; background: #eef0f2;
      overflow-x: auto; white-space: pre;
    }
    .msg pre code { padding: 0; background: none; }
    .msg a { color: #00a6a7; text-decoration: none; }
    .msg a:hover { text-decoration: underline; }
    .msg del { color: #9ca3af; }
    .msg table { margin: 6px 0; border-collapse: collapse; font-size: 12px; }
    .msg th, .msg td { padding: 3px 6px; border: 1px solid #e0e2e5; text-align: left; vertical-align: top; }
    .msg th { background: #eef0f2; font-weight: 600; }
    .quick { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 8px; }
    .qchip {
      padding: 3px 8px; border: 1px solid #e5e7eb; border-radius: 12px;
      background: #fff; color: #4b5563; font-size: 12px; cursor: pointer;
    }
    .qchip:hover { border-color: #00a6a7; color: #00a6a7; }
    .composer {
      display: flex; gap: 8px; align-items: flex-end;
      padding: 8px 14px 12px; border-top: 1px solid #f0f1f2;
    }
    .composer textarea {
      flex: 1; min-width: 0; height: 52px; padding: 8px 10px; resize: none; font: inherit;
      line-height: 18px; color: inherit; background: #fff;
      border: 1px solid #d7dadd; border-radius: 8px; outline: none;
    }
    .composer textarea:focus { border-color: #00a6a7; }
    .send {
      flex: none; width: 60px; height: 52px; padding: 0; border: none; border-radius: 8px;
      background: #00a6a7; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .send:hover { opacity: .9; }
  `;
