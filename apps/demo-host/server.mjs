import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
const publicDir = new URL('./public/', import.meta.url)
const paths = new Map([['/', 'index.html'], ['/a.html', 'a.html'], ['/b.html', 'b.html'], ['/without.html', 'without.html'], ['/host.js', 'host.js'], ['/host.css', 'host.css']])
createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost:4174').pathname
  const file = paths.get(pathname)
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' http://localhost:3000; style-src 'self' http://localhost:3000; frame-src http://localhost:3000; object-src 'none'; base-uri 'none'; form-action 'self'")
  res.setHeader('Cache-Control', 'no-store')
  if (!file) { res.writeHead(404); res.end('Página não encontrada'); return }
  try {
    const content = await readFile(new URL(file, publicDir))
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8')
    res.end(content)
  } catch { res.writeHead(500); res.end('Falha ao carregar demonstração') }
}).listen(4174, '0.0.0.0', () => console.log('Demonstração: http://localhost:4174'))
