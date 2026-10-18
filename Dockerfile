FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci \
    && npm install --no-save --package-lock=false @simplewebauthn/server@13.2.2 qrcode@1.5.4

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000 \
    TZ=Europe/London

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm install --no-save --omit=dev --package-lock=false @simplewebauthn/server@13.2.2 qrcode@1.5.4 \
    && npm cache clean --force

COPY --from=build /app/dist ./dist

USER node

EXPOSE 5000

CMD ["node", "dist/index.cjs"]
