# API Server

Express-based API server for VirgoAudioMasters.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the HTTP server listens on. |
| `SESSION_SECRET` | *(required)* | Secret used to sign session cookies. |
| `UPLOAD_RATE_LIMIT_PER_MINUTE` | `10` | Max upload requests per IP per window. |
| `UPLOAD_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window length in milliseconds. |
| `UPLOAD_TIMEOUT_MS` | `300000` | Wall-clock upload timeout in milliseconds (5 min). |
| `REDIS_URL` | *(optional)* | Redis connection URL (e.g. `redis://localhost:6379`). |

## Redis (shared rate-limit store)

When `REDIS_URL` is set, the upload rate limiter uses a **Redis-backed store** (`rate-limit-redis` + `ioredis`) so that counters are shared across all server replicas. This is required for accurate rate limiting when the API server is scaled horizontally.

When `REDIS_URL` is **not** set (e.g. local development, single-instance deployments), the limiter falls back to an in-process `MemoryStore` automatically.

```
REDIS_URL=redis://your-redis-host:6379
```

Any Redis-compatible service works (Redis OSS, Upstash, Redis Cloud, etc.).
