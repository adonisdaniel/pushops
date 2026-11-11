# PushOps

Telegram Mini App para contar flexiones con la cámara del teléfono y competir
con tus amigos.

- **Frontend**: SPA vanilla (HTML + CSS + módulos ES nativos, sin build step)
- **Backend**: Go (`net/http` + `chi`), binario único que sirve también el SPA
- **Base de datos**: Turso Cloud (dialecto SQLite/libSQL) vía driver Go puro
- **Detección**: MediaPipe PoseLandmarker en WASM, 100 % on-device

---

## Puesta en marcha

### 1. Requisitos

- Go 1.24+
- [Turso CLI](https://docs.turso.tech/cli) (opcional, solo para crear la BD)

### 2. Crear la base de datos

La base de producción ya existe: `puhops-adonisdaniel` en la región
`aws-us-east-1`. Para crear otra:

```bash
turso db create pushops
turso db tokens create --permissions rw     # imprime el token, guárdalo
```

### 3. Configurar el entorno

```bash
cp .env.example .env
$EDITOR .env
```

### 4. Arrancar en local

```bash
# Opción A: base de datos local en un archivo (motor embebido, sin nube)
export TURSO_DATABASE_URL=".data/pushops.db"
export JWT_SECRET="cambia-esto-por-una-cadena-larga-aleatoria"
export DEV_MODE=true
go run ./cmd/pushops

# Opción B: contra Turso Cloud
export TURSO_DATABASE_URL="libsql://pushops-<org>.turso.io"
export TURSO_AUTH_TOKEN="..."
go run ./cmd/pushops
```

El servidor escucha en `:8080` y aplica las migraciones solo al arrancar.

### 5. Probar la cámara (importante)

Abre `https://<tu-dominio>/spike.html` **desde dentro de Telegram**. La página
muestra si el WebView entrega píxeles reales, si el modelo detecta el cuerpo y a
cuántos FPS va. Esta es la prueba que decide si iOS sirve o no.

> ⚠️ `getUserMedia` exige **contexto seguro**: solo funciona bajo HTTPS (o
> `localhost`). Telegram requiere además que el Mini App se sirva por HTTPS.

---

## Configurar el bot de Telegram

1. `@BotFather` → `/newbot` → guarda el token en `TELEGRAM_BOT_TOKEN`.
2. `@BotFather` → *Bot Settings* → *Configure Mini App* → URL = `https://tu-dominio`.
3. Activa **Main Mini App** (botón *Launch app* en el perfil del bot).
4. Opcional: *Menu Button* para abrir la app desde cualquier chat.

---

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `TURSO_DATABASE_URL` | sí | `libsql://…` o ruta local `.data/pushops.db` |
| `TURSO_AUTH_TOKEN` | en producción | Token de la base de datos |
| `JWT_SECRET` | sí | Firma las sesiones (mín. 16 caracteres) |
| `TELEGRAM_BOT_TOKEN` | sí | Token del bot, para validar `initData` |
| `PUBLIC_URL` | no | URL pública del servidor |
| `PORT` | no | Puerto de escucha (8080) |
| `ALLOW_ORIGINS` | no | CORS, `*` por defecto |
| `DEV_MODE` | no | Habilita `/api/auth/dev` (nunca en producción) |

---

## Despliegue en Render

El repositorio incluye un [Blueprint](https://render.com/docs/blueprint-spec)
(`render.yaml`) que declara el servicio completo.

1. Sube el código a GitHub (recomendado: repo **privado**).

   ```bash
   git remote add origin git@github.com:<tu-user>/pushops.git
   git push -u origin main
   ```

2. En Render: *New* → *Blueprint* → selecciona el repositorio. Render lee
   `render.yaml` y te pedirá los tres secretos:
   - `TURSO_AUTH_TOKEN` — token de la base de datos (permisos `rw`).
   - `TELEGRAM_BOT_TOKEN` — token del bot de `@BotFather`.
   - `PUBLIC_URL` — `https://<nombre-del-servicio>.onrender.com`.

   `JWT_SECRET` lo genera Render automáticamente. **Ningún secreto se guarda en
   el repositorio.**

3. Cuando termine el deploy, el servicio queda en `https://pushops.onrender.com`.

4. *Despierta el servicio* antes de configurar Telegram: en el plan `free` la
   instancia se duerme a los 15 minutos de inactividad y Telegram rechazaría la
   URL del Mini App con *"Mini App URL is not valid"* si valida contra una
   instancia dormida.

   ```bash
   curl https://pushops.onrender.com/healthz
   ```

   Para mantenerlo siempre despierto, configura un monitor gratuito
   (UptimeRobot → `/healthz` cada 5 minutos). El plan `free` no admite cron
   jobs propios.

### Configurar el bot de Telegram

1. `@BotFather` → *Bot Settings* → *Configure Mini App* → URL = `https://pushops.onrender.com`.
2. Activa **Main Mini App** (botón *Launch app* en el perfil del bot).
3. Opcional: *Menu Button* para abrir la app desde cualquier chat.

### Alternativa: Docker

El `Dockerfile` incluido también funciona (Debian slim, porque el motor
embebido de Turso distribuye una biblioteca glibc):

```bash
docker build -t pushops .
docker run -p 8080:8080 \
  -e TURSO_DATABASE_URL=libsql://... \
  -e TURSO_AUTH_TOKEN=... \
  -e TELEGRAM_BOT_TOKEN=... \
  -e JWT_SECRET=... \
  pushops
```

---

## Estructura

```
pushops/
├── cmd/pushops/          servidor
├── internal/
│   ├── auth/             validación de initData de Telegram, JWT
│   ├── config/           configuración por entorno
│   ├── db/               conexión a Turso y runner de migraciones
│   ├── domain/           modelos, puntuación, nicknames, anti-trampa
│   ├── handlers/         endpoints HTTP
│   ├── httpx/            router, middlewares, helpers
│   └── store/            acceso a datos
├── migrations/           SQL (embebido en el binario)
├── web/                  la SPA (embebida en el binario)
│   ├── css/
│   ├── js/
│   │   ├── pose/         motor de detección
│   │   └── views/        pantallas
│   └── spike.html        página de diagnóstico de cámara
├── static/
│   ├── models/           pose_landmarker_lite.task
│   └── vendor/mediapipe/ runtime WASM
├── tests/                tests del motor de detección (node --test)
├── assets.go             go:embed del SPA y de los assets
├── render.yaml           Blueprint de Render
└── Dockerfile            imagen alternativa
```

---

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/auth/telegram` | Valida `initData` y devuelve una sesión |
| `GET` | `/api/me` · `PATCH /api/me` | Perfil: nickname, peso |
| `GET` | `/api/me/summary` | Totales, racha, mejor serie, ritmo |
| `GET` | `/api/me/timeseries` | Serie temporal por día/semana/mes |
| `GET` | `/api/me/workouts` | Historial de series |
| `POST` | `/api/workouts` | Guarda una serie (el servidor puntúa) |
| `GET` | `/api/workouts/{id}` | Detalle de una serie con sus repeticiones |
| `GET` | `/api/users/search` | Buscar usuarios |
| `GET` | `/api/friends` | Amigos y solicitudes pendientes |
| `POST` | `/api/friends/requests` | Enviar solicitud |
| `POST` | `/api/friends/requests/{id}/respond` | Aceptar o rechazar |
| `DELETE` | `/api/friends/{id}` | Eliminar amistad |
| `GET` | `/api/friends/compare` | Comparativa entre usuarios |
| `GET` `POST` | `/api/groups` | Listar y crear grupos |
| `POST` | `/api/groups/join` | Unirse con el código de invitación |
| `GET` | `/api/groups/{id}/leaderboard` | Ranking del grupo |
| `GET` | `/api/groups/{id}/stats` | Totales y serie diaria del grupo |
| `GET` | `/api/leaderboard` | Ranking global |

---

## Puntuación

```
points = repeticiones válidas × multiplicador de variante × clamp(peso/75, 0.60, 1.80) × bonus de racha
```

| Variante | × | Variante | × |
|---|---|---|---|
| Estándar | 1.00 | Una mano | 2.00 |
| Anchas | 1.05 | Archer | 1.60 |
| Diamante | 1.15 | HSPU | 2.20 |
| Pike | 0.85 | Pies elevados | 1.40 |
| Rodillas | 0.50 | | |

El peso se versiona: cada serie usa el peso declarado en su momento, así que
subir de peso nunca reescala tu historial. El bonus de racha llega al +30 %.

---

## Anti-trampa

La app es cliente y no se fía de nada de lo que reportan. El servidor:

- rechaza repeticiones de duración imposible (< 900 ms o > 15 s),
- rechaza series demasiado cortas para las repeticiones que declaran,
- rechaza series con confianza de detección baja,
- limita a 500 repeticiones por sesión,
- ignora la puntuación que envíe el cliente y la recalcula,
- deduplica por `clientId` para que reintentar la subida no cuente dos veces,
- excluye del ranking global de puntos a las cuentas con el peso sin confirmar
  hace más de 30 días.

---

## Desarrollo

```bash
make dev        # arranca el servidor en local
make test       # tests de Go
make build      # binario en ./bin/pushops
make fmt        # gofmt
```
