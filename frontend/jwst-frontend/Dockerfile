FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.29-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

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
