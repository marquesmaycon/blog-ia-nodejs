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
│   ├── posts.ts           # rotas /posts
│   ├── comments.ts        # rotas de comentários
│   ├── likes.ts           # rotas de curtidas e posts populares
│   └── tags.ts            # rotas de tags
├── services/              # regras de negócio (posts com geração via agente, comentários, curtidas, tags)
├── repositories/          # acesso ao Postgres (posts, comments, likes, tags)
├── utils/slugify.ts       # gera slugs ASCII (ex.: "Node.js" -> "node-js")
├── mastra/                # instância Mastra e agente post-writer
└── db/
    ├── index.ts           # pool de conexões e helper withTransaction
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

| Variável            | Descrição                                               | Padrão                                            |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| `API_HOST`          | Host em que o servidor escuta                           | `localhost` (no Docker: `0.0.0.0`)                |
| `API_PORT`          | Porta do servidor                                       | `8080`                                            |
| `API_PROTOCOL`      | Usado apenas no log de inicialização                    | `http`                                            |
| `API_KEY`           | Bearer token das rotas administrativas (ver Endpoints)  | vazio, ou seja, o acesso protegido fica bloqueado |
| `POST_WRITER_MODEL` | Modelo do agente no formato `provedor/modelo` do Mastra | `google/gemini-2.5-flash`                         |
| `GOOGLE_API_KEY`    | Chave do Google AI Studio (modelos `google/*`)          | —                                                 |
| `GROQ_API_KEY`      | Chave da Groq, se usar um modelo `groq/*`               | —                                                 |
| `DATABASE_URL`      | Connection string do Postgres                           | `postgres://blog:blog@localhost:5432/blog`        |

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

Erros de validação (`400`) também trazem `errors`, com um item por problema, gerado a partir do zod:

```json
{
  "message": "Invalid request body",
  "errors": [
    { "field": "content", "message": "Too big: expected string to have <=2000 characters" }
  ]
}
```

As rotas administrativas (`POST /posts/draft`, `PATCH /posts/:id/approve`, `DELETE /posts/:id/reject`, `GET /posts?include=all`, `GET /comments`, `PATCH /comments/:id/approve`, `DELETE /comments/:id`, `PUT /posts/:id/tags` e `DELETE /tags/:slug`) exigem o header `Authorization: Bearer $API_KEY`. Sem ele, com uma chave errada ou com a `API_KEY` não definida, respondem `403`.

