# Blog com Mastra.AI | NodeJS

API de blog em que os posts são escritos por IA. Você envia uma ideia, um agente ([Mastra](https://mastra.ai)) gera o título e o conteúdo em Markdown, e o post fica como rascunho até ser aprovado. A listagem pública mostra apenas os posts aprovados.

## Stack

- **Node.js 26**, que executa TypeScript nativamente (sem etapa de transpilação)
- Servidor HTTP próprio sobre `node:http` ([src/http/app.ts](src/http/app.ts)), sem framework
- **PostgreSQL 17** com `pg` e migrations via `postgrator-cli`
- **Mastra** (`@mastra/core`) para o agente redator; o modelo é configurável (Gemini por padrão)
- **Zod** para validação
- Qualidade: `oxlint`, `oxfmt`, `commitlint` (Conventional Commits) e hooks git com `lefthook`

## Estrutura

```
src/
├── index.ts               # bootstrap do servidor
├── http/
│   ├── app.ts             # roteador e servidor HTTP
│   └── auth.ts            # validação da API key (Bearer token)
├── docs/openapi.ts        # especificação OpenAPI
├── routes/
│   ├── docs.ts            # rotas /api/docs (Swagger UI) e /api/docs/json
│   └── posts.ts           # rotas /posts
├── services/posts.ts      # regras de negócio e geração via agente
├── repositories/posts.ts  # acesso ao Postgres
├── mastra/                # instância Mastra e agente post-writer
└── db/
    ├── index.ts           # pool de conexões
    └── migrations/        # migrations SQL (postgrator)
```

## Setup local

### Pré-requisitos

- Node.js 26 (há um `.nvmrc`; com nvm basta `nvm use`)
- Docker com Docker Compose (para o Postgres)
- Uma chave de API do provedor de LLM (Google AI Studio, por padrão)

### Passo a passo

```bash
npm install
npm run local:setup
```

O `local:setup` faz três coisas:

1. cria o `.env.local` a partir do `.env.example`, se ele ainda não existir;
2. sobe o Postgres via `docker compose` e aguarda o healthcheck;
3. aplica as migrations.

Depois, preencha o `.env.local` (no mínimo `GOOGLE_API_KEY` e `API_KEY`) e suba a API:

```bash
npm run dev
```

A API fica disponível em `http://localhost:8080`, recarregando a cada alteração.

### Variáveis de ambiente

| Variável            | Descrição                                                   | Padrão                                            |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `API_HOST`          | Host em que o servidor escuta                               | `localhost` (no Docker: `0.0.0.0`)                |
| `API_PORT`          | Porta do servidor                                           | `8080`                                            |
| `API_PROTOCOL`      | Usado apenas no log de inicialização                        | `http`                                            |
| `API_KEY`           | Chave exigida como Bearer token em `GET /posts?include=all` | vazio, ou seja, o acesso protegido fica bloqueado |
| `POST_WRITER_MODEL` | Modelo do agente no formato `provedor/modelo` do Mastra     | `google/gemini-2.5-flash`                         |
| `GOOGLE_API_KEY`    | Chave do Google AI Studio (modelos `google/*`)              | —                                                 |
| `GROQ_API_KEY`      | Chave da Groq, se usar um modelo `groq/*`                   | —                                                 |
| `DATABASE_URL`      | Connection string do Postgres                               | `postgres://blog:blog@localhost:5432/blog`        |

### Scripts

| Script                     | O que faz                                              |
| -------------------------- | ------------------------------------------------------ |
| `npm run dev`              | Sobe a API em modo watch, lendo o `.env.local`         |
| `npm run local:setup`      | Cria o `.env.local`, sobe o Postgres e roda migrations |
| `npm run infra:up`         | Sobe o Postgres (`docker compose up -d --wait`)        |
| `npm run infra:down`       | Derruba o Postgres (o volume de dados é mantido)       |
| `npm run migrate:up`       | Aplica todas as migrations pendentes                   |
| `npm run migrate:down`     | Reverte todas as migrations                            |
| `npm run typecheck`        | Checagem de tipos com `tsc`                            |
| `npm run lint`             | Lint com `oxlint` (`lint:fix` corrige)                 |
| `npm run format`           | Formata com `oxfmt` (`format:check` só verifica)       |
| `npm run build`            | Typecheck e build da imagem Docker                     |
| `npm run test`             | Roda unitários, integração e E2E, nessa ordem          |
| `npm run test:unit`        | Testes unitários (sem banco nem LLM)                   |
| `npm run test:integration` | Testes de integração contra o Postgres (`blog_test`)   |
| `npm run test:e2e`         | Testes E2E da API HTTP com `supertest`                 |
| `npm run test:coverage`    | Todas as suítes com relatório de cobertura             |

Os hooks do `lefthook` são instalados no `npm install`: o pre-commit roda `lint-staged`, o commit-msg valida a mensagem com `commitlint` e o pre-push roda typecheck, lint e checagem de formatação.

## Endpoints

Todas as respostas são JSON. Em caso de sucesso, o recurso vem em `data`. Em caso de erro, o corpo é `{ "message": "..." }`.

A documentação interativa (Swagger UI) fica em [`/api/docs`](http://localhost:8080/api/docs) e a especificação OpenAPI 3.1 em [`/api/docs/json`](http://localhost:8080/api/docs/json). A spec é mantida à mão em [src/docs/openapi.ts](src/docs/openapi.ts), então atualize-a junto com as rotas. Os assets da Swagger UI vêm do CDN unpkg.

### Modelo `Post`

```json
{
  "id": "V1StGXR8_Z5jdHi6B-myT",
  "title": "Título do post",
  "content": "Conteúdo em **Markdown**...",
  "published_at": "2026-11-19T12:00:00.000Z",
  "approved_at": "2026-11-19T12:00:00.000Z",
  "rejected_at": null
}
```

Um post é **rascunho** quando `approved_at` e `rejected_at` estão nulos. Aprovar e reprovar alternam o status: aprovar limpa `rejected_at` e reprovar limpa `approved_at`.

### `POST /posts/draft`

Gera um post com o agente a partir de uma ideia e o salva como rascunho.

```bash
curl -X POST http://localhost:8080/posts/draft \
  -H "Content-Type: application/json" \
  -d '{ "idea": "Como usar AbortController em Node.js" }'
```

| Status | Quando                                    |
| ------ | ----------------------------------------- |
| `201`  | Post gerado e salvo: `{ message, data }`  |
| `400`  | `idea` ausente ou vazia, ou JSON inválido |
| `502`  | Falha na geração pelo modelo              |

### `GET /posts`

Lista os posts aprovados, do mais recente para o mais antigo.

Com `?include=all`, lista todos os posts (rascunhos e reprovados também), mas exige a API key:

```bash
curl http://localhost:8080/posts

curl "http://localhost:8080/posts?include=all" \
  -H "Authorization: Bearer $API_KEY"
```

| Status | Quando                                                       |
| ------ | ------------------------------------------------------------ |
| `200`  | `{ data: Post[] }`                                           |
| `400`  | `include` com valor diferente de `all`                       |
| `403`  | `include=all` sem API key válida (ou `API_KEY` não definida) |

### `GET /posts/:id`

Retorna um post pelo id, independentemente do status.

| Status | Quando              |
| ------ | ------------------- |
| `200`  | `{ data: Post }`    |
| `404`  | Post não encontrado |

### `PATCH /posts/:id/approve`

Aprova o post: define `approved_at` e `published_at` como agora e limpa `rejected_at`.

```bash
curl -X PATCH http://localhost:8080/posts/<id>/approve
```

| Status | Quando                                     |
| ------ | ------------------------------------------ |
| `200`  | `{ message: "Post approved", data: Post }` |
| `404`  | Post não encontrado                        |

### `DELETE /posts/:id/reject`

Reprova o post: define `rejected_at` como agora e limpa `approved_at`. O registro **não** é apagado.

```bash
curl -X DELETE http://localhost:8080/posts/<id>/reject
```

| Status | Quando                                     |
| ------ | ------------------------------------------ |
| `200`  | `{ message: "Post rejected", data: Post }` |
| `404`  | Post não encontrado                        |

## Testes

Os testes usam o runner nativo do Node (`node --test`) e o `supertest` para as requisições HTTP. Ficam em `test/`, separados por tipo:

| Tipo       | Pasta               | O que cobre                                                                                         | Dependências externas |
| ---------- | ------------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| Unitário   | `test/unit/`        | Roteador HTTP, auth, rotas e services. Repositório, services e Mastra são mockados                  | nenhuma               |
| Integração | `test/integration/` | Repositório executando SQL de verdade                                                               | Postgres              |
| E2E        | `test/e2e/`         | Fluxo completo pela API (rascunho → aprovação → reprovação), com o LLM mockado em `mastra.getAgent` | Postgres              |

Integração e E2E leem o `.env.test` (versionado, sem segredos) e usam o banco `blog_test` no mesmo Postgres do `docker compose`. Antes dos testes, o setup global ([test/setup/database.ts](test/setup/database.ts)) cria o banco, se ainda não existir, e aplica as migrations. Por segurança, ele recusa qualquer banco cujo nome não termine em `_test`, já que os testes truncam a tabela `posts`. Essas suítes rodam com `--test-concurrency=1` porque compartilham o banco.

Os unitários usam `mock.module`, que no Node 26 ainda exige `--experimental-test-module-mocks` (já incluso no script). O aviso `ExperimentalWarning` na saída é esperado.

```bash
npm run infra:up   # Postgres precisa estar de pé para integração/E2E
npm test
```

## Build

```bash
npm run build
```

Roda o typecheck e gera a imagem `blog-ia-nodejs:latest` a partir do [Dockerfile](Dockerfile). A imagem:

- tem dois estágios sobre `node:26-alpine`: o primeiro instala só as dependências de produção (`npm ci --omit=dev --ignore-scripts`) e o segundo copia `node_modules` e `src/`;
- roda como o usuário `node`, com `NODE_ENV=production`, escutando em `0.0.0.0:8080`;
- não leva nenhum `.env` (ver [.dockerignore](.dockerignore)): as variáveis são passadas na execução.

Para testar a imagem localmente contra o Postgres do compose:

```bash
docker run --rm -p 8080:8080 \
  -e DATABASE_URL=postgres://blog:blog@host.docker.internal:5432/blog \
  -e GOOGLE_API_KEY=... \
  -e API_KEY=... \
  blog-ia-nodejs:latest
```

## Publicação para produção

1. **Gere a imagem** com uma tag de versão, além da `latest`:

   ```bash
   npm run build
   docker tag blog-ia-nodejs:latest <registry>/blog-ia-nodejs:<versao>
   ```

2. **Envie para o registry** usado pela infraestrutura (Docker Hub, GHCR, ECR, Artifact Registry etc.):

   ```bash
   docker login <registry>
   docker push <registry>/blog-ia-nodejs:<versao>
   ```

3. **Rode as migrations no banco de produção** antes de subir a nova versão. O `postgrator-cli` é dependência de desenvolvimento e não está na imagem, então rode a partir de uma máquina com o projeto instalado. Quando `DATABASE_URL` está definida, o `.env.local` é ignorado:

   ```bash
   DATABASE_URL=postgres://<user>:<senha>@<host>:5432/<db> npm run migrate:up
   ```

4. **Faça o deploy do container** no ambiente de produção, expondo a porta `8080` e definindo as variáveis:
   - `DATABASE_URL`
   - `API_KEY` (um valor longo e aleatório, por exemplo `openssl rand -hex 32`)
   - `POST_WRITER_MODEL` e a chave do provedor correspondente (`GOOGLE_API_KEY` ou `GROQ_API_KEY`)

   `API_HOST`, `API_PORT` e `NODE_ENV` já vêm definidos na imagem.

## Contribuindo

Os commits seguem [Conventional Commits](https://www.conventionalcommits.org/) e são validados pelo `commitlint`, por exemplo `feat: adiciona rota de busca de posts`.
