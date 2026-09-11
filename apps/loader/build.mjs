import { build } from 'esbuild'
import { mkdir, copyFile } from 'node:fs/promises'
await mkdir('dist', { recursive: true })
await build({ entryPoints: ['src/index.ts'], outfile: 'dist/loader.js', bundle: true, minify: true, format: 'iife', target: 'es2020' })
await copyFile('src/loader.css', 'dist/loader.css')
