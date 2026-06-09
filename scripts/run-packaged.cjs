'use strict';
/**
 * Launch the last `electron:pack` / `electron:build` output (Windows win-unpacked).
 * Uses process.cwd() so `npm run electron:run:release` works from the repo root.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const dir = path.join(process.cwd(), 'release', 'win-unpacked');
if (!fs.existsSync(dir)) {
  console.error('Missing release/win-unpacked. Run: npm run electron:pack');
  process.exit(1);
}

const exes = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.exe') && !/^ffmpeg\.exe$/i.test(f));
const main =
  exes.find((f) => /CLOTEX/i.test(f)) || exes.find((f) => !/^elevate\.exe$/i.test(f)) || exes[0];
if (!main) {
  console.error('No .exe found in', dir);
  process.exit(1);
}

const exePath = path.join(dir, main);
const child = spawn(exePath, [], {
  detached: true,
  stdio: 'ignore',
  cwd: dir,
  windowsHide: false,
});
child.unref();
console.log('Started:', exePath);
