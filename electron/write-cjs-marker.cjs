// Creates electron-dist/package.json with {"type":"commonjs"} so Node.js
// treats the compiled Electron main process as CommonJS (not ESM),
// even though the root package.json has "type":"module".
const fs = require('fs')
const path = require('path')
const outDir = path.join(__dirname, '..', 'electron-dist')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }))
console.log('electron-dist/package.json (CommonJS marker) written')
