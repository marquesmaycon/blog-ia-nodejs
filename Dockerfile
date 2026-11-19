# syntax=docker/dockerfile:1

# Estágio de dependências: instala apenas as dependências de produção.
# --ignore-scripts evita o "prepare" (lefthook install), que exige git e devDependencies.
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Estágio final: Node 26 executa TypeScript nativamente, então basta copiar o código-fonte.
FROM node:26-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=8080 \
    API_PROTOCOL=http

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node src ./src

USER node

EXPOSE 8080

CMD ["node", "src/index.ts"]
