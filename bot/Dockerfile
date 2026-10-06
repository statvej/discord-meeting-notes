# @discordjs/opus has no Linux prebuild for Node 22, so compile it in the full image (python3, make, g++)
FROM node:22-bookworm AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
CMD ["node", "src/index.js"]
