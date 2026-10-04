import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { normalizeClip } from './ffmpeg.mjs';

// Localiza un Chromium/Chrome moderno (env, sistema o Playwright).
export function findChromium() {
  // 1) Override explícito por entorno.
  for (const p of [process.env.CHROMIUM_PATH, process.env.CHROME_PATH]) {
    try { if (p && existsSync(p)) return p; } catch {}
  }

  // 2) Chromium de Playwright (versión reciente y conocida-estable con timecut).
  const mp = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  try {
    if (existsSync(mp)) {
      const dirs = readdirSync(mp).filter(d => d.startsWith('chromium-')).sort().reverse();
      for (const d of dirs) {
        for (const rel of ['chrome-win64\\chrome.exe', 'chrome-win\\chrome.exe']) {
          const p = join(mp, d, rel);
          if (existsSync(p)) return p;
        }
      }
    }
  } catch {}

  // 3) Chrome/Edge del sistema (fallback).
  for (const p of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ]) {
    try { if (existsSync(p)) return p; } catch {}
  }
  return undefined;
}

// Extrae la duración (ms) del HTML: __SCENE_DURATION_MS literal o TOTAL_DURATION.
export function detectDurationMsFromHtml(htmlPath) {
  let html;
  try { html = readFileSync(htmlPath, 'utf8'); } catch { return null; }
  let m = html.match(/__SCENE_DURATION_MS\s*=\s*(\d+(?:\.\d+)?)/);
  if (m) return Number(m[1]);
  m = html.match(/TOTAL_DURATION\s*=\s*(\d+(?:\.\d+)?)/);
  if (m) return Number(m[1]);
  return null;
}

// Elimina restos de timecut (`timecut-temp-*`, normalmente con frames PNG) en
// uno o varios directorios. Cubre el caso de crash de timecut al limpiar.
function cleanupTempDirs(...dirs) {
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('timecut-temp-')) {
          try { rmSync(join(dir, name), { recursive: true, force: true }); } catch {}
        }
      }
    } catch {}
  }
}

// Captura un HTML a un clip MP4 normalizado usando timecut (frame a frame,
// respeta CSS `transition`/`@keyframes`). Inyecta un auto-click porque timecut
// no dispara el evento `click` que arrancan nuestras escenas.
export function renderHtmlWithTimecut({ htmlPath, clipPath, fps, width, height, durationMs, seed, ffmpeg, ffprobe }) {
  if (!durationMs || durationMs <= 0) throw new Error(`❌ duración no definida para ${basename(htmlPath)}`);

  // La copia autostart debe quedar junto al HTML original para que las rutas
  // relativas (logo, assets) sigan resolviendo.
  const tmpHtml = join(dirname(htmlPath), `.tc-autostart-${basename(htmlPath)}`);
  const tmpMp4 = join(dirname(clipPath), `.tc-raw-${basename(clipPath)}`);

  let html = readFileSync(htmlPath, 'utf8');
  const auto = `<script>window.addEventListener('load',function(){setTimeout(function(){document.body.click()},30)});<\/script>`;
  html = html.includes('</body>') ? html.replace('</body>', auto + '\n</body>') : html + auto;
  writeFileSync(tmpHtml, html, 'utf8');

  const q = p => `"${p}"`;
  const args = [
    '-y', 'timecut', q(tmpHtml),
    '-O', q(tmpMp4),
    '-R', String(fps),
    '-d', (durationMs / 1000).toFixed(3),
    '-V', `${width},${height}`,
    '--screenshot-type', 'png'
  ];
  if (seed != null) args.push('-u', String(seed));
  const chromium = findChromium();
  if (chromium) args.push('--executable-path', q(chromium));
  if (ffmpeg) args.push('--ffmpeg-path', q(ffmpeg));

  // timecut es puntualmente inestable (a veces el proceso GPU muere y la página
  // crashea, o sale con error SOLO al limpiar su carpeta temporal). Reintentamos.
  const MAX_ATTEMPTS = Math.max(1, Number(process.env.TIMECUT_ATTEMPTS || 3));
  let ok = false, lastStatus = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ok; attempt++) {
    const r = spawnSync('npx', args, { stdio: 'inherit', shell: true });
    lastStatus = r.status;
    // Éxito si el MP4 existe y no está vacío (aunque el proceso salga != 0 por el bug de limpieza).
    try { ok = existsSync(tmpMp4) && statSync(tmpMp4).size > 0; } catch {}
    if (!ok) {
      try { rmSync(tmpMp4, { force: true }); } catch {}
      cleanupTempDirs(dirname(clipPath), dirname(htmlPath));
      if (attempt < MAX_ATTEMPTS) console.log(`  ↻ timecut intento ${attempt} falló (código ${r.status}); reintentando...`);
    }
  }
  try { rmSync(tmpHtml, { force: true }); } catch {}
  if (!ok) {
    cleanupTempDirs(dirname(clipPath), dirname(htmlPath));
    throw new Error(`timecut falló tras ${MAX_ATTEMPTS} intentos (último código ${lastStatus})`);
  }

  // Normaliza (resolución, fps, yuv420p y pista de audio silencio) para poder
  // concatenar con -c copy junto a clips de vídeo.
  normalizeClip(ffmpeg, ffprobe, tmpMp4, clipPath, { width, height, fps });
  try { rmSync(tmpMp4, { force: true }); } catch {}
  cleanupTempDirs(dirname(clipPath), dirname(htmlPath));
}
