# Blog com Mastra.AI | NodeJS

API de blog em que os posts são escritos por IA. Você envia uma ideia, um agente ([Mastra](https://mastra.ai)) gera o título e o conteúdo em Markdown, e o post fica como rascunho até ser aprovado. A listagem pública mostra apenas os posts aprovados.

## Stack

- **Node.js 26**, que executa TypeScript nativamente (sem etapa de transpilação)
- Servidor HTTP próprio sobre `node:http` ([src/http/app.ts](src/http/app.ts)), sem framework
- **PostgreSQL 17** com `pg` e migrations via `postgrator-cli`
- **Mastra** (`@mastra/core`) para os agentes redator, revisor, de SEO, moderador de comentários e de respostas a comentários, e para o workflow que encadeia redator, revisor e SEO; os modelos são configuráveis (Gemini por padrão)
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
│   ├── tags.ts            # rotas de tags
│   ├── editorial.ts       # pautas sugeridas pela IA (/editorial/ideas)
│   └── feed.ts            # feed RSS (/feed.xml)
├── services/              # regras de negócio (posts com geração via agente, comentários, curtidas, tags, feed)
├── repositories/          # acesso ao Postgres (posts, post_reviews, comments, likes, tags)
├── utils/
│   ├── slugify.ts         # gera slugs ASCII (ex.: "Node.js" -> "node-js")
│   ├── reading-time.ts    # estimativa de tempo de leitura (200 palavras/min)
│   ├── truncate.ts        # corta texto no limite com reticências
│   └── seo.ts             # limites de summary e meta_description
├── mastra/
│   ├── index.ts           # instância Mastra (registra agentes e workflows)
│   ├── agents/            # post-writer, post-reviewer, post-seo, comment-moderator, comment-replier e editorial-planner
│   ├── tools/             # tools do editorial-planner (posts populares, tags e busca)
│   └── workflows/         # post-drafting: escrever → revisar → reescrever → SEO
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

| Variável                        | Descrição                                                           | Padrão                                            |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| `API_HOST`                      | Host em que o servidor escuta                                       | `localhost` (no Docker: `0.0.0.0`)                |
| `API_PORT`                      | Porta do servidor                                                   | `8080`                                            |
| `API_PROTOCOL`                  | Usado apenas no log de inicialização                                | `http`                                            |
| `API_KEY`                       | Bearer token das rotas administrativas (ver Endpoints)              | vazio, ou seja, o acesso protegido fica bloqueado |
| `SITE_URL`                      | URL pública do blog, usada nos links do RSS                         | `API_PROTOCOL://API_HOST:API_PORT`                |
| `TRUST_PROXY`                   | `true` para o rate limiting usar o IP do `X-Forwarded-For`          | `false`, ou seja, usa o IP da conexão             |
| `POST_WRITER_MODEL`             | Modelo do agente no formato `provedor/modelo` do Mastra             | `google/gemini-2.5-flash`                         |
| `COMMENT_MODERATOR_MODEL`       | Modelo do agente moderador de comentários                           | `google/gemini-2.5-flash`                         |
| `COMMENT_MODERATION_TIMEOUT_MS` | Tempo máximo da moderação; ao estourar, o comentário fica pendente  | `10000`                                           |
| `COMMENT_REPLIER_MODEL`         | Modelo do agente que responde comentários                           | `google/gemini-2.5-flash`                         |
| `COMMENT_REPLY_TIMEOUT_MS`      | Tempo máximo da resposta; ao estourar, a rota responde `502`        | `20000`                                           |
| `POST_REVIEWER_MODEL`           | Modelo do agente revisor de rascunhos                               | `google/gemini-2.5-flash`                         |
| `POST_REVIEW_MIN_SCORE`         | Nota mínima (0 a 10) para o rascunho não ser reescrito              | `7`                                               |
| `POST_REVIEW_MAX_ATTEMPTS`      | Máximo de versões escritas por rascunho                             | `3`                                               |
| `POST_REVIEW_TIMEOUT_MS`        | Tempo máximo de cada revisão; ao estourar, salva sem ela            | `30000`                                           |
| `POST_SEO_MODEL`                | Modelo do agente de SEO (resumo, meta description, slug e tags)     | `google/gemini-2.5-flash`                         |
| `POST_SEO_TIMEOUT_MS`           | Tempo máximo da geração de SEO; ao estourar, salva sem os metadados | `20000`                                           |
| `EDITORIAL_PLANNER_MODEL`       | Modelo do agente editor de pauta                                    | `google/gemini-2.5-flash`                         |
| `EDITORIAL_IDEAS_TIMEOUT_MS`    | Tempo máximo da geração de pautas; ao estourar, responde `502`      | `60000`                                           |
| `GOOGLE_API_KEY`                | Chave do Google AI Studio (modelos `google/*`)                      | —                                                 |
| `GROQ_API_KEY`                  | Chave da Groq, se usar um modelo `groq/*`                           | —                                                 |
| `DATABASE_URL`                  | Connection string do Postgres                                       | `postgres://blog:blog@localhost:5432/blog`        |

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

As rotas administrativas (`POST /posts/draft`, `GET /posts/:id/review`, `PUT /posts/:id`, `PATCH /posts/:id/approve`, `DELETE /posts/:id/reject`, `GET /posts?include=all`, `GET /comments`, `PATCH /comments/:id/approve`, `POST /comments/:id/reply`, `DELETE /comments/:id`, `PUT /posts/:id/tags`, `DELETE /tags/:slug` e `POST /editorial/ideas`) exigem o header `Authorization: Bearer $API_KEY`. Sem ele, com uma chave errada ou com a `API_KEY` não definida, respondem `403`.

As rotas públicas de escrita têm rate limiting em memória, por IP: `POST /posts/:id/comments` aceita 5 requisições por minuto, e `POST`/`DELETE /posts/:id/likes` dividem uma cota de 30 por minuto. As respostas trazem os headers `RateLimit-Limit`, `RateLimit-Remaining` e `RateLimit-Reset`. Ao estourar a cota, a rota responde `429 { message: "Too Many Requests" }` com `Retry-After` (em segundos). Atrás de um proxy reverso, defina `TRUST_PROXY=true` para que o IP venha do `X-Forwarded-For`; sem isso, o header é ignorado, porque o cliente poderia forjá-lo. Como os contadores ficam na memória, cada instância da API tem os seus, e um restart zera todos.

A documentação interativa (Swagger UI) fica em [`/api/docs`](http://localhost:8080/api/docs) e a especificação OpenAPI 3.1 em [`/api/docs/json`](http://localhost:8080/api/docs/json). A spec é mantida à mão em [src/docs/openapi.ts](src/docs/openapi.ts), então atualize-a junto com as rotas. Os assets da Swagger UI vêm do CDN unpkg.

### Modelo `Post`

```json
{
  "id": "V1StGXR8_Z5jdHi6B-myT",
  "slug": "titulo-do-post",
  "title": "Título do post",
  "content": "Conteúdo em **Markdown**...",
  "summary": "Como processar arquivos grandes sem estourar a memória.",
  "meta_description": "Aprenda a usar streams no Node.js.",
  "reading_time_minutes": 4,
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

`summary` e `meta_description` são gerados pelo agente de SEO na criação do rascunho e ficam `null` nos posts antigos ou quando o agente falha.

O `slug` é único e gerado do título (ou sugerido pelo agente de SEO, ver `POST /posts/draft`). Títulos repetidos ganham sufixo (`-2`, `-3`...) e, quando o título não tem letras nem dígitos, o slug vira `post`. O `reading_time_minutes` é estimado a 200 palavras por minuto, com mínimo de 1. Os dois são gravados ao criar o post e recalculados ao editar.

`likes_count`, `comments_count` e `tags` são calculados a cada consulta. `comments_count` conta apenas os comentários aprovados (incluindo as respostas da IA já aprovadas), e `tags` vem ordenado pelo nome.

Um post é **rascunho** quando `approved_at` e `rejected_at` estão nulos. Aprovar e reprovar alternam o status: aprovar limpa `rejected_at` e reprovar limpa `approved_at`.

### `POST /posts/draft`

Gera um post a partir de uma ideia e o salva como rascunho. A geração é o workflow Mastra `post-drafting` ([src/mastra/workflows/post-drafting.ts](src/mastra/workflows/post-drafting.ts)):

1. O agente `post-writer` escreve o post.
2. O agente `post-reviewer` dá uma nota de 0 a 10 e lista `issues` e `suggestions`.
3. Abaixo de `POST_REVIEW_MIN_SCORE`, o redator reescreve com esse feedback e o revisor avalia de novo, até `POST_REVIEW_MAX_ATTEMPTS` versões.
4. O agente `post-seo` gera, para a versão final, `summary` (até 300 caracteres), `meta_description` (até 160), uma sugestão de `slug` e até 5 tags. O prompt leva as tags já cadastradas para o agente reaproveitá-las em vez de criar sinônimos.

O post, todas as revisões e as tags sugeridas são gravados juntos, numa transação. O slug da IA passa pelo mesmo `slugify` e pela mesma checagem de colisão que o título passaria. Se o agente de SEO falhar ou estourar `POST_SEO_TIMEOUT_MS`, o rascunho é salvo com o slug do título, sem tags e com `summary`/`meta_description` nulos; o admin pode ajustar as tags com `PUT /posts/:id/tags` e os metadados com `PUT /posts/:id`. A resposta traz a última revisão em `data.review`, e o histórico completo fica em `GET /posts/:id/review`. Como podem ser vários ciclos de LLM, a requisição demora mais que uma geração simples. Se o revisor falhar ou estourar `POST_REVIEW_TIMEOUT_MS`, o último rascunho é salvo sem essa revisão (`review` pode ser `null`). Se o redator falhar, nada é gravado.

```bash
curl -X POST http://localhost:8080/posts/draft \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "idea": "Como usar AbortController em Node.js" }'
```

| Status | Quando                                                      |
| ------ | ----------------------------------------------------------- |
| `201`  | Post gerado e salvo: `{ message, data }`, com `data.review` |
| `400`  | `idea` ausente ou vazia, ou JSON inválido                   |
| `403`  | API key ausente ou inválida                                 |
| `502`  | Falha na geração pelo modelo redator                        |

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

### `GET /posts/:id/review`

Histórico das revisões IA do rascunho, para o admin consultar antes de aprovar. Cada item tem `attempt` (1 é a primeira versão), `score` (0 a 10), `issues`, `suggestions` e `created_at`. `latest` é a revisão final, ou `null` se o revisor nunca respondeu. Requer API key.

| Status | Quando                          |
| ------ | ------------------------------- |
| `200`  | `{ data: { latest, history } }` |
| `403`  | API key ausente ou inválida     |
| `404`  | Post não encontrado             |

### `GET /posts/slug/:slug`

URL pública do post: só retorna posts **publicados**. Rascunhos e reprovados respondem `404`.

```bash
curl http://localhost:8080/posts/slug/titulo-do-post
```

| Status | Quando                              |
| ------ | ----------------------------------- |
| `200`  | `{ data: Post }`                    |
| `400`  | Slug em formato inválido            |
| `404`  | Nenhum post publicado com esse slug |

### `PUT /posts/:id`

Edita o título e o conteúdo de um post ainda **não aprovado** (rascunho ou reprovado). Os dois campos são obrigatórios. `summary` (até 300 caracteres) e `meta_description` (até 160) são opcionais: ausentes, mantêm o valor atual; `null` ou texto vazio limpam o campo. O `reading_time_minutes` é recalculado e, se o título mudou, o `slug` é regerado, o que é seguro porque o post ainda não tem URL pública. Depois de aprovado, o post não pode mais ser editado.

```bash
curl -X PUT http://localhost:8080/posts/<id> \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "title": "Novo título", "content": "## Conteúdo revisado" }'
```

| Status | Quando                                                        |
| ------ | ------------------------------------------------------------- |
| `200`  | `{ message: "Post updated", data: Post }`                     |
| `400`  | `title` (1 a 200 caracteres) ou `content` ausente ou inválido |
| `403`  | API key ausente ou inválida                                   |
| `404`  | Post não encontrado                                           |
| `409`  | Post já aprovado                                              |

### `GET /feed.xml`

Feed RSS 2.0 com os 20 posts aprovados mais recentes. Cada item aponta para `SITE_URL/posts/slug/<slug>`, e a descrição é o `summary` do post ou, sem ele, um trecho do conteúdo sem a marcação Markdown.

```bash
curl http://localhost:8080/feed.xml
```

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
  "moderation_categories": [],
  "parent_id": null,
  "author_type": "reader",
  "created_at": "2026-11-19T12:00:00.000Z"
}
```

`status` é `pending`, `approved` ou `rejected`, e só os aprovados aparecem publicamente. `moderation_reason` e `moderation_categories` (`spam`, `toxic`, `off-topic`, `harassment`, `self-promotion`, `other`) trazem a justificativa do moderador IA quando ele reprova ou manda para revisão. Aprovar manualmente limpa os dois campos. Comentários só existem em posts aprovados: para rascunhos, reprovados ou ids inexistentes, as rotas públicas respondem `404`. Apagar um post apaga os seus comentários.

`parent_id` aponta para o comentário respondido (`null` no primeiro nível) e `author_type` é `reader` para leitores ou `ai` para as respostas do agente `comment-replier` (ver `POST /comments/:id/reply`). As listagens são planas, em ordem cronológica: o cliente monta as threads por `parent_id`. Apagar um comentário apaga a sua resposta.

### `POST /posts/:id/comments`

Comenta um post aprovado. `author_name` aceita de 1 a 80 caracteres e `content` de 1 a 2000.

Antes de gravar, o agente `comment-moderator` avalia o comentário junto com o título e o começo do post, e devolve um veredito:

| Veredito  | `status`   | Mensagem do `201`             |
| --------- | ---------- | ----------------------------- |
| `approve` | `approved` | `Comment published`           |
| `reject`  | `rejected` | `Comment rejected`            |
| `review`  | `pending`  | `Comment awaiting moderation` |

Se o modelo falhar, devolver algo fora do schema ou passar de `COMMENT_MODERATION_TIMEOUT_MS`, o comentário fica `pending` e entra na fila de `GET /comments`. A IA nunca aprova nem bloqueia nada por falha.

```bash
curl -X POST http://localhost:8080/posts/<id>/comments   -H "Content-Type: application/json"   -d '{ "author_name": "Ana", "content": "Ótimo post!" }'
```

| Status | Quando                                                     |
| ------ | ---------------------------------------------------------- |
| `201`  | `{ message, data: Comment }`, com a mensagem do veredito   |
| `400`  | Campos ausentes, vazios ou longos demais, ou JSON inválido |
| `404`  | Post não encontrado ou não aprovado                        |
| `429`  | Mais de 5 comentários por minuto vindos do mesmo IP        |

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

### `POST /comments/:id/reply`

Pede ao agente `comment-replier` um rascunho de resposta para a pergunta do leitor. O agente recebe o título e o conteúdo do post e responde **apenas com base nele**. A resposta é gravada como comentário filho (`parent_id`), com `author_type: "ai"`, autor `Autor do blog (IA)` e status `pending`. Ela não passa pelo moderador e só fica pública depois de aprovada em `PATCH /comments/:id/approve`.

Só comentários de leitores, de primeiro nível e aprovados podem ser respondidos, e cada um recebe no máximo um rascunho da IA. Para gerar de novo, apague o rascunho com `DELETE /comments/:id`.

```bash
curl -X POST http://localhost:8080/comments/<id>/reply   -H "Authorization: Bearer $API_KEY"
```

| Status | Quando                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| `201`  | `{ message: "Reply draft created", data: Comment }`                                                        |
| `403`  | API key ausente ou inválida                                                                                |
| `404`  | Comentário não encontrado                                                                                  |
| `409`  | `Comment cannot be replied` (não aprovado, é uma resposta ou post não publicado) ou `Reply already exists` |
| `422`  | `{ message: "Comment is not an answerable question", reason }`: não é pergunta ou o post não a responde    |
| `502`  | O agente falhou ou passou de `COMMENT_REPLY_TIMEOUT_MS`; nada é gravado                                    |

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
| `429`  | Mais de 30 curtidas/descurtidas por minuto vindas do mesmo IP                    |

### `DELETE /posts/:id/likes`

Remove a curtida do visitante. É idempotente: responde `200` mesmo que não houvesse curtida.

| Status | Quando                                                                      |
| ------ | --------------------------------------------------------------------------- |
| `200`  | `{ message: "Like removed", data: { post_id, liked: false, likes_count } }` |
| `400`  | `X-Visitor-Id` ausente ou inválido                                          |
| `404`  | Post não encontrado ou não aprovado                                         |
| `429`  | Mais de 30 curtidas/descurtidas por minuto vindas do mesmo IP               |

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

### `POST /editorial/ideas`

Pede ao agente `editorial-planner` sugestões de novos posts. É o primeiro agente com **tools**: em vez de receber tudo no prompt, ele consulta o blog sozinho com `getPopularPosts` (curtidas na janela e comentários), `listTags` e `searchPosts` (busca full-text, para não repetir temas já publicados). O campo `idea` de cada pauta pode ir direto para `POST /posts/draft`, e o rascunho passa pelo revisor como qualquer outro. Em `inspired_by` ficam só slugs que as tools de fato devolveram; os inventados pelo modelo são descartados. Requer API key.

O body é opcional: `count` (1 a 10, padrão `5`), `days` (1 a 365, padrão `30`) e `focus` (tema desejado, até 200 caracteres).

```bash
curl -X POST http://localhost:8080/editorial/ideas   -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json"   -d '{ "count": 3, "focus": "testes automatizados" }'
```

| Status | Quando                                                                           |
| ------ | -------------------------------------------------------------------------------- |
| `200`  | `{ data: { ideas: [{ title, idea, rationale, suggested_tags, inspired_by }] } }` |
| `400`  | `count`, `days` ou `focus` inválido                                              |
| `403`  | API key ausente ou inválida                                                      |
| `502`  | O agente falhou ou passou de `EDITORIAL_IDEAS_TIMEOUT_MS`                        |

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
