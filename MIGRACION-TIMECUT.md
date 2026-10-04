# Migración del motor de captura HTML: de *virtual time* (Playwright/CDP) a `timecut`

Documento de trazabilidad del cambio de orientación del capturador **HTML → vídeo** de `video-slides`.
Sirve como base para un futuro post: qué buscábamos, qué probamos, qué descartamos, qué ganamos.

---

## 1. Resumen

- **Antes**: captura *frame a frame* con **Playwright + CDP `Emulation.setVirtualTimePolicy`** (tiempo virtual), guardando un PNG por frame.
- **Ahora**: captura *frame a frame* con **[`timecut`](https://github.com/vvo/timecut)** (Puppeteer + Chromium + FFmpeg).
- **Resultado**: se respetan las animaciones CSS (`transition`/`@keyframes`), fps exactos, PNG sin pérdida, **sin offset inicial** y salida normalizada. El pipeline de vídeo (recorte, `fit`, zoom Ken Burns, `speed`, concatenación `xfade`) se mantiene.

---

## 2. Objetivo

Generar vídeos verticales (608×1080) desde escenas **HTML animado** con la máxima fidelidad:
fps exactos, imagen nítida, animaciones correctas y reproducible, sin depender de grabar la pantalla en vivo.

---

## 3. Cómo capturábamos antes (motor descartado)

`tooling/lib/render-html.mjs` (eliminado):

1. Duración = `window.__SCENE_DURATION_MS`; `totalFrames = duración × fps`; intervalo = `1000/fps`.
2. Chromium headless; navegación `file://`; fondo negro; seed de `Math.random`.
3. **Tiempo virtual** (CDP `Emulation.setVirtualTimePolicy`, `advance` por frame + `pause`).
4. Click sintético para arrancar la timeline; `Page.captureScreenshot` por frame → `frame_%04d.png`.
5. FFmpeg: PNG → MP4.
6. Fallback a **tiempo real** (`recordVideo` de Playwright) si fallaba.

Fragmentos de log reales del motor antiguo:

```
[1/4] intro.html → determinista ✓ (5.0s, 150 frames)
[3/4] outro.html → ⚠️ determinista falló (captureScreenshot timeout (15000ms)), usando tiempo real...
```

---

## 4. Síntomas observados

- **`transition` CSS con retraso**: la clase `.show` se aplicaba a tiempo, pero la opacidad no empezaba a subir hasta ~4–6 s después → escenas iniciales en **negro** (p11) o líneas apareciendo **a la vez** en vez de en cascada (p8).
- **`@keyframes`**: timing correcto, pero `Page.captureScreenshot` **se colgaba** durante animaciones de compositor → timeout → fallback a tiempo real.
- **Inestabilidad por carga**: el mismo HTML a veces renderizaba determinista y a veces no (CPU/RAM del equipo influían en los timeouts).
- **Reloj**: el reloj de la página ya estaba en ~15 s en el primer frame (el bucle de carga avanzaba tiempo virtual en pasos de 1 s).

---

## 5. Pruebas realizadas y descartadas

| # | Prueba | Resultado |
|---|--------|-----------|
| 1 | `--disable-threaded-animation` | Arregla `transition` en escenas simples (p8/p10). **No** en complejas (p11). |
| 2 | Quitar el `pause` entre frames | Igual de malo (no era el `pause`). |
| 3 | Forzar `requestAnimationFrame` por frame | Sin efecto sobre el desfase. |
| 4 | Convertir `transition` → `@keyframes` | Timing correcto, pero **reintroduce el cuelgue** de `captureScreenshot` (timeouts → fallback). |
| 5 | `HeadlessExperimental.beginFrame` | La API existe (Chromium 151) pero en el *headless nuevo* **no devuelve `screenshotData`**, y combinada con `Page.captureScreenshot` **se cuelga**. |
| 6 | `Page.startScreencast` (frame a frame en real) | Fiel y **sin offset**, pero cadencia por *daño* (~19 fps origen) y no reproducible. |
| 7 | `recordVideo` (fallback real) | Fiel pero con **offset ~1 s**, tope ~25 fps y **doble compresión** (WebM→h264). |

Conclusión: el problema **no eran las CSS en sí**, sino que el *tiempo virtual de CDP* no progresaba de forma fiable la línea de tiempo de animación, y las animaciones de compositor colgaban la captura.

---

## 6. Decisión: `timecut`

`timecut` captura **un frame por tick determinista** (Puppeteer + Chromium + FFmpeg), sin congelar el reloj, por lo que **las `transition` y los `@keyframes` corren nativos** y se ven correctos.

### Integración en `video-slides`

- Nuevo [`tooling/lib/timecut.mjs`](tooling/lib/timecut.mjs:1):
  - **Auto-click**: como `timecut` no dispara `click`, se inyecta un `<script>` que hace `document.body.click()` al cargar. La copia temporal se escribe **junto al HTML original** para que las rutas relativas (logo, assets) sigan resolviendo.
  - **Duración**: `scene.duration` > `video.json.duration` > `__SCENE_DURATION_MS`/`TOTAL_DURATION` del HTML.
  - **Normalización** posterior con `normalizeClip` (resolución + pista de audio silencioso) para poder concatenar con `-c copy`.
  - **Chromium**: se prefiere el de **Playwright**; fallback a Chrome/Edge del sistema; override con `CHROMIUM_PATH`.
- Eliminado `tooling/lib/render-html.mjs`.
- CLI unificado en [`video.mjs`](video.mjs:1): `build` y `render`.

---

## 7. Incidentes resueltos durante la integración

1. **timecut crasheaba al borrar su carpeta temporal** (`ENOENT`) aun habiendo generado el MP4 → el pipeline lo tolera si el MP4 existe.
2. **Ruta con espacios**: `--executable-path "C:\Program Files\..."` se partía en el shell → se citan las rutas.
3. **Chrome del sistema**: en escenas largas (p11) el *GPU process* moría al final (tras capturar los 1065 frames) → **no era la GPU**, era el binario. Con el **Chromium de Playwright** funciona. Se reordena `findChromium()` (env → Playwright → sistema).

---

## 8. Beneficios

- **Fidelidad de animación**: `transition` y `@keyframes` correctos (p8 en cascada, p11 escenas on‑time).
- **fps exactos**: se captura a 30 fps (`totalFrames = duración × fps`).
- **Nitidez**: PNG sin pérdida + **una sola codificación** (PNG→h264) frente a WebM→h264.
- **Sin offset inicial**: se captura desde el arranque de la timeline (no graba la precarga).
- **Reproducible**: `-u <seed>` (PRNG determinista).
- **Resolución exacta**: viewport `width×height` (608×1080), `yuv420p`.
- **Menos sensible a la carga**: el stepping no depende de grabar en vivo (tarda lo que tarde, pero no “graba” la pantalla).
- **Tamaño menor** (misma calidad percibida, mejor nitidez):
  - `publicacion-8.mp4`: ~285 KB (recordVideo) → **~104 KB** (timecut).
  - `publicacion-11.mp4`: ~1,19 MB (determinista antiguo) → **~0,98 MB** (timecut).
- **Se mantienen las features**: recorte `from/to`, `fit` (`contain`/`cover`), `zoom` Ken Burns, `speed`, y transiciones `xfade`.

---

## 9. Costes / trade‑offs

- Requiere un **Chromium** (Playwright o del sistema) y `npx timecut` (red la primera vez).
- Escenas largas tardan: **p11 (~35,5 s) ≈ 3,3 min de captura** (por el `blur` de las texturas); p8/p10, segundos.
- Las escenas deben **arrancar con `click`** (se resuelve con el auto‑click inyectado).

---

## 10. Evidencia (verificación)

Frames extraídos de los MP4 generados con timecut:

- `publicacion-8`: 0,9 s → “It won't be a library.”; 1,8 s → línea 1 + “Nor a social network.” (entrando); cascada secuencial.
- `publicacion-11`: 2,4 s → “90 days since development began.”; 4,0 s → “2 ENVIRONMENTS”; 6,0 s → + “WEB/MOBILE” + “17 CONTROL MODULES”.
- `publicacion-10`: 2,0 s → “Get exclusive access.”.

demo final: `videos/projects/demo/output/final.mp4` (14 escenas, 13 transiciones).

---

## 11. Cómo reproducir

```bash
pnpm install
pnpm exec playwright install chromium          # Chromium para timecut

# Capturar una escena HTML
pnpm video render videos/projects/demo/assets/publicacion-8.html

# Construir un proyecto
pnpm video build demo
```

---

## 12. Referencias

- timecut: <https://github.com/vvo/timecut>
- xfade: <https://ffmpeg.org/ffmpeg-filters.html#xfade>
- zoompan (Ken Burns): <https://ffmpeg.org/ffmpeg-filters.html#zoompan>
