# Catálogo Marsom — serviço compartilhado

Este diretório contém a API pública do catálogo, o banco D1 e o armazenamento
R2 das fotos e dos vídeos. A publicação é feita por uma ação manual do GitHub.

## Configuração única

Crie no repositório `brunomarsom/brunomarsom.github.io` estes três secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CATALOGO_EDIT_KEY` — código de pelo menos 10 caracteres que a equipe digitará
  para criar, editar ou excluir

O token da Cloudflare precisa permitir editar Workers/Pages, D1 e R2 na conta.
Depois, execute a ação **Ativar Catálogo Marsom** na aba **Actions**.

O catálogo é público para consulta. O código da equipe protege todas as
alterações e nunca é incluído nos arquivos públicos.

Os comandos de remoção arquivam os registros e as mídias. Nada é apagado
permanentemente pelo catálogo público.

O fluxo cria, se ainda não existirem:

- o banco `catalogo-marsom-db`;
- o bucket `catalogo-marsom-media`;
- o projeto `catalogo-marsom-api-brunomarsom`.

As execuções seguintes são seguras e reaproveitam os mesmos recursos.
