// Отрисовка на холсте: живой фон, кнопка подключения, фирменный знак и
// мини-графики. Формулы перенесены из HUDBackground.swift, ConnectSlab.swift,
// HUDShapes.swift и LatencyCard.swift без изменений.

import { css, mix, hex } from './theme.js';

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
// Живой фон
// ---------------------------------------------------------------------------

const BLOBS = [
  { restX: 0.16, restY: 0.14, radius: 0.60, drift: 0.16, period: 11, phase: 0, colorPeriod: 14, colorPhase: 0 },
  { restX: 0.88, restY: 0.28, radius: 0.50, drift: 0.14, period: 13, phase: 2.1, colorPeriod: 17, colorPhase: 3.5 },
  { restX: 0.24, restY: 0.80, radius: 0.66, drift: 0.15, period: 15, phase: 4.2, colorPeriod: 20, colorPhase: 1.7 },
  { restX: 0.82, restY: 0.86, radius: 0.44, drift: 0.13, period: 9, phase: 5.6, colorPeriod: 12, colorPhase: 5.0 }
];

/** Круг оттенков, по которому переливается каждое пятно. */
function cycleColors(p) {
  const list = [p.blob1, p.blob2, p.blob3];
  if (p.isDark) return list.map((c) => mix(c, p.accentStart, 0.55)).concat([mix(p.blob1, p.accentEnd, 0.55)]);
  return list.concat([mix(p.blob2, p.accentStart, 0.35)]);
}

function blended(colors, position) {
  const segment = position * colors.length;
  const index = Math.min(Math.max(Math.floor(segment), 0), colors.length - 1);
  const next = (index + 1) % colors.length;
  return mix(colors[index], colors[next], segment - index);
}

/**
 * Четыре мягких пятна, которые дрейфуют, дышат и переливаются цветами темы.
 * Амплитуда считается от размера окна. На тёмных темах к пятнам
 * подмешивается акцентный цвет — переливание должно читаться и на чёрном.
 */
export function drawBackground(canvas, p, time, still) {
  const { ctx, w, h } = prepare(canvas);
  ctx.fillStyle = css(p.background);
  ctx.fillRect(0, 0, w, h);

  const cycle = cycleColors(p);
  const alpha = p.isDark ? 0.5 : 0.68;
  const minDim = Math.min(w, h);

  for (const blob of BLOBS) {
    const t = still ? 0 : (time / blob.period + blob.phase) * 2 * Math.PI;
    const driftPx = blob.drift * minDim;
    const cx = blob.restX * w + Math.sin(t) * driftPx;
    const cy = blob.restY * h + Math.sin(t * 0.8 + 1.3) * driftPx;
    const pulse = still ? 0 : Math.sin(t * 1.3);
    const radius = blob.radius * minDim * (1 + pulse * 0.08);
    const position = ((time / blob.colorPeriod + blob.colorPhase) % 1 + 1) % 1;
    const color = still ? cycle[0] : blended(cycle, position);

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, css(color, alpha));
    g.addColorStop(0.7, css(color, alpha * 0.5));
    g.addColorStop(1, css(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Виньетка притушивает края, чтобы карточки в центре читались даже когда
  // пятно проходит прямо под ними.
  const cx = w / 2;
  const cy = h / 2;
  const v = ctx.createRadialGradient(cx, cy, 90, cx, cy, 560);
  v.addColorStop(0, css(p.background, 0));
  v.addColorStop(0.5, css(p.background, 0));
  v.addColorStop(1, css(p.background, 0.55));
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
