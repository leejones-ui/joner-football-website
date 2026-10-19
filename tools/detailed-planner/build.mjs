// Builds the detailed session planner into public/jfp-planner/detailed/.
//   cd tools/detailed-planner && npm install && node build.mjs
// The output is committed, so the site build does not need these dependencies.
import { build } from 'esbuild'
import { mkdirSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '../../public/jfp-planner/detailed')
rmSync(path.join(OUT, 'app.js'), { force: true }); rmSync(path.join(OUT, 'app.css'), { force: true })
mkdirSync(OUT, { recursive: true })
await build({
  entryPoints: [path.join(HERE, 'src/main.jsx')], bundle: true, minify: true, format: 'iife', target: ['es2020', 'safari14'],
  outfile: path.join(OUT, 'app.js'), loader: { '.js': 'jsx', '.png': 'file' }, jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', logLevel: 'info',
})
const size = (f) => (statSync(path.join(OUT, f)).size / 1024).toFixed(0)
console.log(`app.js ${size('app.js')} KB, app.css ${size('app.css')} KB`)

// Page shell, with a content hash on the bundle so a new build is never served stale.
const v = createHash('sha1').update(readFileSync(path.join(OUT, 'app.js'))).update(readFileSync(path.join(OUT, 'app.css'))).digest('hex').slice(0, 8)
writeFileSync(path.join(OUT, '../detailed.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Detailed session planner | JFP</title>
<link rel="stylesheet" href="/jfp-planner/detailed/app.css?v=${v}">
</head>
<body>
<div id="root"><p style="font-family:system-ui;color:#8fa0af;text-align:center;margin-top:30vh">Opening the planner...</p></div>
<script src="/jfp-planner/detailed/app.js?v=${v}"></script>
</body>
</html>
`)
