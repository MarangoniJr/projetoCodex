# Reembolso de Despesas

Aplicativo de despesas de viagem com acesso privado pelo celular, banco SQLite e fotos vinculadas aos cadastros.

## No celular

1. Abra o endereço publicado e entre com a mesma conta usada para acessar o site.
2. Preencha os dados do relatório e da despesa.
3. Toque em **Tirar foto** para usar a câmera traseira, ou em **Escolher imagem** para selecionar um comprovante existente. A abertura direta da câmera depende do navegador e do aparelho.
4. Confira a prévia e toque em **Salvar despesa**. Aguarde a confirmação de gravação.
5. Use **Exportar pacote do mês** para baixar o relatório e as fotos.

É necessária conexão para carregar, salvar ou exportar. Se a gravação falhar, os campos e a foto são mantidos na página para tentar novamente; não feche nem recarregue antes de salvar.

## Armazenamento

- Produção: Cloudflare D1 (SQLite) para despesas e relatório; R2 para as imagens JPEG, referenciadas pela despesa.
- A identidade autenticada pelo Sites é verificada em todas as rotas da API. Cada conta acessa somente seus próprios dados.
- Fotos são reduzidas no navegador e armazenadas com limite de 2 MB. A API não aceita uploads maiores que 3 MB incluindo JSON/base64.
- As imagens e os dados da API não são armazenados pelo service worker.
- O relatório continua sendo um conjunto de configurações por conta; a taxa de quilometragem atual é usada nos cálculos de todos os meses.

## Dados da versão anterior

No navegador em que os registros antigos foram feitos, abra o `index.html` atualizado e clique em **Baixar dados antigos deste navegador**. Esse botão aparece quando há registros locais. No site publicado, escolha **Importar dados antigos** e selecione o JSON baixado. A importação conserva os identificadores e pode ser repetida após uma falha sem duplicar despesas. Preencha novamente os dados do relatório e confira a taxa de quilometragem. Os registros antigos no navegador não são apagados.

## Desenvolvimento

Requer Node.js 22.13 ou superior (com `node:sqlite`).

```sh
npm install
npm run dev
```

O servidor local fica em `http://127.0.0.1:5173`. Dados locais são persistidos em `.local-data/expenses.sqlite`, e as imagens em `.local-data/receipts`. O usuário simulado existe apenas no desenvolvimento; o aplicativo publicado exige identidade fornecida pelo Sites.

```sh
npm test
npm run build
```

O build gera o Worker em `dist/server/index.js`. O manifesto `.openai/hosting.json` declara os vínculos de banco e arquivos. Migrações são geradas a partir de `db/schema.ts` com `npm run db:generate` e publicadas junto ao aplicativo. Não altere migrações já aplicadas.

A exportação mantém o formato anterior: um ZIP com imagens JPEG e um relatório HTML com extensão `.xls`, não um arquivo Excel nativo.
