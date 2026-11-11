# Build stage
FROM golang:1.24-bookworm AS builder

WORKDIR /src

# Dependencies first so the layer is cached.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/pushops ./cmd/pushops

# Runtime stage.
# Debian (glibc) rather than Alpine: the optional embedded Turso engine ships a
# glibc shared library, and the remote HTTP driver does not care either way.
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --create-home pushops

WORKDIR /app
COPY --from=builder /out/pushops /app/pushops

# Writable directory for the optional local database file.
RUN mkdir -p /app/data && chown -R pushops:pushops /app/data

USER pushops
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/app/pushops"]
