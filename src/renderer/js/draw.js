// Отрисовка на холсте: живой фон, кнопка подключения, фирменный знак и
// мини-графики. Формулы перенесены из Glass.swift, BlobConnectButton.swift,
// Wordmark.swift и LatencyCard.swift без изменений.

import { css, hex } from './theme.js';

/**
 * Органическое пятно. Радиус гуляет по двум гармоникам, точки соединяются
 * квадратичными кривыми через середины отрезков — контур гладкий.
 * Множитель у `phase` обязан быть целым, иначе пятно дёргается раз за цикл.
 */
export function blobPath(ctx, cx, cy, radius, phase, wobble) {
  const points = 20;
  const pts = [];
  for (let i = 0; i < points; i++) {
    const theta = (i / points) * 2 * Math.PI;
    const r = radius * (1
      + wobble * 0.11 * Math.sin(3 * theta + phase)
      + wobble * 0.06 * Math.sin(5 * theta - phase * 2));
    pts.push([cx + r * Math.cos(theta), cy + r * Math.sin(theta)]);
  }
  const first = pts[0];
  const last = pts[points - 1];
  ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  for (let i = 0; i < points; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % points];
    ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2);
  }
  ctx.closePath();
}

/** Холст под текущую плотность пикселей; возвращает контекст в логических единицах. */
export function prepare(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// ---------------------------------------------------------------------------
// Живой фон: «северное сияние» (ObsidianBackground в Glass.swift)
// ---------------------------------------------------------------------------

/**
 * Несколько вытянутых мягких световых лент, которые медленно плывут,
 * поворачиваются и дышат поверх тёмного поля. На тёмных темах ленты
 * складываются светом (там, где пересекаются, ярче), сверху — едва заметное
 * зерно, чтобы градиенты не шли полосами. Раскладка — в долях окна.
 */
const RIBBONS = [
  { x: 0.80, y: 0.16, driftX: 0.10, driftY: 0.06, length: 1.05, thickness: 0.36, angle: -0.45, sway: 0.25, period: 23, phase: 0.0, tone: 0, alpha: 0.55 },
  { x: 0.32, y: 0.88, driftX: 0.12, driftY: 0.05, length: 1.10, thickness: 0.32, angle: 0.30, sway: 0.20, period: 29, phase: 1.7, tone: 1, alpha: 0.50 },
  { x: 0.64, y: 0.62, driftX: 0.14, driftY: 0.08, length: 0.80, thickness: 0.22, angle: -0.15, sway: 0.35, period: 19, phase: 3.1, tone: 2, alpha: 0.32 },
  { x: 0.14, y: 0.22, driftX: 0.08, driftY: 0.08, length: 0.70, thickness: 0.22, angle: 0.80, sway: 0.30, period: 25, phase: 4.4, tone: 0, alpha: 0.22 },
  { x: 0.96, y: 0.78, driftX: 0.06, driftY: 0.10, length: 0.70, thickness: 0.26, angle: 1.15, sway: 0.22, period: 31, phase: 2.5, tone: 1, alpha: 0.34 }
];

/** Плитка шума для зерна. Генерируется один раз, детерминированно. */
let grainTile = null;
function grain() {
  if (grainTile) return grainTile;
  const side = 160;
  const tile = document.createElement('canvas');
  tile.width = side;
  tile.height = side;
  const ctx = tile.getContext('2d');
  const image = ctx.createImageData(side, side);
  let seed = 0x9E3779B97F4A7C15n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < side * side; i++) {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & mask;
    const value = Number(seed >> 56n);
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  grainTile = tile;
  return tile;
}

export function drawBackground(canvas, p, time, still) {
  const { ctx, w, h } = prepare(canvas);
  const t0 = still ? 0 : time;
  ctx.fillStyle = css(p.background);
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = p.isDark ? 'lighter' : 'source-over';
  for (const ribbon of RIBBONS) {
    const t = (t0 / ribbon.period + ribbon.phase) * 2 * Math.PI;
    const cx = (ribbon.x + ribbon.driftX * Math.sin(t)) * w;
    const cy = (ribbon.y + ribbon.driftY * Math.sin(t * 0.7 + 1.1)) * h;
    const angle = ribbon.angle + ribbon.sway * Math.sin(t * 0.5);
    const breathe = 1 + 0.12 * Math.sin(t * 1.3);
    const color = p.orbs[ribbon.tone] || p.orbs[0];
    const alpha = p.isDark ? Math.min(1, ribbon.alpha * 1.45) : ribbon.alpha * 0.7;

    // Единичный круг, растянутый в эллипс: радиальный градиент
    // растягивается вместе с ним и даёт мягкую ленту без размытия.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.scale((ribbon.length * w) / 2 * breathe, (ribbon.thickness * h) / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, css(color, alpha));
    g.addColorStop(0.45, css(color, alpha * 0.45));
    g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // Зерно поверх лент.
  ctx.save();
  ctx.globalAlpha = p.isDark ? 0.05 : 0.06;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(grain(), 'repeat');
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // Края притушены, середина остаётся спокойной под карточками.
  const vx = w * 0.6;
  const vy = h * 0.45;
  const v = ctx.createRadialGradient(vx, vy, 180, vx, vy, 700);
  v.addColorStop(0, css(p.background, 0));
  v.addColorStop(1, css(p.background, p.isDark ? 0.42 : 0.3));
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Фирменный знак: органическая капля с круглым вырезом
// ---------------------------------------------------------------------------

export function drawMark(canvas, colors, wobble = 0.8, phase = 0.6) {
  const { ctx, w, h } = prepare(canvas);
  const cx = w / 2;
  const cy = h / 2;
  const radius = (Math.min(w, h) / 2) * 0.92;
  ctx.beginPath();
  blobPath(ctx, cx, cy, radius, phase, wobble);
  const holeRadius = radius * 0.16;
  const holeDistance = radius * 0.55;
  const angle = (-55 * Math.PI) / 180;
  const hx = cx + holeDistance * Math.cos(angle);
  const hy = cy + holeDistance * Math.sin(angle);
  ctx.moveTo(hx + holeRadius, hy);
  ctx.arc(hx, hy, holeRadius, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, css(colors[0]));
  g.addColorStop(1, css(colors[1]));
  ctx.fillStyle = g;
  // Правило чётности: круг внутри капли даёт настоящую дырку.
  ctx.fill('evenodd');
}

// ---------------------------------------------------------------------------
// Кнопка подключения
// ---------------------------------------------------------------------------

export const AMPLITUDES = {
  disconnected: { rotation: 4, scale: 0.035, wobble: 0.55, halo: 0.16 },
  connecting: { rotation: 8, scale: 0.075, wobble: 1.35, halo: 0.26 },
  connected: { rotation: 2, scale: 0.020, wobble: 0.55, halo: 0.13 },
  failed: { rotation: 1, scale: 0.015, wobble: 0.30, halo: 0.10 }
};

export function lerpAmps(a, b, t) {
  return {
    rotation: a.rotation + (b.rotation - a.rotation) * t,
    scale: a.scale + (b.scale - a.scale) * t,
    wobble: a.wobble + (b.wobble - a.wobble) * t,
    halo: a.halo + (b.halo - a.halo) * t
  };
}

/** Зацикленная фаза 0…2π с постоянным периодом. */
const phaseOf = (time, period) => ((time % period) / period) * 2 * Math.PI;

const WHITE = hex(0xFFFFFF);

/**
 * `state` — disconnected | connecting | connected | failed;
 * `amps` — текущие амплитуды (плавно меняются при смене состояния);
 * `sparkleAge` — секунды с момента подключения или null.
 */
export function drawConnect(canvas, p, state, amps, time, sparkleAge, unit) {
  const { ctx, w, h } = prepare(canvas);
  const cx = w / 2;
  const cy = h / 2;
  const half = Math.min(w, h) / 2;

  const isFailed = state === 'failed';
  const isConnected = state === 'connected';
  // На AMOLED кнопка в покое обязана быть чёрной — в этом и смысл темы.
  const isAmoledIdle = p.id === 'amoled' && !isConnected && !isFailed;

  const haloColor = isFailed ? p.bad : isAmoledIdle ? hex(0x2A2A31) : p.accentStart;
  const fillColors = isFailed ? [p.bad, p.bad]
    : isConnected ? [p.good, p.accentEnd]
      : isAmoledIdle ? [hex(0x0D0D10), hex(0x000000)]
        : [p.accentStart, p.accentEnd];
  const glyphColor = isAmoledIdle ? p.textPrimary : p.background;

  const breathe = phaseOf(time, 3.2);
  const haloPhase = phaseOf(time, 3.0);
  const gradientAngle = phaseOf(time, 5.2);
  const sheenAngle = phaseOf(time, 3.8);
  const orbitAngle = phaseOf(time, 0.85);
  const spinnerAngle = phaseOf(time, 0.75);

  // Ореол. 0.70 + 0.26 в пике даёт 0.96 от половины стороны — прозрачный
  // край свечения не доходит до границы холста.
  const haloRadius = half * (0.70 + amps.halo * Math.sin(haloPhase));
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloRadius);
  halo.addColorStop(0, css(haloColor, 0.85));
  halo.addColorStop(0.55, css(haloColor, 0.50));
  halo.addColorStop(1, css(haloColor, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
  ctx.fill();

  const blobRadius = half * 0.50;

  // Тело пятна: дышит и слегка поворачивается вокруг центра.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((amps.rotation * Math.sin(breathe) * Math.PI) / 180);
  const k = 1 + amps.scale * Math.sin(breathe);
  ctx.scale(k, k);
  ctx.translate(-cx, -cy);

  const shape = new Path2D();
  blobPath(shape, cx, cy, blobRadius, breathe, amps.wobble);

  const dx = Math.cos(gradientAngle);
  const dy = Math.sin(gradientAngle);
  const body = ctx.createLinearGradient(cx - dx * blobRadius, cy - dy * blobRadius, cx + dx * blobRadius, cy + dy * blobRadius);
  body.addColorStop(0, css(fillColors[0]));
  body.addColorStop(1, css(fillColors[1]));
  ctx.fillStyle = body;
  ctx.fill(shape);

  // Блик внутри пятна: обрезан по его форме, поэтому не вылезает.
  ctx.save();
  ctx.clip(shape);
  const sx = cx + blobRadius * 0.38 * Math.cos(sheenAngle);
  const sy = cy + blobRadius * 0.38 * Math.sin(sheenAngle);
  const sr = blobRadius * 0.75;
  const sheen = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
  sheen.addColorStop(0, css(WHITE, isAmoledIdle ? 0.16 : 0.22));
  sheen.addColorStop(1, css(WHITE, 0));
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();

  // Символ внутри неподвижен: он отвечает за состояние.
  drawGlyph(ctx, state, cx, cy, blobRadius, spinnerAngle, glyphColor);

  if (state === 'connecting') {
    const orbitRadius = blobRadius + unit(26);
    const dot = unit(4);
    ctx.fillStyle = css(p.accentStart);
    for (let i = 0; i < 3; i++) {
      const a = orbitAngle + (i * 2 * Math.PI) / 3;
      ctx.beginPath();
      ctx.arc(cx + orbitRadius * Math.cos(a), cy + orbitRadius * Math.sin(a), dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Разовая вспышка искр в момент успеха.
  if (sparkleAge != null && sparkleAge > 0 && sparkleAge < 0.7) {
    const burst = sparkleAge / 0.7;
    const fade = 1 - burst;
    const travel = blobRadius + unit(30) * burst;
    ctx.fillStyle = css(WHITE, fade * 0.9);
    for (const degrees of [-70, 20, 130, 205]) {
      const a = (degrees * Math.PI) / 180;
      const r = unit(2 + 2 * burst);
      ctx.beginPath();
      ctx.arc(cx + travel * Math.cos(a), cy + travel * Math.sin(a), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Значок питания; во время подключения дуга вращается спиннером. */
function drawGlyph(ctx, state, cx, cy, radius, spin, color) {
  const r = radius * 0.38;
  ctx.save();
  ctx.lineWidth = r * 0.26;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = css(color);
  ctx.beginPath();
  const deg = (d) => (d * Math.PI) / 180;
  switch (state) {
    case 'connecting':
      ctx.translate(cx, cy);
      ctx.rotate(spin);
      ctx.arc(0, 0, r, deg(-90), deg(170), false);
      break;
    case 'connected':
      ctx.moveTo(cx - r * 0.55, cy + r * 0.05);
      ctx.lineTo(cx - r * 0.10, cy + r * 0.50);
      ctx.lineTo(cx + r * 0.65, cy - r * 0.45);
      break;
    case 'failed': {
      const a = r * 0.5;
      ctx.moveTo(cx - a, cy - a);
      ctx.lineTo(cx + a, cy + a);
      ctx.moveTo(cx + a, cy - a);
      ctx.lineTo(cx - a, cy + a);
      break;
    }
    default:
      ctx.arc(cx, cy, r, deg(-55), deg(235), false);
      ctx.moveTo(cx, cy - r * 1.25);
      ctx.lineTo(cx, cy - r * 0.15);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Мини-график задержки
// ---------------------------------------------------------------------------

export function drawSparkline(canvas, values, low, high, line, endpoint) {
  const { ctx, w, h } = prepare(canvas);

  ctx.strokeStyle = css(line, 0.14);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(w, h - 0.5);
  ctx.stroke();

  const inset = 4;
  const position = (value) => {
    const span = Math.max(1, high - low);
    return inset + (h - inset * 2) * ((value - low) / span);
  };
  const dot = (x, y) => {
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(endpoint);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  };

  if (values.length < 2 || !(high > low)) {
    if (values.length) dot(w - 3, position(values[values.length - 1]));
    return;
  }

  const points = values.map((v, i) => [(i * w) / (values.length - 1), position(v)]);

  // Заливка под линией задаёт объём.
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, css(line, 0.26));
  fill.addColorStop(1, css(line, 0.02));
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(points[0][0], h);
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.lineTo(points[points.length - 1][0], h);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = css(line, 0.85);
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();

  const last = points[points.length - 1];
  dot(last[0], last[1]);
}
