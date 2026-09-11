import { build } from 'esbuild'
import { mkdir, writeFile, rm } from 'node:fs/promises'
await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
const result = await build({ entryPoints: ['src/index.ts'], outdir: 'dist/assets', entryNames: '[name]-[hash]', bundle: true, minify: true, format: 'esm', target: 'es2020', metafile: true })
const assets = Object.keys(result.metafile.outputs)
const js = '/' + assets.find(path => path.endsWith('.js')).replace('dist/', '')
const css = '/' + assets.find(path => path.endsWith('.css')).replace('dist/', '')
await writeFile('dist/index.html', `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Central de suporte</title><link rel="stylesheet" href="${css}"><style nonce="__NONCE__">:root{--brand:__COLOR__}</style><script type="module" src="${js}"></script></head><body><div id="app"></div><script id="support-hub-config" type="application/json" nonce="__NONCE__">__SUPPORT_HUB_CONFIG__</script></body></html>`)
