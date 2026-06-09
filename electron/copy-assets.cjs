'use strict';
/**
 * Copy static assets required at Electron runtime into electron-dist/
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'electron-dist');
const cfgDir = path.join(dist, 'config');

fs.mkdirSync(cfgDir, { recursive: true });

const htmlSrc = path.join(__dirname, 'connect-error.html');
const htmlDest = path.join(dist, 'connect-error.html');
if (fs.existsSync(htmlSrc)) {
  fs.copyFileSync(htmlSrc, htmlDest);
}

const exSrc = path.join(__dirname, 'config', 'vps-connection.example.json');
const exDest = path.join(cfgDir, 'vps-connection.example.json');
if (fs.existsSync(exSrc)) {
  fs.copyFileSync(exSrc, exDest);
}
