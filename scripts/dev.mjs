// 로컬 개발: D1 마이그레이션 적용 후 Worker(8787)와 Vite(5173)를 함께 띄운다.
import { spawn, execSync } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';

const worker = 'packages/worker';
if (!existsSync(`${worker}/.dev.vars`)) copyFileSync(`${worker}/.dev.vars.example`, `${worker}/.dev.vars`);
execSync('npx wrangler d1 migrations apply deulleotdagam-index --local', { cwd: worker, stdio: 'inherit' });

const procs = [
  spawn('npm', ['run', 'dev', '-w', '@deulleotdagam/worker'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'dev', '-w', '@deulleotdagam/web'], { stdio: 'inherit' }),
];
const stop = () => { procs.forEach(p => p.kill('SIGTERM')); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
