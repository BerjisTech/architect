FROM golang:1.22-alpine AS build
WORKDIR /app
COPY architect/service/go.mod ./go.mod
COPY architect/service/go.sum ./go.sum
COPY shared/coreauth /shared/coreauth
RUN apk add --no-cache git
RUN go env -w GOPROXY=https://proxy.golang.org,direct && go mod download -x || true
COPY architect/service/ ./
RUN go mod tidy && go mod download -x || true
RUN mkdir -p /out \
 && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/berjis-architect ./cmd/service

FROM gcr.io/distroless/base-debian12
WORKDIR /
COPY --from=build /out/berjis-architect /berjis-architect
COPY --from=build /app/migrations /migrations
EXPOSE 8091
USER 65532:65532
ENTRYPOINT ["/berjis-architect"]
