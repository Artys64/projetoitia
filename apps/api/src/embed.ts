import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { isPublicInstallation, type PublicInstallation } from '@support-hub/contracts'
export type Installation = PublicInstallation & { active: boolean }
export const demoInstallations: Installation[] = [
  { installationId: 'inst_demo_a', companyId: 'company_a', name: 'Aurora Studio', greeting: 'Olá! Bem-vindo à Aurora. Estamos aqui para ajudar você a dar vida às suas ideias.', color: '#284e78', active: true, allowedOrigins: ['http://localhost:4174'] },
  { installationId: 'inst_demo_b', companyId: 'company_b', name: 'Jardim & Casa', greeting: 'Que bom ter você aqui! Encontre ajuda para deixar sua casa mais verde.', color: '#32644d', active: true, allowedOrigins: ['http://localhost:4174'] },
  { installationId: 'inst_disabled', companyId: 'company_disabled', name: 'Desativada', greeting: 'Instalação desativada.', color: '#284e78', active: false, allowedOrigins: ['http://localhost:4174'] },
]
export type EmbedOptions = { installations?: Installation[]; production?: boolean; loaderDir?: string; widgetDir?: string }
export function registerEmbed(app: FastifyInstance, options: EmbedOptions = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production'
  // No local fixture is implicitly authorized on a production server.
  const installations = options.installations ?? (production ? [] : demoInstallations)
  const seen = new Set<string>()
  for (const installation of installations) {
    if (!isPublicInstallation(installation, !production) || typeof installation.active !== 'boolean' || seen.has(installation.installationId)) throw new Error('Configuração de instalação inválida')
    seen.add(installation.installationId)
  }
  const loaderDir = options.loaderDir ?? fileURLToPath(new URL('../../loader/dist/', import.meta.url))
  const widgetDir = options.widgetDir ?? fileURLToPath(new URL('../../widget/dist/', import.meta.url))
  for (const filename of ['loader.js', 'loader.css']) {
    app.get(`/${filename}`, async (_request, reply) => {
      reply.header('Cache-Control', 'public, max-age=0, must-revalidate').header('X-Content-Type-Options', 'nosniff')
      try {
        const body = await readFile(`${loaderDir}/${filename}`)
        return reply.type(filename.endsWith('.js') ? 'application/javascript' : 'text/css').send(body)
      } catch { return reply.code(503).header('Cache-Control', 'no-store').send({ error: 'Recursos indisponíveis. Execute o build.' }) }
    })
  }
  app.get<{ Params: { filename: string } }>('/assets/:filename', async (request, reply) => {
    const { filename } = request.params
    if (!/^index-[A-Z0-9]{8}\.(js|css)$/.test(filename)) return reply.code(404).send({ error: 'Recurso não encontrado.' })
    try {
      const body = await readFile(`${widgetDir}/assets/${filename}`)
      return reply.header('Cache-Control', 'public, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff').type(filename.endsWith('.js') ? 'application/javascript' : 'text/css').send(body)
    } catch { return reply.code(404).send({ error: 'Recurso não encontrado.' }) }
  })
  app.get<{ Params: { installationId: string } }>('/embed/:installationId', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Content-Security-Policy', "frame-ancestors 'none'").header('X-Content-Type-Options', 'nosniff')
    const installation = installations.find(item => item.installationId === request.params.installationId)
    if (!installation) return reply.code(404).send({ error: 'Instalação não encontrada.' })
    if (!installation.active) return reply.code(403).send({ error: 'Instalação desativada.' })
    try {
      const template = await readFile(`${widgetDir}/index.html`, 'utf8')
      // Pick public fields explicitly: future secrets added to server fixtures cannot leak.
      const { installationId, companyId, name, greeting, color, allowedOrigins } = installation
      const config: PublicInstallation = { installationId, companyId, name, greeting, color, allowedOrigins }
      const json = JSON.stringify(config).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
      const nonce = randomBytes(18).toString('base64')
      const html = template.replaceAll('__NONCE__', nonce).replace('__COLOR__', color).replace('__SUPPORT_HUB_CONFIG__', () => json)
      reply.header('Content-Security-Policy', `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; frame-ancestors ${allowedOrigins.join(' ')}; base-uri 'none'; form-action 'none'`)
      return reply.type('text/html; charset=utf-8').send(html)
    } catch { return reply.code(503).send({ error: 'Widget indisponível. Execute o build.' }) }
  })
}
