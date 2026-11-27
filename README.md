# Blog com Mastra.AI | NodeJS

![Node.js 26](https://img.shields.io/badge/Node.js-26-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-nativo-3178C6?logo=typescript&logoColor=white)
![Mastra](https://img.shields.io/badge/Mastra-agents%20%2B%20workflows-111111)
![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

API de blog em que **seis agentes de IA ([Mastra](https://mastra.ai))** escrevem, revisam e otimizam os posts para SEO, moderam e respondem comentários e sugerem pautas a partir do que os leitores curtem. A IA faz o trabalho pesado, e um humano decide o que vai ao ar: posts e respostas geradas só ficam públicos depois de aprovados.

## Destaques

- **6 agentes com saída estruturada:** cada resposta do modelo é validada por um schema zod (`structuredOutput`), então os services recebem objetos tipados em vez de texto solto.
- **Workflow com loop de qualidade:** um workflow Mastra encadeia redator → revisor → reescrita (`dountil`) até a nota mínima, e só então gera o SEO.
- **Agente com tools:** o editor de pauta consulta o próprio banco (posts populares, tags, busca full-text) com `createTool` e descarta referências alucinadas.
- **Falha da IA nunca decide sozinha:** cada chamada tem timeout e fallback. Um comentário sem veredito fica pendente, um rascunho sem revisão é salvo mesmo assim, e nada é aprovado por erro.
- **Sem framework e sem build:** o servidor HTTP é próprio, sobre `node:http`, com rotas tipadas e params inferidos, e o TypeScript roda nativamente no Node 26.
- **Documentação que não fica para trás:** a spec OpenAPI é gerada dos mesmos schemas zod que validam as requisições, e um teste falha se alguma rota ficar sem documentação. Há testes unit, integration e e2e.

## Agentes de IA

| Agente              | O que faz                                                                                         | Onde                       | Se falhar                           |
| ------------------- | ------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------- |
| `post-writer`       | Escreve título e conteúdo em Markdown a partir de uma ideia e reescreve com o feedback do revisor | `POST /posts/draft`        | Nada é gravado (`502`)              |
| `post-reviewer`     | Dá nota de 0 a 10 e lista problemas e sugestões                                                   | `POST /posts/draft`        | O rascunho é salvo sem a revisão    |
| `post-seo`          | Gera resumo, meta description, slug e tags, reaproveitando as tags existentes                     | `POST /posts/draft`        | O rascunho é salvo sem os metadados |
| `comment-moderator` | Aprova, reprova ou manda para revisão humana, com motivo e categorias (spam, toxic...)            | `POST /posts/:id/comments` | O comentário fica `pending`         |
| `comment-replier`   | Propõe resposta a perguntas dos leitores, baseada só no conteúdo do post                          | `POST /comments/:id/reply` | Nada é gravado (`502`)              |
| `editorial-planner` | Sugere novas pautas usando tools que consultam curtidas, tags e posts já publicados               | `POST /editorial/ideas`    | A rota responde `502`               |

### Workflow de rascunho

`POST /posts/draft` roda o workflow [`post-drafting`](src/mastra/workflows/post-drafting.ts). O redator escreve, o revisor dá a nota e, abaixo do mínimo, o redator reescreve com o feedback. No fim, o agente de SEO gera os metadados, e o post, o histórico de revisões e as tags são gravados numa única transação.

```mermaid
flowchart LR
    idea([ideia]) --> write[post-writer<br/>escreve]
    write --> review[post-reviewer<br/>nota 0-10]
    review -- "nota < mínimo<br/>e tentativas < máximo" --> write
    review -- aprovado ou limite --> seo[post-seo<br/>summary, slug, tags]
    seo --> db[(transação:<br/>post + revisões + tags)]
    db --> admin{admin aprova?}
```

### O ciclo completo

Os agentes se alimentam uns dos outros: o engajamento dos leitores vira pauta, a pauta vira rascunho, e o rascunho passa pelo revisor antes de chegar ao admin.

```mermaid
flowchart TD
    readers([leitores]) -- curtidas e comentários --> planner[editorial-planner<br/>tools: getPopularPosts, listTags, searchPosts]
    planner -- ideia --> drafting[workflow post-drafting]
    drafting --> approve{admin aprova}
    approve -- publicado --> readers
    readers -- comenta --> moderator[comment-moderator]
    moderator -- aprovado --> replier[comment-replier]
    moderator -- review --> queue[fila de moderação]
    replier -- rascunho de resposta --> approve
```

Todos os agentes seguem o mesmo padrão (`mastra.getAgent(id).generate(prompt, { structuredOutput, abortSignal })`), e o modelo de cada um é trocável por variável de ambiente. Os vereditos, os timeouts e as regras de cada agente estão em [docs/agentes.md](docs/agentes.md).

## Funcionalidades

- **Posts:** rascunho → aprovação/reprovação, edição antes de aprovar, slug único, tempo de leitura e feed RSS
- **Comentários:** moderação por IA, fila de moderação para o admin e threads com as respostas da IA
- **Curtidas:** sem login (o visitante envia `X-Visitor-Id`), idempotentes, com ranking de posts populares por janela de dias
- **Tags:** filtro por tag, sugeridas pela IA e editáveis pelo admin
- **Busca e paginação:** full-text em português, com `tsvector` e índice GIN, ordenada por relevância
- **Proteção:** rotas de admin com API key e rate limiting por IP nas rotas públicas de escrita

## Stack

- **Node.js 26**, que executa TypeScript nativamente (sem etapa de transpilação)
- Servidor HTTP próprio sobre `node:http` ([src/http/app.ts](src/http/app.ts)), sem framework
- **PostgreSQL 17** com `pg` e migrations via `postgrator-cli`
- **Mastra** (`@mastra/core`) para os agentes, o workflow e as tools. Os modelos são configuráveis (Gemini por padrão; Groq também é suportado)
- **Zod** para validação de requisições, do ambiente e das saídas dos agentes, e para gerar a spec OpenAPI
- Qualidade: `oxlint`, `oxfmt`, `commitlint` (Conventional Commits) e hooks git com `lefthook`

## Arquitetura

Cada recurso segue as mesmas camadas: `routes/` valida a entrada com zod, `services/` aplica as regras e chama os agentes, e `repositories/` faz o SQL. Os tipos de domínio ficam em `domain/`, e tudo de IA fica isolado em `mastra/`.

```
src/
├── index.ts         # bootstrap: valida o ambiente e sobe o servidor
├── config/          # variáveis de ambiente tipadas com zod
├── http/            # roteador, auth por API key, erros HTTP, validação e rate limiting
├── routes/          # rotas por recurso + *.schemas.ts (zod), reutilizados pela spec
├── services/        # regras de negócio e chamadas aos agentes
├── repositories/    # acesso ao Postgres
├── domain/          # tipos de domínio (Post, Comment, Tag, PostReview)
├── mastra/
│   ├── agents/      # os 6 agentes
│   ├── workflows/   # post-drafting: escrever → revisar → reescrever → SEO
│   └── tools/       # tools do editorial-planner
├── docs/            # spec OpenAPI (paths por recurso, schemas gerados do zod)
├── db/              # pool sob demanda, transações e 10 migrations SQL
└── utils/           # slugify, tempo de leitura, truncate, limites de SEO
```

## Setup local

**Pré-requisitos:** Node.js 26 (há um `.nvmrc`), Docker com Docker Compose e uma chave de API do provedor de LLM (Google AI Studio, por padrão).

```bash
npm install
npm run local:setup   # cria o .env.local, sobe o Postgres e aplica as migrations
```

Preencha o `.env.local` (no mínimo `GOOGLE_API_KEY` e `API_KEY`) e suba a API:

```bash
npm run dev
```

A API fica em `http://localhost:8080` e recarrega a cada alteração. No boot, as variáveis de ambiente são validadas, e o processo para listando as que estiverem inválidas.

### Variáveis de ambiente

O [.env.example](.env.example) traz todas, comentadas. As principais:

| Variável                          | Descrição                                                  | Padrão                                     |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| `API_KEY`                         | Bearer token das rotas de admin; vazio bloqueia todas elas | vazio                                      |
| `DATABASE_URL`                    | Connection string do Postgres                              | `postgres://blog:blog@localhost:5432/blog` |
| `GOOGLE_API_KEY` / `GROQ_API_KEY` | Chave do provedor dos modelos `google/*` ou `groq/*`       | —                                          |
| `API_HOST` / `API_PORT`           | Endereço do servidor                                       | `localhost` / `8080`                       |
| `SITE_URL`                        | URL pública usada nos links do RSS                         | `API_PROTOCOL://API_HOST:API_PORT`         |
| `TRUST_PROXY`                     | `true` para o rate limiting usar o IP do `X-Forwarded-For` | `false`                                    |

**Modelos:** cada agente tem a sua variável no formato `provedor/modelo` do Mastra, com padrão `google/gemini-2.5-flash`: `POST_WRITER_MODEL`, `POST_REVIEWER_MODEL`, `POST_SEO_MODEL`, `COMMENT_MODERATOR_MODEL`, `COMMENT_REPLIER_MODEL` e `EDITORIAL_PLANNER_MODEL`.

**Limites da IA:**

| Variável                        | Padrão  | Ao estourar                              |
| ------------------------------- | ------- | ---------------------------------------- |
| `POST_REVIEW_MIN_SCORE`         | `7`     | Nota mínima (0 a 10) para não reescrever |
| `POST_REVIEW_MAX_ATTEMPTS`      | `3`     | Máximo de versões escritas por rascunho  |
| `POST_REVIEW_TIMEOUT_MS`        | `30000` | Salva o rascunho sem a revisão           |
| `POST_SEO_TIMEOUT_MS`           | `20000` | Salva o rascunho sem os metadados        |
| `COMMENT_MODERATION_TIMEOUT_MS` | `10000` | O comentário fica pendente               |
| `COMMENT_REPLY_TIMEOUT_MS`      | `20000` | A rota responde `502`                    |
| `EDITORIAL_IDEAS_TIMEOUT_MS`    | `60000` | A rota responde `502`                    |

### Scripts

| Script                                                | O que faz                                                 |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `npm run dev`                                         | Sobe a API em modo watch, lendo o `.env.local`            |
| `npm run local:setup`                                 | Cria o `.env.local`, sobe o Postgres e roda as migrations |
| `npm run infra:up` / `infra:down`                     | Sobe ou derruba o Postgres (o volume de dados é mantido)  |
| `npm run migrate:up` / `migrate:down`                 | Aplica as migrations pendentes ou reverte todas           |
| `npm run typecheck` / `lint` / `format`               | `tsc`, `oxlint` e `oxfmt` (`lint:fix` e `format:check`)   |
| `npm test`                                            | Roda unitários, integração e E2E, nessa ordem             |
| `npm run test:unit` / `test:integration` / `test:e2e` | Cada suíte separadamente                                  |
| `npm run test:coverage`                               | Todas as suítes com relatório de cobertura                |
| `npm run build`                                       | Typecheck e build da imagem Docker                        |

Os hooks do `lefthook` são instalados no `npm install`: o pre-commit roda `lint-staged`, o commit-msg valida a mensagem com `commitlint` e o pre-push roda typecheck, lint e checagem de formatação.

## API

📖 **A referência completa fica no Swagger UI em [`/api/docs`](http://localhost:8080/api/docs)**, e a spec OpenAPI 3.1 em [`/api/docs/json`](http://localhost:8080/api/docs/json). As regras de negócio (status de post, slug, curtidas, rate limiting...) estão em [docs/api.md](docs/api.md).

As rotas marcadas com 🔒 exigem `Authorization: Bearer $API_KEY` e respondem `403` sem uma chave válida.

| Método   | Rota                    |     | Descrição                                                                            |
| -------- | ----------------------- | --- | ------------------------------------------------------------------------------------ |
| `POST`   | `/posts/draft`          | 🔒  | Gera um rascunho a partir de uma ideia (workflow de IA)                              |
| `GET`    | `/posts`                |     | Lista os posts publicados, com paginação, busca e filtro por tag (`?include=all` 🔒) |
| `GET`    | `/posts/:id`            |     | Busca um post pelo id                                                                |
| `GET`    | `/posts/slug/:slug`     |     | Busca um post publicado pelo slug                                                    |
| `GET`    | `/posts/popular`        |     | Ranking por curtidas numa janela de dias                                             |
| `GET`    | `/posts/:id/review`     | 🔒  | Histórico das revisões da IA                                                         |
| `PUT`    | `/posts/:id`            | 🔒  | Edita um post ainda não aprovado                                                     |
| `PATCH`  | `/posts/:id/approve`    | 🔒  | Aprova e publica                                                                     |
| `DELETE` | `/posts/:id/reject`     | 🔒  | Reprova (sem apagar)                                                                 |
| `PUT`    | `/posts/:id/tags`       | 🔒  | Substitui as tags do post                                                            |
| `GET`    | `/posts/:id/comments`   |     | Comentários aprovados do post                                                        |
| `POST`   | `/posts/:id/comments`   |     | Comenta, com moderação por IA                                                        |
| `GET`    | `/comments`             | 🔒  | Fila de moderação, filtrada por `status`                                             |
| `PATCH`  | `/comments/:id/approve` | 🔒  | Aprova um comentário ou uma resposta da IA                                           |
| `POST`   | `/comments/:id/reply`   | 🔒  | Gera um rascunho de resposta com IA                                                  |
| `DELETE` | `/comments/:id`         | 🔒  | Apaga um comentário                                                                  |
| `POST`   | `/posts/:id/likes`      |     | Curte o post (`X-Visitor-Id`)                                                        |
| `DELETE` | `/posts/:id/likes`      |     | Remove a curtida                                                                     |
| `GET`    | `/tags`                 |     | Tags com posts publicados                                                            |
| `DELETE` | `/tags/:slug`           | 🔒  | Apaga uma tag                                                                        |
| `POST`   | `/editorial/ideas`      | 🔒  | Sugere pautas com o agente de tools                                                  |
| `GET`    | `/feed.xml`             |     | Feed RSS dos posts publicados                                                        |

### Primeiros passos

```bash
# 1. Gere um rascunho (escrito, revisado e com SEO pela IA)
curl -X POST http://localhost:8080/posts/draft \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{ "idea": "Como usar AbortController em Node.js" }'

# 2. Aprove o rascunho para publicá-lo
curl -X PATCH http://localhost:8080/posts/<id>/approve -H "Authorization: Bearer $API_KEY"

# 3. Comente como leitor: o moderador IA decide na hora
curl -X POST http://localhost:8080/posts/<id>/comments -H "Content-Type: application/json" \
  -d '{ "author_name": "Ana", "content": "Funciona com fetch também?" }'

# 4. Peça ideias de novos posts ao editor de pauta
curl -X POST http://localhost:8080/editorial/ideas \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{ "count": 3, "focus": "testes automatizados" }'
```

## Testes

Os testes usam o runner nativo do Node (`node --test`) e o `supertest` para as requisições HTTP. Nenhuma suíte chama um LLM de verdade: os agentes são mockados.

| Tipo       | Pasta               | O que cobre                                                                                                 | Dependências |
| ---------- | ------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ |
| Unitário   | `test/unit/`        | Roteador, auth, rate limit, env, rotas, services, workflow e tools, com o repositório e os agentes mockados | nenhuma      |
| Integração | `test/integration/` | Repositórios executando SQL de verdade                                                                      | Postgres     |
| E2E        | `test/e2e/`         | Todos os recursos pela API HTTP, com o LLM mockado em `mastra.getAgent`                                     | Postgres     |

Um teste unitário também garante que toda rota registrada está documentada na spec OpenAPI.

Integração e E2E leem o `.env.test` (versionado, sem segredos) e usam o banco `blog_test` no mesmo Postgres do `docker compose`. O setup global ([test/setup/database.ts](test/setup/database.ts)) cria o banco e aplica as migrations, e recusa qualquer banco cujo nome não termine em `_test`, já que os testes truncam as tabelas. Essas suítes rodam com `--test-concurrency=1` porque compartilham o banco. Os unitários usam `mock.module`, que no Node 26 ainda exige `--experimental-test-module-mocks` (já incluso no script), então o `ExperimentalWarning` na saída é esperado.

```bash
npm run infra:up   # o Postgres precisa estar de pé para integração e E2E
npm test
```

## Build e deploy

```bash
npm run build
```

O build roda o typecheck e gera a imagem `blog-ia-nodejs:latest` a partir do [Dockerfile](Dockerfile). A imagem tem dois estágios sobre `node:26-alpine`, com só as dependências de produção, roda como o usuário `node` com `NODE_ENV=production` em `0.0.0.0:8080` e não leva nenhum `.env` (ver [.dockerignore](.dockerignore)).

```bash
docker run --rm -p 8080:8080 \
  -e DATABASE_URL=postgres://blog:blog@host.docker.internal:5432/blog \
  -e GOOGLE_API_KEY=... \
  -e API_KEY=... \
  blog-ia-nodejs:latest
```

Para publicar em produção:

1. Gere a imagem com uma tag de versão e envie para o registry (Docker Hub, GHCR, ECR...):

   ```bash
   docker tag blog-ia-nodejs:latest <registry>/blog-ia-nodejs:<versao>
   docker push <registry>/blog-ia-nodejs:<versao>
   ```

2. Rode as migrations no banco de produção antes de subir a nova versão. O `postgrator-cli` não está na imagem, então rode a partir de uma máquina com o projeto instalado. Quando `DATABASE_URL` está definida, o `.env.local` é ignorado:

   ```bash
   DATABASE_URL=postgres://<user>:<senha>@<host>:5432/<db> npm run migrate:up
   ```

3. Faça o deploy do container expondo a porta `8080` e definindo `DATABASE_URL`, `API_KEY` (um valor longo e aleatório, por exemplo `openssl rand -hex 32`) e a chave do provedor de LLM. Os modelos (`*_MODEL`) só precisam ser definidos se você quiser trocar o padrão.

## Contribuindo

Os commits seguem [Conventional Commits](https://www.conventionalcommits.org/) e são validados pelo `commitlint`, por exemplo `feat: adiciona rota de busca de posts`.
