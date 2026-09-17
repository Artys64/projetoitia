# Instalar o widget

Status: vigente  
Última revisão: 17/09/2026  
Responsável técnico: equipe do Support Hub

## Pré-requisitos

A instalação deve estar ativa no banco e autorizar a origem exata do site. Em
produção, tanto o site quanto a origem do Support Hub devem usar HTTPS.

Adicione o script antes de `</body>`:

```html
<script
  src="https://suporte.exemplo.com/loader.js"
  data-installation-id="minha_instalacao"
  defer
></script>
```

O loader deriva a origem do produto do próprio `src`, baixa `/loader.css` e
abre `/embed/:installationId`. Nenhuma chave de IA pertence ao snippet.

## Política de conteúdo

Quando o host usa CSP, autorize `https://suporte.exemplo.com` em `script-src`,
`frame-src` e `style-src`, ou nas variantes `*-src-elem` caso estejam definidas.
O botão usa CSS externo dentro de Shadow DOM e não exige `unsafe-inline`.

## Controlar pelo JavaScript

Registre listeners no evento `load` do script:

```html
<script>
  const loader = document.querySelector('script[data-installation-id]')

  loader.addEventListener('load', () => {
    window.SupportHub.on('error', ({ code, message }) => {
      console.error(code, message)
    })
    window.SupportHub.open()
  })

  loader.addEventListener('error', () => {
    console.error('Não foi possível carregar o Support Hub')
  })
</script>
```

Eventos não são reproduzidos para listeners tardios. Veja todos os métodos,
eventos e códigos na [API pública do loader](../reference/api-do-loader.md).

## Verificar

Confirme abertura, fechamento por botão e `Escape`, navegação, restauração de
foco, recarga do histórico e comportamento em viewport móvel. Teste também uma
origem não autorizada e uma instalação desativada.
