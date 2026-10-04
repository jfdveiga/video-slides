# video-slides

Genera vídeos 9:16 (608×1080) desde **proyectos de escenas**: HTML animado y/o vídeos existentes.

> Historia del cambio de motor de captura (Playwright/virtual‑time → timecut), pruebas y beneficios: ver [`MIGRACION-TIMECUT.md`](MIGRACION-TIMECUT.md).

- **HTML** → captura frame a frame con [`timecut`](https://github.com/vvo/timecut) (Puppeteer + Chromium), que respeta las animaciones/transiciones CSS.
- **Vídeo** → normalización con FFmpeg (recorte, `fit`, zoom Ken Burns, slow‑motion).
- **Composición** → concatenación con transiciones `xfade`.

## Requisitos

- Node.js 18+
- pnpm
- ffmpeg (PATH, WinGet o rutas comunes)
- Chromium: se usa el de **Playwright** (`pnpm exec playwright install chromium`) o, si no, Chrome/Edge del sistema. Override con `CHROMIUM_PATH`.
- `timecut` se ejecuta vía `npx` (la primera vez requiere red).

## Instalación

```bash
pnpm install
pnpm exec playwright install chromium   # provee Chromium para timecut
```

## Uso

```bash
# Generar un proyecto de vídeo
pnpm video build demo          # → videos/projects/demo/output/final.mp4

# Capturar una sola escena HTML a MP4
pnpm video render videos/projects/demo/assets/publicacion-8.html [salida.mp4]
```

Los clips de entrada (`assets/*.mp4`) y el vídeo final (`output/`) **no se versionan**: se generan. Para rehacerlos desde cero:

```bash
# 1) Clips de entrada (a partir de los HTML fuente en assets/)
pnpm video render videos/projects/demo/assets/publicacion-8.html
pnpm video render videos/projects/demo/assets/publicacion-10.html
pnpm video render videos/projects/demo/assets/publicacion-11.html

# 2) Vídeo final
pnpm video build demo
```

## Estructura

```text
video-slides/
├── video.mjs             # CLI: build / render
├── tooling/lib/
│   ├── project.mjs           # parse/validación de video.json
│   ├── timecut.mjs           # captura HTML → MP4 (timecut + Chromium + ffmpeg)
│   └── ffmpeg.mjs            # normalizar (recorte/fit/zoom/speed), concat, xfade
└── videos/
    ├── assets/            # recursos compartidos (logo.png...)
    ├── common/            # escenas reutilizables (intro.html, outro.html, ending.html)
    └── projects/
        └── <proyecto>/
            ├── video.json
            ├── assets/     # escenas HTML y clips MP4 de entrada
            └── output/     # generado (ignorado por git)
```

## `video.json` — referencia

```json
{
  "output": "output/final.mp4",
  "fps": 30,
  "width": 608,
  "height": 1080,
  "duration": 8,
  "scenes": [
    "../../common/intro.html",
    "cards/c1.html",
    { "src": "../demo/assets/clip.mp4", "from": 0, "to": 5, "fit": "cover", "zoom": { "from": 1.0, "to": 1.25 } },
    { "src": "../demo/assets/clip.mp4", "from": 8, "to": 13, "fit": "cover", "speed": 0.6 }
  ],
  "transitions": { "type": "fade", "duration": 0.25 }
}
```

### Raíz

| Campo | Default | Descripción |
|-------|---------|-------------|
| `output` | `output/final.mp4` | Salida, relativa al `video.json`. |
| `fps` | `30` | Frames por segundo. |
| `width` / `height` | `608` / `1080` | Resolución. |
| `duration` | — | Duración (s) fallback si un HTML no expone `__SCENE_DURATION_MS`. |
| `scenes` | — | Escenas en orden (obligatorio). |
| `transitions` | — | Transiciones entre escenas (abajo). |

### Escena

String (ruta) u objeto:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `src` | string | Ruta relativa al `video.json`. `.html` → captura timecut; vídeo (`.mp4/.webm/.mov/.mkv/.avi/.m4v`) → normalizado. |
| `fit` | `contain` \| `cover` | `contain` = letterbox; `cover` = recorte centrado. Solo vídeo. |
| `zoom` | `{ from, to }` | Ken Burns (factor de zoom). Solo vídeo. Requiere `ffprobe`. |
| `from` / `to` | number (s) | Recorta el clip de vídeo. |
| `speed` | number (0.5–2) | Cámara lenta/acelerada. Solo vídeo. |

### Transiciones

```jsonc
"transitions": { "type": "fade", "duration": 0.25 }      // misma en todos los cortes
"transitions": [ { "type": "fade", "duration": 0.3 }, { "type": "wipeleft", "duration": 0.4 } ]  // una por corte (n-1)
"transitions": "none"                                    // corte seco (u omitir)
```

`xfade` **solapa** clips (acorta la duración total): con clips cortos usa `duration` pequeño (0.2–0.4) o `"none"`.
Tipos soportados (ffmpeg `xfade`): `fade`, `fadeblack`, `fadewhite`, `dissolve`, `pixelize`, `radial`, `wipeleft/right/up/down`, `wipetl/tr/bl/br`, `slideleft/right/up/down`, `circleopen/close`, `smoothleft/right/up/down`, `distance`, `hblur`, `zoomin`. Docs: <https://ffmpeg.org/ffmpeg-filters.html#xfade>.

## Anatomía de una escena HTML

- **Click para arrancar**: la escena inicia su línea de tiempo en `click`. El pipeline **inyecta un auto-click** al capturar con timecut (no modifiques el HTML).
- **`window.__SCENE_DURATION_MS`** (ms) — duración de la captura. Si falta, se usa `duration` del `video.json`.
- Fondo negro, viewport `width×height`, fuentes Google vía `<link>`.

```html
<div id="t">Hola</div>
<script>
window.__SCENE_DURATION_MS = 2000;
let started = false;
document.addEventListener('click', () => { if (started) return; started = true; document.getElementById('t').style.opacity = '1'; });
</script>
```

## Cómo funciona

1. `pnpm video build <proyecto>` lee y valida `video.json` y la existencia de las escenas.
2. Por escena, en orden:
   - **HTML** → [`timecut`](tooling/lib/timecut.mjs:1): copia temporal con auto-click, captura frame a frame a `fps`, y normaliza (resolución + audio silencioso) para concatenar.
   - **Vídeo** → [`normalizeClip`](tooling/lib/ffmpeg.mjs:68): `from/to`, `fit`, `zoom` (`zoompan`), `speed` (`setpts/atempo`).
3. Concatena (con `xfade` si hay transiciones) → `output/final.mp4`.
4. Limpia los intermedios.

## Control de errores

- Validación previa de `video.json` y de **todas** las escenas (aborta listando las que faltan).
- Chromium: se prefiere el de Playwright (más estable con timecut); fallback a Chrome/Edge del sistema.
- timecut tolera un fallo al **limpiar su carpeta temporal** si el MP4 ya se generó.

## Más opciones (ffmpeg)

- Zoom/Ken Burns: <https://ffmpeg.org/ffmpeg-filters.html#zoompan>
- Encuadre: <https://ffmpeg.org/ffmpeg-filters.html#scale>, `crop`, `pad`
- Transiciones: <https://ffmpeg.org/ffmpeg-filters.html#xfade>
- Audio/silencio: <https://ffmpeg.org/ffmpeg-filters.html#anullsrc>
