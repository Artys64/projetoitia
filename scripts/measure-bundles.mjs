import { readFile, readdir } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
const files = ['apps/loader/dist/loader.js', 'apps/loader/dist/loader.css', ...(await readdir('apps/widget/dist/assets')).map(name => `apps/widget/dist/assets/${name}`)]
for (const file of files) {
  const bytes = await readFile(file)
  const gzip = gzipSync(bytes).length
  console.log(`${file}: ${bytes.length} bytes; gzip ${gzip} bytes`)
  const limit = file.endsWith('loader.js') ? 3 * 1024 : file.endsWith('.js') ? 80 * 1024 : 20 * 1024
  if (gzip >= limit) process.exitCode = 1
}
