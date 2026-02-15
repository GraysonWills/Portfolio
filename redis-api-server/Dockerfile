FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Drop privileges for runtime.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
