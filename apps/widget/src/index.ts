import { readInstallationConfig } from './config'
import { mountWidget } from './widget'
import './styles.css'

const config = readInstallationConfig(document)
const app = document.getElementById('app')

if (!app) {
  throw new Error('Elemento de montagem do widget não encontrado')
}

mountWidget(app, config, window)
