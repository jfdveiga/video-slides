import { chromium } from 'playwright';
import { readdirSync, renameSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORK_DIR = join(__dirname, 'work');
const OUTPUT_DIR = join(WORK_DIR, 'output');

// ---- init: crear HTML de ejemplo ----
if (process.argv[2] === '--init') {
  const num = process.argv[3] || '1';
  const file = `publicacion-${num}.html`;
  const path = join(WORK_DIR, file);

  if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR, { recursive: true });

  writeFileSync(path, `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Video ${num} — Ejemplo</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000}
.video-container{position:relative;width:100%;max-width:608px;height:100vh;max-height:1080px;margin:0 auto;overflow:hidden;background:#000}
.text-layer{position:absolute;top:0;left:0;width:100%;height:100%;z-index:2;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:2rem;text-align:center}
.text-line{font-family:'Poppins',sans-serif;font-weight:300;font-size:clamp(1.15rem,4.2vw,1.5rem);color:#fff;opacity:0;position:absolute;top:46%;left:50%;transform:translate(-50%,-50%);width:82%;max-width:460px;line-height:1.7;letter-spacing:.03em;transition:opacity .8s ease-out}
.text-line.typewriter::after{content:'|';display:inline-block;animation:blink .7s step-end infinite;color:rgba(255,255,255,0.7);font-weight:300;margin-left:2px}
.text-line.typewriter.done::after{display:none}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.logo-area{position:absolute;top:45%;left:50%;transform:translate(-50%,-50%);z-index:3;opacity:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:1.5rem}
.logo-area.show{animation:logoRotateIn .9s ease-out forwards}
@keyframes logoRotateIn{0%{opacity:0;transform:translate(-50%,-50%) rotate(-8deg) scale(.6)}100%{opacity:1;transform:translate(-50%,-50%) rotate(0deg) scale(1)}}
.logo-text{font-family:'Poppins',sans-serif;font-size:clamp(2.5rem,8vw,4rem);font-weight:600;color:#fff;letter-spacing:-.02em}
.logo-dot{color:#3b82f6}
.bottom-info{position:absolute;bottom:8rem;left:0;width:100%;text-align:center;z-index:4;opacity:0}
.bottom-tagline{font-family:'Poppins',sans-serif;font-weight:300;font-size:clamp(1.1rem,3.2vw,1.5rem);color:#fff;letter-spacing:.15em;margin-bottom:1rem}
.bottom-url{font-family:'Poppins',sans-serif;font-weight:300;font-size:clamp(.7rem,2vw,.85rem);color:rgba(255,255,255,0.4);letter-spacing:.25em}
.progress-bar{position:absolute;bottom:3%;left:0;height:2px;z-index:10;background:rgba(255,255,255,0.15);width:0;border-radius:0 2px 2px 0}
</style>
</head>
<body>
<div class="video-container" id="app">
<div class="text-layer">
<div class="text-line typewriter" id="line1">Crea contenido que conecte.</div>
<div class="text-line typewriter" id="line2">Una línea a la vez.</div>
</div>
<div class="logo-area" id="logoArea">
  <div class="logo-text">mi<span class="logo-dot">.</span>marca</div>
</div>
<div class="bottom-info" id="bottomInfo">
<div class="bottom-tagline">Ideas que inspiran.</div>
<div class="bottom-url">2026 · mimarca.com</div>
</div>
<div class="progress-bar" id="progressBar"></div>
</div>
<script>
(function(){
'use strict';
const SPEED=30,VARIANCE=8;
const TEXT1='Crea contenido que conecte.';
const TEXT2='Una línea a la vez.';
const line1=document.getElementById('line1'),line2=document.getElementById('line2'),logoArea=document.getElementById('logoArea'),bottomInfo=document.getElementById('bottomInfo'),progressBar=document.getElementById('progressBar');
function typeText(el,text,startDelay,onDone){el.textContent='';el.style.opacity='1';let i=0;const type=()=>{if(i<text.length){el.textContent+=text.charAt(i);i++;setTimeout(type,SPEED+(Math.random()-.5)*2*VARIANCE)}else if(onDone){el.classList.add('done');setTimeout(onDone,0)}};setTimeout(type,startDelay*1e3)}
function fadeIn(el,duration,delay){setTimeout(()=>{el.style.transition=\`opacity \${duration}s ease-out\`;el.style.opacity='1'},delay*1e3)}
function startTimeline(){
typeText(line1,TEXT1,.3,()=>{setTimeout(()=>{typeText(line2,TEXT2,0,()=>{setTimeout(()=>{line2.style.opacity='0';logoArea.classList.add('show');logoArea.style.opacity='1';fadeIn(bottomInfo,.6,.35)},1800)});line1.style.opacity='0'},1200)})}
function animateProgress(){const start=performance.now(),duration=8500;function tick(now){const pct=Math.min(1,(now-start)/duration);progressBar.style.width=(pct*100)+'%';if(pct<1)requestAnimationFrame(tick)}requestAnimationFrame(tick)}
let started=false;
document.addEventListener('click',function(){if(started)return;started=true;startTimeline();animateProgress()});
})();
</script>
</body>
</html>`);

  console.log(`✅ Creado ${path}`);
  process.exit(0);
}

