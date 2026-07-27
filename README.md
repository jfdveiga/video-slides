# video-slides

Graba videos 9:16 (608×1080) desde HTML con animaciones CSS + JS usando Playwright + Chromium headless.

## Requisitos

- Node.js 18+
- pnpm
- ffmpeg (opcional, para convertir .webm → .mp4)
- Conocimientos básicos de HTML/CSS/JS para editar las animaciones

## Instalación

```bash
pnpm install
pnpm exec playwright install chromium
```

## Uso

```bash
# 1. Crear un video de ejemplo en work/
pnpm run init

# 2. Editarlo (work/publicacion-1.html)...
# 3. Grabar video (work/output/publicacion-1.mp4)
pnpm run record

# Otras formas:
pnpm run init 2         # Crea work/publicacion-2.html
pnpm run record 1       # Graba solo publicacion-1

pnpm run record --init  # También funciona directamente
```

`pnpm run record` sin args busca `publicacion-*.html` en `work/` y los graba todos.
Los videos se guardan en `work/output/` como `.mp4` (`.webm` si ffmpeg no está instalado).

## Cómo funciona

1. Creas archivos `publicacion-N.html` en `work/` con tus animaciones
2. `pnpm run record` abre cada HTML en Chromium con `recordVideo` activado
3. Simula un clic en el centro para iniciar la línea de tiempo
4. Espera a que `.progress-bar` llegue a `width: 100%` (máx. 20 s)
5. Espera 1 s extra para que el logo final se vea
6. Guarda el `.webm` y lo convierte a `.mp4` (si ffmpeg está instalado)

## Estructura

```
video-slides/
├── package.json        # Dependencia: playwright
├── record.mjs          # Script de grabación (Playwright)
├── .gitignore
├── README.md
└── work/
    ├── publicacion-1.html   # Tus videos animados aquí
    └── output/              # Videos generados (.webm / .mp4)
```

## Anatomía de un video HTML

Cada `publicacion-N.html` necesita:

- **`.progress-bar`** — elemento cuyo `style.width` llega a `100%` al final. El script espera a que eso ocurra para detener la grabación.
- **Animación por `click`** — el script simula un clic en el centro (304, 540) para arrancar la línea de tiempo.
- **Viewport**: 608×1080 (9:16), fondo negro (`colorScheme: dark` + `addInitScript` forzando `background: #000`).
- **Fuentes**: Google Fonts vía `<link>`. El script espera a `document.fonts.ready`.

## Tips

- **Duración**: La animación debe completarse en ≤ 20 s (timeout del `waitForFunction`). Ajusta la velocidad de tu timeline.
- **Barra de progreso**: Es la señal de "fin". Si no existe o no llega a 100%, el script hace timeout y cierra igual.
- **Formato**: 608×1080 píxeles (9:16 vertical, ideal para Stories/Reels/Shorts).
- **Fondo**: El script fuerza fondo negro vía `addInitScript` antes del primer paint.
- **ffmpeg**: Si no está instalado, solo obtienes `.webm`. En Windows se busca en `LOCALAPPDATA` (WinGet), `C:\ffmpeg\bin\` y `PATH`.
- **Varios videos**: Nombra los archivos `publicacion-1.html`, `publicacion-2.html`, etc. Se ordenan por número y se graban en secuencia.
- **Vista previa**: Abre el HTML directamente en el navegador para ver la animación antes de grabar.
