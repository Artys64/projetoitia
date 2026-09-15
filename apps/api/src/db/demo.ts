import { demoInstallations } from '../embed.js'
import { importArticles, importInstallation } from './admin.js'
import type { Database } from './database.js'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

/** Explicit demo fixtures; never import another tenant's knowledge or reset history. */
export async function prepareDemo(admin: Database) {
  const directory = new URL('../../migrations/', import.meta.url)
  const applied = (await admin.pool.query('SELECT name,checksum FROM schema_migrations')).rows
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql'))) {
    const checksum = createHash('sha256').update(await readFile(new URL(name, directory))).digest('hex')
    if (!applied.some(row => row.name === name && row.checksum === checksum)) {
      throw new Error(`Migração pendente ou alterada: ${name}. Execute npm run db -- migrate.`)
    }
  }
  for (const installation of demoInstallations) {
    await importInstallation(admin, installation, false)
    if (!installation.active) continue
    const hours = installation.companyId === 'company_a'
      ? 'de segunda a sexta-feira, das 9h às 18h'
      : 'de terça-feira a sábado, das 8h às 16h'
    await importArticles(admin, [{
      id: 'demo-horario-atendimento', companyId: installation.companyId,
      version: 1, status: 'published',
      title: `Horário de atendimento da ${installation.name}`,
      keywords: ['horário', 'atendimento', 'abre', 'funcionamento'],
      content: `Dados fictícios para demonstração. A ${installation.name} atende ${hours}, no horário de Brasília.`,
      suggestions: [],
    }])
  }
}