// ---- grabación ----
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

// Buscar ffmpeg (para convertir .webm → .mp4)
function findFFmpeg() {
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
const FFMPEG = findFFmpeg();
if (!FFMPEG) console.log('  ⚠️  ffmpeg no encontrado — solo .webm');

// Filtro opcional: node record.mjs 1
const filter = process.argv[2];

let files = readdirSync(WORK_DIR)
  .filter(f => /^publicacion-\d+\.html$/.test(f))
  .map(f => f.replace('.html', ''))
  .sort((a, b) => {
    const na = parseInt(a.replace('publicacion-', ''));
    const nb = parseInt(b.replace('publicacion-', ''));
    return na - nb;
  });

if (filter) files = files.filter(f => f === `publicacion-${filter}`);

if (files.length === 0) {
  console.log('❌ No se encontraron publicacion-*.html en work/');
  process.exit(1);
}

console.log(`🎬 Grabando ${files.length} videos...\n`);

for (const name of files) {
  console.log(`  [${name}] grabando...`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 608, height: 1080 },
    colorScheme: 'dark',
    recordVideo: { dir: OUTPUT_DIR, size: { width: 608, height: 1080 } }
  });
  const page = await context.newPage();

  // Forzar fondo negro desde antes del primer paint
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = 'html, body { background: #000 !important; }';
    document.head.appendChild(style);
  });

  const filePath = `file://${join(WORK_DIR, name)}.html`;
  await page.goto(filePath, { waitUntil: 'networkidle' });

  // Esperar a que las fuentes se carguen
  await page.evaluate(() => document.fonts.ready);

  // Pausa breve para estabilizar el frame inicial
  await page.waitForTimeout(500);

  // Simular clic para iniciar la animación
  await page.mouse.click(304, 540);

  try {
    // Esperar a que la barra de progreso llegue al 100%
    await page.waitForFunction(() => {
      const bar = document.querySelector('.progress-bar');
      if (!bar) return false;
      const w = parseFloat(bar.style.width);
      return w >= 100;
    }, { timeout: 20000 });

    // Logo final visible un momento extra
    await page.waitForTimeout(1000);
    console.log(`  [${name}] ✅ listo`);
  } catch (err) {
    console.log(`  [${name}] ⚠️  timeout`);
  }

  await context.close();
  await browser.close();

  // Renombrar webm
  const outputFiles = readdirSync(OUTPUT_DIR);
  const webm = outputFiles.find(f => f.endsWith('.webm') && !f.startsWith(name));
  if (webm) {
    const webmPath = join(OUTPUT_DIR, webm);
    const namedWebm = join(OUTPUT_DIR, `${name}.webm`);
    renameSync(webmPath, namedWebm);

    // Convertir a MP4 y eliminar .webm
    if (FFMPEG) {
      const mp4Path = join(OUTPUT_DIR, `${name}.mp4`);
      try {
        execSync(
          `"${FFMPEG}" -i "${namedWebm}" -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart "${mp4Path}" -y`,
          { stdio: 'ignore' }
        );
        try { execSync(`del /f /q "${namedWebm}"`, { stdio: 'ignore' }); } catch {}
        console.log(`  [${name}]   └─ mp4 generado ✓ (webm eliminado)`);
      } catch {
        console.log(`  [${name}]   └─ ⚠️  error al convertir a mp4`);
      }
    }
  }
}

console.log(`\n✅ Todos los videos en work/output/`);
