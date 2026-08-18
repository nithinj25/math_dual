FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* at BUILD time — they are not read at runtime. That is why
# these arrive as build args: the same image cannot be re-pointed at a different
# API later, a rebuild is required.
ARG VITE_API_URL
ARG VITE_GATEWAY_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

ENV VITE_API_URL=$VITE_API_URL \
    VITE_GATEWAY_URL=$VITE_GATEWAY_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# ---

FROM caddy:2-alpine

COPY --from=build /app/dist /srv
COPY Caddyfile.static /etc/caddy/Caddyfile

EXPOSE 80
