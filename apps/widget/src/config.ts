import { isPublicInstallation, type PublicInstallation } from '@support-hub/contracts'

export function readInstallationConfig(document: Document): PublicInstallation {
  const configElement = document.getElementById('support-hub-config')
  const raw: unknown = JSON.parse(configElement?.textContent ?? 'null')

  // A API só permite origens HTTP locais fora de produção.
  if (!isPublicInstallation(raw, true)) {
    throw new Error('Configuração de instalação inválida')
  }

  return raw
}
