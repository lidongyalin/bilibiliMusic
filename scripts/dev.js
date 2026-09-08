import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * 同时起后端（8788）和 Vite 前端（5173）。
 * 前端开发走 HMR，/api 由 Vite 代理到后端；生产只跑 npm start 即可。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const children = [
  {
    name: 'server',
    cmd: process.execPath,
    args: ['--watch', resolve(root, 'server.js')],
    color: '\x1b[36m',
  },
  {
    name: 'client',
    cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'dev', '--workspace', 'client'],
    color: '\x1b[35m',
  },
];

const reset = '\x1b[0m';
let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.proc.kill('SIGTERM');
  process.exit(exitCode);
}

for (const child of children) {
  const proc = spawn(child.cmd, child.args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  child.proc = proc;

  const prefix = (line) => process.stdout.write(`${child.color}[${child.name}]${reset} ${line}`);
  proc.stdout.on('data', (buf) => {
    for (const line of buf.toString().split(/\r?\n/)) if (line) prefix(line + '\n');
  });
  proc.stderr.on('data', (buf) => {
    for (const line of buf.toString().split(/\r?\n/)) if (line) prefix(line + '\n');
  });
  proc.on('exit', (code, signal) => {
    console.log(`${child.color}[${child.name}]${reset} 已退出 (code=${code}, signal=${signal})`);
    if (!shuttingDown) shutdown(1);
  });
}

console.log('');
console.log('  开发模式已启动');
console.log('  前端(推荐打开): http://127.0.0.1:5173');
console.log('  后端 API:       http://127.0.0.1:8788');
console.log('  按 Ctrl+C 退出');
console.log('');

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
