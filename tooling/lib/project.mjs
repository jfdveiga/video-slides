import { readFileSync, existsSync } from 'fs';
import { join, resolve, extname } from 'path';

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v']);
const HTML_EXTS = new Set(['.html', '.htm']);
const FIT_OPTIONS = new Set(['contain', 'cover']);
const RENDER_MODES = new Set(['auto', 'deterministic', 'realtime']);
const TRANSITION_TYPES = new Set([
  'fade', 'fadeblack', 'fadewhite', 'dissolve', 'pixelize', 'radial',
  'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'wipetl', 'wipetr', 'wipebl', 'wipebr',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'circleopen', 'circleclose', 'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
  'distance', 'hblur', 'zoomin'
]);

export const DEFAULTS = { fps: 30, width: 608, height: 1080 };

export function isVideoFile(p) {
  return VIDEO_EXTS.has(extname(p).toLowerCase());
}

export function isHtmlFile(p) {
  return HTML_EXTS.has(extname(p).toLowerCase());
}

// Normaliza cada escena: string → { src, fit, zoom, from, to, speed, render }.
export function normalizeScenes(scenes) {
  return scenes.map((s, i) => {
    if (typeof s === 'string') return { src: s, fit: 'contain', zoom: null, from: null, to: null, speed: 1, render: 'auto' };
    if (s && typeof s === 'object' && typeof s.src === 'string') {
      const fit = s.fit || 'contain';
      if (!FIT_OPTIONS.has(fit)) throw new Error(`❌ escena ${i}: fit inválido "${fit}" (contain|cover)`);
      let zoom = null;
      if (s.zoom != null) {
        if (typeof s.zoom !== 'object' || typeof s.zoom.from !== 'number' || typeof s.zoom.to !== 'number') {
          throw new Error(`❌ escena ${i}: zoom debe ser { from, to } (números)`);
        }
        zoom = { from: s.zoom.from, to: s.zoom.to };
      }
      let from = null, to = null;
      if (s.from != null) { if (typeof s.from !== 'number' || s.from < 0) throw new Error(`❌ escena ${i}: "from" debe ser número ≥ 0`); from = s.from; }
      if (s.to != null) { if (typeof s.to !== 'number' || s.to <= 0) throw new Error(`❌ escena ${i}: "to" debe ser número > 0`); to = s.to; }
      if (from != null && to != null && to <= from) throw new Error(`❌ escena ${i}: "to" (${to}) debe ser mayor que "from" (${from})`);
      let speed = 1;
      if (s.speed != null) { if (typeof s.speed !== 'number' || s.speed < 0.5 || s.speed > 2) throw new Error(`❌ escena ${i}: "speed" debe ser número entre 0.5 y 2`); speed = s.speed; }
      const render = s.render || 'auto';
      if (!RENDER_MODES.has(render)) throw new Error(`❌ escena ${i}: "render" inválido "${render}" (${[...RENDER_MODES].join('|')})`);
      return { src: s.src, fit, zoom, from, to, speed, render };
    }
    throw new Error(`❌ escena ${i}: debe ser string o { src, fit?, zoom?, from?, to?, speed?, render? }`);
  });
}

// Valida una transición individual { type, duration }.
function validateTransition(t, i) {
  const label = i >= 0 ? `transición ${i}` : 'transición';
  if (!t || typeof t !== 'object' || typeof t.type !== 'string' || typeof t.duration !== 'number' || t.duration <= 0) {
    throw new Error(`❌ ${label}: debe ser { type, duration } con duration > 0`);
  }
  if (!TRANSITION_TYPES.has(t.type)) {
    throw new Error(`❌ ${label}: tipo "${t.type}" no soportado (${[...TRANSITION_TYPES].join(', ')})`);
  }
  return { type: t.type, duration: t.duration };
}

// Acepta:
//   ausente / null / "none"        → sin transiciones (corte seco, concat -c copy)
//   { type, duration }             → la misma transición en todos los cortes
//   [{ type, duration }, ...]      → una por corte (exactamente n-1)
export function parseTransitions(raw, sceneCount) {
  const gaps = sceneCount - 1;
  if (raw == null) return null;
  if (typeof raw === 'string') {
    if (raw.toLowerCase() === 'none') return null;
    throw new Error(`❌ "transitions" string solo admite "none" (recibido "${raw}")`);
  }
  if (gaps <= 0) return null;
  if (Array.isArray(raw)) {
    if (raw.length !== gaps) {
      throw new Error(`❌ "transitions" debe tener ${gaps} entradas (n-1), tiene ${raw.length}`);
    }
    return raw.map(validateTransition);
  }
  if (typeof raw === 'object') {
    const t = validateTransition(raw, -1);
    return Array.from({ length: gaps }, () => t);
  }
  throw new Error('❌ "transitions" debe ser array, objeto { type, duration } o "none"');
}

// Localiza videos/projects/<name>/video.json y lo parsea.
export function loadProject(projectsRoot, name) {
  const projectDir = join(projectsRoot, name);
  const jsonPath = join(projectDir, 'video.json');
  if (!existsSync(jsonPath)) {
    throw new Error(`❌ No existe el proyecto "${name}": falta ${jsonPath}`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    throw new Error(`❌ video.json inválido en ${jsonPath}: ${e.message}`);
  }
  if (!Array.isArray(raw.scenes) || raw.scenes.length === 0) {
    throw new Error(`❌ video.json debe tener "scenes" (array no vacío): ${jsonPath}`);
  }
  const scenes = normalizeScenes(raw.scenes);
  return {
    projectDir,
    jsonPath,
    output: raw.output || 'output/final.mp4',
    fps: raw.fps || DEFAULTS.fps,
    width: raw.width || DEFAULTS.width,
    height: raw.height || DEFAULTS.height,
    duration: raw.duration, // fallback opcional (s) si el HTML no expone __SCENE_DURATION_MS
    scenes,
    transitions: parseTransitions(raw.transitions, scenes.length)
  };
}

// Resuelve cada escena relativa al directorio del video.json.
export function resolveScenes(projectDir, scenes) {
  return scenes.map(s => resolve(projectDir, s));
}

// Valida existencia de todas las escenas. Devuelve lista de faltantes (vacía si todo ok).
export function validateScenes(resolvedScenes) {
  const missing = [];
  for (const p of resolvedScenes) {
    if (!existsSync(p)) missing.push(p);
  }
  return missing;
}