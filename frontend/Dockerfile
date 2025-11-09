# Build stage
FROM node:20-alpine AS build
WORKDIR /workspace
COPY clients/angular-auth ./clients/angular-auth
WORKDIR /workspace/architect/frontend
COPY architect/frontend/package.json ./package.json
COPY architect/frontend/yarn.lock ./yarn.lock
RUN corepack enable \
 && if [ -f yarn.lock ]; then yarn install --immutable; else yarn install; fi \
 && ln -s /workspace/architect/frontend/node_modules /workspace/node_modules
COPY architect/frontend/ .
RUN yarn build

# Runtime stage
FROM nginx:1.27-alpine
# Angular application outputs browser assets under dist/architect/browser
COPY --from=build /workspace/architect/frontend/dist/architect/browser /usr/share/nginx/html
COPY architect/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
