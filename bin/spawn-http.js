import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = fs.openSync(path.join(__dirname, '..', 'data', 'http.log'), 'a');
const err = fs.openSync(path.join(__dirname, '..', 'data', 'http.err'), 'a');
const proc = spawn(
  'node',
  [path.join(__dirname, 'flow-api.js'), 'serve-http', '5555'],
  { detached: true, stdio: ['ignore', out, err], windowsHide: true },
);
proc.unref();
console.log('spawned pid', proc.pid);
