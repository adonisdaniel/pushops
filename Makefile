GO ?= go
BIN := bin/pushops

.PHONY: help dev build test test-go test-js fmt vet lint clean

help:
	@echo "dev    arranca el servidor en local (BD en .data/pushops.db)"
	@echo "build  compila el binario en ./bin/pushops"
	@echo "test   ejecuta los tests de Go y de JavaScript"
	@echo "fmt    formatea el código"
	@echo "vet    análisis estático"
	@echo "clean  borra artefactos"

dev:
	@mkdir -p .data
	TURSO_DATABASE_URL=".data/pushops.db" \
	JWT_SECRET="$${JWT_SECRET:-dev-secret-change-me-please-32chars}" \
	DEV_MODE="$${DEV_MODE:-true}" \
	PUBLIC_URL="$${PUBLIC_URL:-http://localhost:8080}" \
	$(GO) run ./cmd/pushops

build:
	@mkdir -p bin
	$(GO) build -trimpath -ldflags="-s -w" -o $(BIN) ./cmd/pushops

test:
	$(GO) test ./...
	node --test tests/*.test.mjs

fmt:
	gofmt -w .

vet:
	$(GO) vet ./...

lint: fmt vet

clean:
	rm -rf bin .data
