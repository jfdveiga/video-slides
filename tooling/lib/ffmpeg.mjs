import { execSync, execFileSync } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import { join } from 'path';

// ── Detección de FFmpeg (reutiliza el enfoque de record.mjs) ──
export function findFFmpeg() {
  const common = [
    'ffmpeg',
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-8.1.1-essentials_build', 'bin', 'ffmpeg.exe'),
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'FFmpeg.Essentials_Build_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-7.1-full_build', 'bin', 'ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'
  ];
  for (const p of common) {
    try { execSync(`"${p}" -version`, { stdio: 'ignore' }); return p; } catch {}
  }
  return null;
}

export function findFFprobe(ffmpeg) {
  if (!ffmpeg) return null;
  if (ffmpeg === 'ffmpeg') return 'ffprobe';
  return ffmpeg.replace(/ffmpeg\.exe$/i, 'ffprobe.exe');
}

// ── Ejecución ──
export function runFFmpeg(ffmpeg, args) {
  execFileSync(ffmpeg, args, { stdio: 'ignore' });
}

// ── Probes ──
export function hasAudioStream(ffprobe, input) {
  if (!ffprobe) return false;
  try {
    const out = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', input], { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

// Duración en ms de un archivo de vídeo (null si no se puede probar).
export function probeDurationMs(ffprobe, input) {
  if (!ffprobe) return null;
  try {
    const out = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input], { encoding: 'utf8' });
    const d = parseFloat(out.trim());
    return Number.isFinite(d) ? d * 1000 : null;
  } catch {
    return null;
  }
}

// Construye el filtro de vídeo según fit (contain|cover), zoom (Ken Burns) y speed.
function buildVf({ width, height, fps, fit, zoom, frames, speed }) {
  const pre = speed && speed !== 1 ? `setpts=PTS/${speed},` : '';
  const fitVf = fit === 'cover'
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  if (!zoom) return `${pre}${fitVf},fps=${fps},format=yuv420p`;
  const { from, to } = zoom;
  const z = `'${from}+(${to}-${from})*on/${frames}'`;
  return `${pre}${fitVf},zoompan=z=${z}:d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps},format=yuv420p`;
}

// ── Normalización de un clip de vídeo existente ──
// Salida: libx264, yuv420p, fps fijo, resolución exacta (pad o crop), audio AAC 48kHz estéreo.
// fit: 'contain' (letterbox) | 'cover' (crop centrado). zoom: { from, to } → Ken Burns.
// from/to (segundos) → recorta el clip. speed → cámara lenta/acelerada (0.5–2).
export function normalizeClip(ffmpeg, ffprobe, input, output, { width, height, fps, fit = 'contain', zoom = null, from = null, to = null, speed = 1 }) {
  const needsProbe = zoom || from != null || to != null;
  const srcMs = needsProbe ? probeDurationMs(ffprobe, input) : null;
  if (needsProbe && !srcMs) throw new Error(`❌ from/to/zoom requieren ffprobe para medir duración de ${input}`);

  const trimStart = from != null ? from : 0;
  const trimEnd = to != null ? to : (srcMs != null ? srcMs / 1000 : null);
  const trimmedSec = (srcMs != null && trimEnd != null) ? Math.max(0, trimEnd - trimStart) : null;
  const frames = zoom ? Math.max(1, Math.round((trimmedSec / (speed || 1)) * fps)) : 0;
  const vf = buildVf({ width, height, fps, fit, zoom, frames, speed });

  // -ss/-t como opciones de INPUT: recortan limpiamente la lectura del clip.
  const base = ['-y'];
  if (from != null) base.push('-ss', String(from));
  if (to != null) base.push('-t', String(to - trimStart));
  base.push('-i', input);

  const hasAudio = hasAudioStream(ffprobe, input);
  const map = hasAudio
    ? ['-map', '0:v:0', '-map', '0:a:0']
    : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-map', '0:v:0', '-map', '1:a:0', '-shortest'];
  const args = [
    ...base,
    ...map,
    '-vf', vf,
    ...(hasAudio && speed !== 1 ? ['-filter:a', `atempo=${speed}`] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'main', '-bf', '0', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    output
  ];
  runFFmpeg(ffmpeg, args);
}

// ── Frames PNG → MP4 normalizado (escenas HTML) ──
// Mismo formato de salida que normalizeClip para poder concatenar con -c copy.
export function framesToMp4(ffmpeg, framesDir, output, { fps, width, height }) {
  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', join(framesDir, 'frame_%04d.png'),
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-map', '0:v:0', '-map', '1:a:0', '-shortest',
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'main', '-bf', '0', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    output
  ];
  runFFmpeg(ffmpeg, args);
}

// ── Concatenación (concat demuxer, -c copy) ──
// Requiere clips ya normalizados con streams idénticos.
export function concatClips(ffmpeg, clips, output) {
  const listPath = join(process.cwd(), '.concat.txt');
  const lines = clips.map(c => `file '${c.replace(/'/g, "'\\''")}'`);
  writeFileSync(listPath, lines.join('\n') + '\n', 'utf8');
  try {
    runFFmpeg(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', output]);
  } finally {
    try { rmSync(listPath, { force: true }); } catch {}
  }
}

// ── Concatenación con transiciones (xfade) ──
// Re-encodea: encadena n-1 xfade entre clips. Audio: silencio global (anullsrc).
// durationsMs: duración de cada clip normalizado (para calcular offsets).
export function concatWithTransitions(ffmpeg, clips, output, { fps, transitions, durationsMs }) {
  const n = clips.length;
  const dur = durationsMs.map(d => d / 1000);
  const offsets = [];
  let cumDur = 0, cumTrans = 0;
  for (let i = 0; i < n - 1; i++) {
    cumDur += dur[i];
    cumTrans += transitions[i].duration;
    offsets.push(cumDur - cumTrans);
  }
  const totalDur = dur.reduce((a, b) => a + b, 0) - transitions.reduce((a, t) => a + t.duration, 0);
  console.log(`   duraciones(s): ${dur.map(d => d.toFixed(2)).join(', ')}`);
  console.log(`   offsets(s):    ${offsets.map(o => o.toFixed(2)).join(', ')}`);
  console.log(`   totalDur(s):   ${totalDur.toFixed(2)}`);

  const args = ['-y'];
  for (const c of clips) args.push('-i', c);
  args.push('-f', 'lavfi', '-t', totalDur.toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');

  let fc = '';
  let prev = '[0:v]';
  for (let i = 0; i < n - 1; i++) {
    const out = i === n - 2 ? '[vout]' : `[v${i}]`;
    fc += `${prev}[${i + 1}:v]xfade=transition=${transitions[i].type}:duration=${transitions[i].duration}:offset=${offsets[i].toFixed(3)}${out};`;
    prev = out;
  }
  args.push('-filter_complex', fc);
  args.push('-map', '[vout]', '-map', `${n}:a`, '-shortest');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'main', '-bf', '0', '-pix_fmt', 'yuv420p', '-r', String(fps));
  args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2');
  args.push('-movflags', '+faststart');
  args.push(output);
  runFFmpeg(ffmpeg, args);
}