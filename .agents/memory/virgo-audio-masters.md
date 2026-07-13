---
name: VirgoAudioMasters architecture
description: Key decisions and conventions for the VirgoAudioMasters audio mastering app.
---

## Stack
- **API server**: Express + TypeScript + Drizzle ORM (Postgres), esbuild bundled. Port from `$PORT`.
- **Web app**: React + Vite at `/` (slug `virgo-web`). Uses `@workspace/api-client-react` generated hooks.
- **Mobile app**: Expo Router at `/virgo-mobile/` (slug `virgo-mobile`). Uses same generated hooks + `setBaseUrl`.

## Key conventions
- OpenAPI spec lives in `lib/api-spec/openapi.yaml`. Codegen: `pnpm --filter @workspace/api-spec run codegen`.
- File upload (multipart) is NOT in the OpenAPI spec — handled by custom `POST /api/audio/upload` with multer. Mobile upload uses a raw `fetch` with `FormData`.
- EQ presets (12) and mastering genres (14) are static data in `artifacts/api-server/src/lib/static-data.ts`.
- DB schema: `lib/db/src/schema/audio-projects.ts`. Push with `pnpm --filter @workspace/db run push`.

## Design tokens (dark-only)
- background: #0F0F0F, foreground: #EBEBEB, primary (gold): #E8A030
- card: #171717, border: #262626, muted: #2E2E2E, mutedForeground: #A6A6A6
- Fonts: Inter (mobile), Inter + Playfair Display (web)

## Mobile-specific
- `setBaseUrl` called at top of `app/_layout.tsx` (outside component) using `process.env.EXPO_PUBLIC_DOMAIN`.
- `expo-document-picker` used for audio file picking. Pin to `~14.0.8` (Expo SDK 54 compatible).
- No UUID generation in mobile — server assigns IDs.

**Why:** File upload via multipart doesn't codegen cleanly from OpenAPI; keeping it custom avoids spec pollution.
