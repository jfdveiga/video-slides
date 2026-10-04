import { join, basename, dirname, resolve } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { loadProject, resolveScenes, validateScenes, isVideoFile, isHtmlFile, DEFAULTS } from './tooling/lib/project.mjs';
import { findFFmpeg, findFFprobe, normalizeClip, concatClips, concatWithTransitions, probeDurationMs } from './tooling/lib/ffmpeg.mjs';
import { renderHtmlWithTimecut, detectDurationMsFromHtml } from './tooling/lib/timecut.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const VIDEOS_DIR = join(ROOT, 'videos');
const PROJECTS_DIR = join(VIDEOS_DIR, 'projects');

const [subcommand, ...rest] = process.argv.slice(2);

if (subcommand !== 'build' && subcommand !== 'render') {
  console.error('❌ Uso:\n   pnpm video build <proyecto>\n   pnpm video render <escena.html> [salida.mp4]');
  process.exit(1);
}

const FFMPEG = findFFmpeg();
if (!FFMPEG) {
  console.error('❌ ffmpeg no encontrado. Instálalo o añádelo al PATH.');
  process.exit(1);
}
const FFPROBE = findFFprobe(FFMPEG);

// Seed opcional para reproducibilidad (timecut PRNG). VIDEO_SEED=0 lo desactiva.
const seedEnv = process.env.VIDEO_SEED;
const seed = seedEnv === undefined ? 42 : (seedEnv === '0' ? null : Number(seedEnv));

// Duración de una escena HTML: explícita (scene.duration s) > video.json.duration
// > __SCENE_DURATION_MS / TOTAL_DURATION del propio HTML.
function sceneDurationMs(scenePath, scene, project) {
  if (scene && scene.duration != null) return scene.duration * 1000;
  if (project && project.duration) return project.duration * 1000;
  const detected = detectDurationMsFromHtml(scenePath);
  return detected || null;
}

// Captura un HTML a un clip MP4 (timecut) y devuelve su duración real.
function captureHtml({ scenePath, clipPath, scene, project, width, height, fps }) {
  const durationMs = sceneDurationMs(scenePath, scene, project);
  if (!durationMs) throw new Error(`❌ duración no definida para ${basename(scenePath)} (añade window.__SCENE_DURATION_MS o "duration" en video.json)`);
  renderHtmlWithTimecut({ htmlPath: scenePath, clipPath, fps, width, height, durationMs, seed, ffmpeg: FFMPEG, ffprobe: FFPROBE });
  const d = probeDurationMs(FFPROBE, clipPath);
  return d || durationMs;
}

