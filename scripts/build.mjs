// 构建脚本：把 src/ 下的模块分别打包成扩展可直接加载的 dist/ 文件。
// 不安装本地依赖，通过 npx 调用固定版本的 esbuild（首次联网下载后会进 npm 缓存）。
import { spawnSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist');
const ESBUILD = 'esbuild@0.28.2';

const ENTRIES = [
  ['src/content/index.js', 'content.js'],
  ['src/background/index.js', 'background.js'],
  ['src/page-hook/index.js', 'page-hook.js'],
  ['src/options/index.js', 'options.js']
];

// 路径含空格时补引号，避免 shell 拆参
function quoteArg(value) {
  const text = String(value);
  return /[\s"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function run(args) {
  // 整条命令以字符串交给 shell：Windows 下 npx 是 .cmd，必须经由 cmd.exe 启动
  const command = ['npx', '--yes', ESBUILD, ...args].map(quoteArg).join(' ');
  const result = spawnSync(command, {
    cwd: root,
    stdio: 'inherit',
    shell: true
  });
  if (result.error) {
    console.error(`无法启动 npx：${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

// 不清空 dist：构建失败时仍保留上一份可用的产物
await mkdir(outdir, { recursive: true });

for (const [entry, outfile] of ENTRIES) {
  run([
    entry,
    '--bundle',
    '--format=iife',
    '--target=chrome111',
    '--charset=utf8',
    '--legal-comments=none',
    `--outfile=dist/${outfile}`
  ]);
  console.log(`built ${entry} -> dist/${outfile}`);
}

await cp(path.join(root, 'src/options/index.html'), path.join(outdir, 'options.html'));
console.log('built src/options/index.html -> dist/options.html');
