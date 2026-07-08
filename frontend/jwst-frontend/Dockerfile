FROM node:22-alpine AS build

ARG VITE_API_URL
ARG VITE_CE_MODE
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_CE_MODE=${VITE_CE_MODE}

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.29-alpine
# Which nginx config to bake (nginx.conf | nginx-staging.conf | nginx-ce.conf)
ARG NGINX_CONF=nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf

# Create non-root user and ensure nginx directories are writable
RUN addgroup -S -g 1001 appgroup && \
    adduser -S -u 1001 -G appgroup appuser && \
    chown -R appuser:appgroup /var/cache/nginx && \
    chown -R appuser:appgroup /var/log/nginx && \
    chown -R appuser:appgroup /usr/share/nginx/html && \
    touch /var/run/nginx.pid && \
    chown appuser:appgroup /var/run/nginx.pid

USER appuser

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