// ─────────────────────────────────────────────────────────────
// pnpm video render <escena.html> [salida.mp4]
// ─────────────────────────────────────────────────────────────
if (subcommand === 'render') {
  const [htmlArg, outArg] = rest;
  if (!htmlArg) { console.error('❌ Falta la escena HTML: pnpm video render <escena.html> [salida.mp4]'); process.exit(1); }
  const htmlPath = resolve(htmlArg);
  if (!existsSync(htmlPath)) { console.error(`❌ No existe: ${htmlPath}`); process.exit(1); }
  if (!isHtmlFile(htmlPath)) { console.error(`❌ No es un HTML: ${htmlPath}`); process.exit(1); }

  const outPath = outArg ? resolve(outArg) : htmlPath.replace(/\.html?$/i, '.mp4');
  mkdirSync(dirname(outPath), { recursive: true });

  const { width, height, fps } = DEFAULTS;
  console.log(`🎬 Render: ${basename(htmlPath)} → ${outPath} (${width}x${height} @ ${fps}fps)`);

  const d = captureHtml({ scenePath: htmlPath, clipPath: outPath, scene: null, project: null, width, height, fps });
  console.log(`  ✓ ${basename(outPath)} (${(d / 1000).toFixed(1)}s, timecut)`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────
// pnpm video build <proyecto>
// ─────────────────────────────────────────────────────────────
const projectName = rest[0];
if (!projectName) { console.error('❌ Uso: pnpm video build <proyecto>'); process.exit(1); }

// ── 1. Localizar y leer el proyecto ──
let project;
try {
  project = loadProject(PROJECTS_DIR, projectName);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// ── 2. Resolver rutas relativas desde video.json ──
const resolved = resolveScenes(project.projectDir, project.scenes.map(s => s.src));

// ── 3. Validar existencia de todas las escenas antes de empezar ──
const missing = validateScenes(resolved);
if (missing.length > 0) {
  console.error(`❌ Faltan ${missing.length} archivo(s) de escena:`);
  for (const m of missing) console.error(`   - ${m}`);
  process.exit(1);
}

// ── 4. Preparar directorios ──
const outputAbs = join(project.projectDir, project.output);
const buildDir = join(dirname(outputAbs), '.build');
if (!existsSync(buildDir)) mkdirSync(buildDir, { recursive: true });

const clips = [];
const durationsMs = [];
const total = resolved.length;

console.log(`🎬 Proyecto: ${projectName} (${project.width}x${project.height} @ ${project.fps}fps)`);

// ── 5. Procesar cada escena en orden ──
for (let i = 0; i < total; i++) {
  const scenePath = resolved[i];
  const scene = project.scenes[i];
  const name = basename(scenePath);
  const clipPath = join(buildDir, `clip_${String(i).padStart(2, '0')}.mp4`);

  if (isHtmlFile(scenePath)) {
    console.log(`  [${i + 1}/${total}] ${name} → capturando HTML (timecut)...`);
    try {
      const d = captureHtml({ scenePath, clipPath, scene, project, width: project.width, height: project.height, fps: project.fps });
      durationsMs.push(d);
      console.log(`  [${i + 1}/${total}] ${name} → timecut ✓ (${(d / 1000).toFixed(1)}s)`);
    } catch (err) {
      console.error(`  [${i + 1}/${total}] ${name} → ❌ ${err.message}`);
      process.exit(1);
    }
  } else if (isVideoFile(scenePath)) {
    const opts = { width: project.width, height: project.height, fps: project.fps, fit: scene.fit, zoom: scene.zoom, from: scene.from, to: scene.to, speed: scene.speed };
    const desc = [
      `fit=${scene.fit}`,
      scene.from != null || scene.to != null ? `recorte ${scene.from ?? 0}→${scene.to ?? 'fin'}s` : '',
      scene.zoom ? `zoom ${scene.zoom.from}→${scene.zoom.to}` : '',
      scene.speed !== 1 ? `speed ${scene.speed}x` : ''
    ].filter(Boolean).join(', ');
    console.log(`  [${i + 1}/${total}] ${name} → normalizando vídeo...`);
    normalizeClip(FFMPEG, FFPROBE, scenePath, clipPath, opts);
    const d = probeDurationMs(FFPROBE, clipPath);
    if (!d) { console.error(`  [${i + 1}/${total}] ${name} → ❌ no se pudo medir duración del clip`); process.exit(1); }
    durationsMs.push(d);
    console.log(`  [${i + 1}/${total}] ${name} → normalizado ✓ (${(d / 1000).toFixed(1)}s, ${desc})`);
  } else {
    console.error(`  [${i + 1}/${total}] ${name} → ❌ tipo no soportado (solo .html y vídeo)`);
    process.exit(1);
  }

  clips.push(clipPath);
}

// ── 6. Concatenar en orden ──
if (project.transitions) {
  console.log(`\n🔗 Concatenando ${clips.length} clips con ${project.transitions.length} transiciones → ${outputAbs}`);
  concatWithTransitions(FFMPEG, clips, outputAbs, {
    fps: project.fps,
    transitions: project.transitions,
    durationsMs
  });
} else {
  console.log(`\n🔗 Concatenando ${clips.length} clips → ${outputAbs}`);
  concatClips(FFMPEG, clips, outputAbs);
}

// ── 7. Limpieza ──
try { rmSync(buildDir, { recursive: true, force: true }); } catch {}

console.log(`\n✅ Vídeo generado: ${outputAbs}`);