A documentação interativa (Swagger UI) fica em [`/api/docs`](http://localhost:8080/api/docs) e a especificação OpenAPI 3.1 em [`/api/docs/json`](http://localhost:8080/api/docs/json). A spec é mantida à mão em [src/docs/openapi.ts](src/docs/openapi.ts), então atualize-a junto com as rotas. Os assets da Swagger UI vêm do CDN unpkg.

### Modelo `Post`

```json
{
  "id": "V1StGXR8_Z5jdHi6B-myT",
  "title": "Título do post",
  "content": "Conteúdo em **Markdown**...",
  "published_at": "2026-11-19T12:00:00.000Z",
  "approved_at": "2026-11-19T12:00:00.000Z",
  "rejected_at": null,
  "likes_count": 12,
  "comments_count": 3,
  "tags": [
    { "name": "IA", "slug": "ia" },
    { "name": "Node.js", "slug": "node-js" }
  ]
}
```

`likes_count`, `comments_count` e `tags` são calculados a cada consulta. `comments_count` conta apenas os comentários aprovados, e `tags` vem ordenado pelo nome.

Um post é **rascunho** quando `approved_at` e `rejected_at` estão nulos. Aprovar e reprovar alternam o status: aprovar limpa `rejected_at` e reprovar limpa `approved_at`.

### `POST /posts/draft`

Gera um post com o agente a partir de uma ideia e o salva como rascunho.

```bash
curl -X POST http://localhost:8080/posts/draft \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "idea": "Como usar AbortController em Node.js" }'
```

| Status | Quando                                    |
| ------ | ----------------------------------------- |
| `201`  | Post gerado e salvo: `{ message, data }`  |
| `400`  | `idea` ausente ou vazia, ou JSON inválido |
| `403`  | API key ausente ou inválida               |
| `502`  | Falha na geração pelo modelo              |

### `GET /posts`

Lista os posts aprovados, do mais recente para o mais antigo, em páginas.

Com `?include=all`, lista todos os posts (rascunhos e reprovados também), mas exige a API key. Com `?tag=<slug>`, filtra pelos posts que têm a tag. Todos os parâmetros podem ser combinados, e uma tag que não existe devolve lista vazia.

- **Paginação:** `?page=` (a partir de 1, padrão 1) e `?limit=` (de 1 a 50, padrão 10). Uma página além do fim devolve `data` vazio com o `total` real.
- **Busca:** `?q=` faz busca full-text em português no título e no conteúdo (`"testes"` encontra `"teste"`) e ordena por relevância, com match no título pesando mais. Aceita sintaxe de buscador: `"frase exata"`, `-excluir` e `or`. Acentos contam: `"migracao"` não encontra `"migração"`.

```bash
curl http://localhost:8080/posts

curl "http://localhost:8080/posts?tag=node-js"

curl "http://localhost:8080/posts?q=node&page=2&limit=5"

curl "http://localhost:8080/posts?include=all" \
  -H "Authorization: Bearer $API_KEY"
```

| Status | Quando                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------- |
| `200`  | `{ data: Post[], meta: { page, limit, total } }`                                                                |
| `400`  | `include` diferente de `all`, `tag` que não é slug, `q` com mais de 200 caracteres, ou `page`/`limit` inválidos |
| `403`  | `include=all` sem API key válida (ou `API_KEY` não definida)                                                    |

### `GET /posts/:id`

Retorna um post pelo id, independentemente do status.

| Status | Quando              |
| ------ | ------------------- |
| `200`  | `{ data: Post }`    |
| `404`  | Post não encontrado |

### `PATCH /posts/:id/approve`

Aprova o post: define `approved_at` e `published_at` como agora e limpa `rejected_at`.

```bash
curl -X PATCH http://localhost:8080/posts/<id>/approve \
  -H "Authorization: Bearer $API_KEY"
```

| Status | Quando                                     |
| ------ | ------------------------------------------ |
| `200`  | `{ message: "Post approved", data: Post }` |
| `403`  | API key ausente ou inválida                |
| `404`  | Post não encontrado                        |

### `DELETE /posts/:id/reject`

Reprova o post: define `rejected_at` como agora e limpa `approved_at`. O registro **não** é apagado.

```bash
curl -X DELETE http://localhost:8080/posts/<id>/reject \
  -H "Authorization: Bearer $API_KEY"
```

| Status | Quando                                     |
| ------ | ------------------------------------------ |
| `200`  | `{ message: "Post rejected", data: Post }` |
| `403`  | API key ausente ou inválida                |
| `404`  | Post não encontrado                        |

### Modelo `Comment`

```json
{
  "id": "Uakgb_J5m9g-0JDMbcJqL",
  "post_id": "V1StGXR8_Z5jdHi6B-myT",
  "author_name": "Ana",
  "content": "Ótimo post, obrigado!",
  "status": "pending",
  "moderation_reason": null,
  "created_at": "2026-11-19T12:00:00.000Z"
}
```

`status` é `pending`, `approved` ou `rejected`. Todo comentário nasce `pending` e só aparece publicamente depois de aprovado. Comentários só existem em posts aprovados: para rascunhos, reprovados ou ids inexistentes, as rotas públicas respondem `404`. Apagar um post apaga os seus comentários.

### `POST /posts/:id/comments`

Comenta um post aprovado. `author_name` aceita de 1 a 80 caracteres e `content` de 1 a 2000.

```bash
curl -X POST http://localhost:8080/posts/<id>/comments   -H "Content-Type: application/json"   -d '{ "author_name": "Ana", "content": "Ótimo post!" }'
```

| Status | Quando                                                      |
| ------ | ----------------------------------------------------------- |
| `201`  | `{ message: "Comment awaiting moderation", data: Comment }` |
| `400`  | Campos ausentes, vazios ou longos demais, ou JSON inválido  |
| `404`  | Post não encontrado ou não aprovado                         |

### `GET /posts/:id/comments`

Lista os comentários aprovados do post, do mais antigo para o mais recente.

| Status | Quando                              |
| ------ | ----------------------------------- |
| `200`  | `{ data: Comment[] }`               |
| `404`  | Post não encontrado ou não aprovado |

### `GET /comments`

Fila de moderação: lista os comentários de todos os posts com o `status` informado (padrão `pending`), do mais antigo para o mais recente.

```bash
curl "http://localhost:8080/comments?status=pending"   -H "Authorization: Bearer $API_KEY"
```

| Status | Quando                      |
| ------ | --------------------------- |
| `200`  | `{ data: Comment[] }`       |
| `400`  | `status` inválido           |
| `403`  | API key ausente ou inválida |

### `PATCH /comments/:id/approve`

Aprova o comentário e limpa `moderation_reason`.

| Status | Quando                                           |
| ------ | ------------------------------------------------ |
| `200`  | `{ message: "Comment approved", data: Comment }` |
| `403`  | API key ausente ou inválida                      |
| `404`  | Comentário não encontrado                        |

### `DELETE /comments/:id`

Apaga o comentário definitivamente.

| Status | Quando                           |
| ------ | -------------------------------- |
| `200`  | `{ message: "Comment deleted" }` |
| `403`  | API key ausente ou inválida      |
| `404`  | Comentário não encontrado        |

### Curtidas

Não há login: o visitante é identificado pelo header `X-Visitor-Id`, um id gerado pelo cliente (ex.: um nanoid guardado no navegador) com 8 a 64 caracteres entre letras, dígitos, `_` e `-`. Cada visitante curte um post uma única vez, e só posts aprovados aceitam curtidas.

### `POST /posts/:id/likes`

```bash
curl -X POST http://localhost:8080/posts/<id>/likes   -H "X-Visitor-Id: V1StGXR8_Z5jdHi6B-myT"
```

| Status | Quando                                                                           |
| ------ | -------------------------------------------------------------------------------- |
| `201`  | `{ message: "Post liked", data: { post_id, liked: true, likes_count } }`         |
| `200`  | O visitante já tinha curtido: `{ message: "Post already liked", data: { ... } }` |
| `400`  | `X-Visitor-Id` ausente ou inválido                                               |
| `404`  | Post não encontrado ou não aprovado                                              |

### `DELETE /posts/:id/likes`

Remove a curtida do visitante. É idempotente: responde `200` mesmo que não houvesse curtida.

| Status | Quando                                                                      |
| ------ | --------------------------------------------------------------------------- |
| `200`  | `{ message: "Like removed", data: { post_id, liked: false, likes_count } }` |
| `400`  | `X-Visitor-Id` ausente ou inválido                                          |
| `404`  | Post não encontrado ou não aprovado                                         |

### `GET /posts/popular`

Ranking dos posts aprovados pelas curtidas recebidas nos últimos `days` dias (1 a 365, padrão `7`), com até `limit` posts (1 a 50, padrão `10`). Cada item é um `Post` com `recent_likes`, as curtidas dentro da janela. Posts sem curtidas na janela ficam de fora.

```bash
curl "http://localhost:8080/posts/popular?days=30&limit=5"
```

| Status | Quando                              |
| ------ | ----------------------------------- |
| `200`  | `{ data: PopularPost[] }`           |
| `400`  | `days` ou `limit` fora do intervalo |

### Tags

A identidade de uma tag é o slug gerado do nome (`"Node.js"` vira `node-js`). Nomes que geram o mesmo slug são a mesma tag, e o primeiro nome cadastrado é o que fica. O filtro `GET /posts?tag=` e o `DELETE` usam o slug.

### `PUT /posts/:id/tags`

Substitui as tags do post. As tags que ainda não existem são criadas na hora, e `{ "tags": [] }` remove todas. Funciona em qualquer status, então dá para taggear o rascunho antes de aprovar. Aceita até 10 tags, cada uma com 1 a 40 caracteres e pelo menos uma letra ou dígito. Requer API key.

```bash
curl -X PUT http://localhost:8080/posts/<id>/tags \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tags": ["Node.js", "IA"]}'
```

| Status | Quando                                           |
| ------ | ------------------------------------------------ |
| `200`  | `{ message: "Post tags updated", data: Post }`   |
| `400`  | `tags` ausente, não é lista, ou tem tag inválida |
| `403`  | API key ausente ou inválida                      |
| `404`  | Post não encontrado                              |

### `GET /tags`

Lista as tags que têm pelo menos um post aprovado. `posts_count` conta só os posts aprovados. A ordem é da tag mais usada para a menos usada e, em caso de empate, pelo nome.

| Status | Quando                                    |
| ------ | ----------------------------------------- |
| `200`  | `{ data: [{ name, slug, posts_count }] }` |

### `DELETE /tags/:slug`

Apaga a tag e a remove de todos os posts. Requer API key.

| Status | Quando                       |
| ------ | ---------------------------- |
| `200`  | `{ message: "Tag deleted" }` |
| `403`  | API key ausente ou inválida  |
| `404`  | Tag não encontrada           |

## Testes

Os testes usam o runner nativo do Node (`node --test`) e o `supertest` para as requisições HTTP. Ficam em `test/`, separados por tipo:

| Tipo       | Pasta               | O que cobre                                                                                         | Dependências externas |
| ---------- | ------------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| Unitário   | `test/unit/`        | Roteador HTTP, auth, rotas e services. Repositório, services e Mastra são mockados                  | nenhuma               |
| Integração | `test/integration/` | Repositório executando SQL de verdade                                                               | Postgres              |
| E2E        | `test/e2e/`         | Fluxo completo pela API (rascunho → aprovação → reprovação), com o LLM mockado em `mastra.getAgent` | Postgres              |

Integração e E2E leem o `.env.test` (versionado, sem segredos) e usam o banco `blog_test` no mesmo Postgres do `docker compose`. Antes dos testes, o setup global ([test/setup/database.ts](test/setup/database.ts)) cria o banco, se ainda não existir, e aplica as migrations. Por segurança, ele recusa qualquer banco cujo nome não termine em `_test`, já que os testes truncam as tabelas `posts` e `tags` (e, em cascata, as que dependem delas). Essas suítes rodam com `--test-concurrency=1` porque compartilham o banco.

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
