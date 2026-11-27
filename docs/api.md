# Regras da API

A referência de cada rota (parâmetros, bodies, status codes e exemplos) está no Swagger UI em [`/api/docs`](http://localhost:8080/api/docs) e na spec OpenAPI 3.1 em [`/api/docs/json`](http://localhost:8080/api/docs/json). Este arquivo reúne as regras de negócio que a spec não explica. O comportamento dos agentes de IA está em [agentes.md](agentes.md).

## Formato das respostas

Todas as respostas são JSON. Em caso de sucesso, o recurso vem em `data`, e as listagens paginadas trazem também `meta: { page, limit, total }`. Em caso de erro, o corpo é `{ "message": "..." }`.

Erros de validação (`400`) também trazem `errors`, com um item por problema, gerado a partir do zod:

```json
{
  "message": "Invalid request body",
  "errors": [
    { "field": "content", "message": "Too big: expected string to have <=2000 characters" }
  ]
}
```

## Autenticação

As rotas administrativas exigem o header `Authorization: Bearer $API_KEY`. Sem ele, com uma chave errada ou com a `API_KEY` não definida, elas respondem `403`. Na spec, essas rotas aparecem com o cadeado.

## Posts

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

- **Status:** um post é **rascunho** quando `approved_at` e `rejected_at` estão nulos. Aprovar define `approved_at` e `published_at` e limpa `rejected_at`. Reprovar define `rejected_at` e limpa `approved_at`, mas **não** apaga o registro.
- **Visibilidade:** `GET /posts`, `GET /posts/slug/:slug`, o RSS, os comentários e as curtidas só enxergam posts aprovados. `GET /posts/:id` retorna qualquer status, e `GET /posts?include=all` (admin) lista todos.
- **Slug:** é único e gerado do título ou sugerido pelo agente de SEO. Títulos repetidos ganham sufixo (`-2`, `-3`...) e, quando o título não tem letras nem dígitos, o slug vira `post`.
- **Tempo de leitura:** `reading_time_minutes` é estimado a 200 palavras por minuto, com mínimo de 1.
- **Edição (`PUT /posts/:id`):** só vale para posts ainda **não aprovados** (`409` depois da aprovação). `title` e `content` são obrigatórios. `summary` e `meta_description` são opcionais: ausentes, mantêm o valor atual, e `null` ou texto vazio limpam o campo. O tempo de leitura é recalculado e, se o título mudou, o slug é regerado, o que é seguro porque o post ainda não tem URL pública.
- **SEO:** `summary` e `meta_description` ficam `null` nos posts antigos ou quando o agente de SEO falha.
- **Contadores:** `likes_count`, `comments_count` e `tags` são calculados a cada consulta. `comments_count` conta só os comentários aprovados (incluindo as respostas da IA aprovadas), e `tags` vem ordenado pelo nome.

### Listagem e busca

- **Paginação:** `?page=` começa em 1 (padrão 1) e `?limit=` vai de 1 a 50 (padrão 10). Uma página além do fim devolve `data` vazio com o `total` real.
- **Busca:** `?q=` faz busca full-text em português no título e no conteúdo, com stemming (`"testes"` encontra `"teste"`), e ordena por relevância, com o título pesando mais. Aceita a sintaxe de buscador (`"frase exata"`, `-excluir` e `or`). Acentos contam: `"migracao"` não encontra `"migração"`. A busca usa uma coluna `tsvector` gerada e um índice GIN.
- **Filtro:** `?tag=<slug>` filtra pela tag. Todos os parâmetros podem ser combinados, e uma tag que não existe devolve lista vazia.

### Feed RSS

`GET /feed.xml` é um RSS 2.0 com os 20 posts aprovados mais recentes. Cada item aponta para `SITE_URL/posts/slug/<slug>`, e a descrição é o `summary` do post ou, sem ele, um trecho do conteúdo sem a marcação Markdown.

## Comentários

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

- `status` é `pending`, `approved` ou `rejected`, e só os aprovados aparecem publicamente. O status inicial vem do moderador IA (ver [agentes.md](agentes.md#comment-moderator)).
- Comentários só existem em posts aprovados: para rascunhos, reprovados ou ids inexistentes, as rotas públicas respondem `404`.
- `parent_id` aponta para o comentário respondido (`null` no primeiro nível), e `author_type` é `reader` para leitores ou `ai` para as respostas do `comment-replier`. As listagens são planas, em ordem cronológica, e o cliente monta as threads por `parent_id`.
- Apagar um post apaga os seus comentários, e apagar um comentário apaga a sua resposta.

## Curtidas

Não há login: o visitante é identificado pelo header `X-Visitor-Id`, um id gerado pelo cliente (ex.: um nanoid guardado no navegador) com 8 a 64 caracteres entre letras, dígitos, `_` e `-`.

- Cada visitante curte um post uma única vez, e a PK composta `(post_id, visitor_id)` garante isso no banco. Curtir de novo responde `200 Post already liked`.
- Descurtir é idempotente: responde `200` mesmo que não houvesse curtida.
- `GET /posts/popular` ranqueia os posts pelas curtidas recebidas nos últimos `days` dias, e cada item traz `recent_likes`. Posts sem curtidas na janela ficam de fora.

## Tags

A identidade de uma tag é o slug gerado do nome (`"Node.js"` vira `node-js`). Nomes que geram o mesmo slug são a mesma tag, e o primeiro nome cadastrado é o que fica.

- `PUT /posts/:id/tags` substitui as tags do post, criando as que não existem, e `{ "tags": [] }` remove todas. Funciona em qualquer status e aceita até 10 tags de 1 a 40 caracteres.
- `GET /tags` lista só as tags com pelo menos um post aprovado, da mais usada para a menos usada.
- `DELETE /tags/:slug` apaga a tag de todos os posts.

## Rate limiting

As rotas públicas de escrita têm um limite em memória, por IP:

| Rota                             | Limite                         |
| -------------------------------- | ------------------------------ |
| `POST /posts/:id/comments`       | 5 por minuto                   |
| `POST`/`DELETE /posts/:id/likes` | 30 por minuto, numa cota única |

As respostas trazem os headers `RateLimit-Limit`, `RateLimit-Remaining` e `RateLimit-Reset`. Ao estourar a cota, a rota responde `429` com `Retry-After`, em segundos.

Atrás de um proxy reverso, defina `TRUST_PROXY=true` para que o IP venha do `X-Forwarded-For`. Sem isso, o header é ignorado, porque o cliente poderia forjá-lo. Como os contadores ficam na memória, cada instância da API tem os seus, e um restart zera todos.

## Como a spec é gerada

Os parâmetros de query e de header e os request bodies vêm dos schemas zod em `src/routes/*.schemas.ts`. Assim, limites, defaults e padrões saem da mesma fonte que valida as requisições, e as descrições e os exemplos ficam no `.meta()` de cada campo. As respostas e as descrições das operações são escritas à mão em [src/docs/](../src/docs/). Um teste unitário compara as rotas registradas com os paths da spec e falha quando uma rota fica sem documentação. Os assets da Swagger UI vêm do CDN unpkg.
