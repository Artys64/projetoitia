import { createServer, request } from 'node:http'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const publicDir = new URL('./public/', import.meta.url)
const defaultAdminDir = new URL('../admin/dist/', import.meta.url)
const paths = new Map([['/', 'index.html'], ['/a.html', 'a.html'], ['/b.html', 'b.html'], ['/without.html', 'without.html'], ['/host.js', 'host.js'], ['/host.css', 'host.css']])
const contentTypes = { css: 'text/css', js: 'application/javascript', html: 'text/html; charset=utf-8', svg: 'image/svg+xml', woff2: 'font/woff2' }

export function createDemoHost({ apiOrigin = 'http://localhost:3000', adminDir = defaultAdminDir } = {}) {
  return createServer(async (req, res) => {
    const incoming = new URL(req.url, 'http://localhost:4174')
    const pathname = incoming.pathname
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')

    // Preserve Origin for the API's CSRF validation. Do not proxy arbitrary destinations.
    if (pathname.startsWith('/api/admin/')) {
      const target = new URL(apiOrigin)
      target.pathname = pathname
      target.search = incoming.search
      const headers = Object.fromEntries(['content-type', 'content-length', 'cookie', 'origin', 'accept']
        .filter(name => req.headers[name] !== undefined).map(name => [name, req.headers[name]]))
      const upstream = request(target, {
        method: req.method,
        headers,
        timeout: 15_000,
      }, response => {
        res.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(res)
      })
      upstream.on('timeout', () => upstream.destroy())
      upstream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ code: 'unavailable', error: 'O serviço administrativo está indisponível. Inicie a API e tente novamente.' }))
        } else res.destroy()
      })
      req.on('aborted', () => upstream.destroy())
      req.pipe(upstream)
      return
    }

    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' http://localhost:3000; style-src 'self' http://localhost:3000; frame-src http://localhost:3000; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return
    }
    const adminPage = pathname === '/admin' || pathname === '/admin/'
    // Only generated asset filenames are exposed; source files and .env stay private.
    const adminAsset = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css|svg|woff2)$/.test(pathname)
    const file = adminPage ? 'index.html' : adminAsset ? pathname.slice(1) : paths.get(pathname)
    if (!file) { res.writeHead(404); res.end('Página não encontrada'); return }
    try {
      const content = await readFile(new URL(file, adminPage || adminAsset ? adminDir : publicDir))
      res.setHeader('Content-Type', contentTypes[file.split('.').pop()] ?? 'application/octet-stream')
      res.end(req.method === 'HEAD' ? undefined : content)
    } catch {
      res.writeHead(adminPage ? 503 : 404)
      res.end(adminPage ? 'Painel indisponível. Execute npm run build e reinicie o site local.' : 'Arquivo não encontrado')
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createDemoHost().listen(4174, '0.0.0.0', () => console.log('Demonstração: http://localhost:4174 • Administração: http://localhost:4174/admin'))
}
