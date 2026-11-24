// Border snake — orbits the art frame clockwise, then signals sketch.js to
// blend the old and new artwork together (both keep animating simultaneously).

const ROTATION_DURATION = 12;       // seconds for one full clockwise lap
const SNAKE_LENGTH_FRACTION = 0.25; // snake occupies this fraction of the perimeter
const SNAKE_SEGMENTS = 80;          // number of line-segments that make up the snake
const FADE_OUT_LEAD = 3;            // 3s = bottom-left → top-left (one full side of the frame)

let _snakeCanvas = null;
let _snakeCtx = null;
let _snakeRaf = null;
let _snakeProgress = 0;
let _snakeLastTs = null;
let _snakeColors = [];
let _snakeStrokeWidth = 1;
let _transitionTriggered = false;  // fires once per lap
let _colorRefreshAt = null;        // timestamp when snake colors should update


// ─── Public API ──────────────────────────────────────────────────────────────

function initSnake() {
  _readSettingsIntoSnake();

  if (_snakeRaf !== null) {
    cancelAnimationFrame(_snakeRaf);
    _snakeRaf = null;
  }

  _snakeProgress = 0;
  _snakeLastTs = null;
  _transitionTriggered = false;
  _colorRefreshAt = null;

  const p5Canvas = document.querySelector('canvas');
  if (!p5Canvas) {
    console.warn('snake.js: p5 canvas not found, retrying in 100ms');
    setTimeout(initSnake, 100);
    return;
  }

  let container = document.getElementById('snake-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'snake-container';
    container.style.position = 'relative';
    container.style.display = 'inline-block';
    p5Canvas.parentNode.insertBefore(container, p5Canvas);
    container.appendChild(p5Canvas);
  }

  if (!_snakeCanvas) {
    _snakeCanvas = document.createElement('canvas');
    _snakeCanvas.id = 'snake-canvas';
    _snakeCanvas.style.position = 'absolute';
    _snakeCanvas.style.top = '0';
    _snakeCanvas.style.left = '0';
    _snakeCanvas.style.pointerEvents = 'none';
    _snakeCanvas.style.zIndex = '5';
    container.appendChild(_snakeCanvas);
  }

  _snakeCanvas.width = canvasSize;
  _snakeCanvas.height = canvasSize;
  _snakeCtx = _snakeCanvas.getContext('2d');

  _snakeRaf = requestAnimationFrame(_snakeTick);
}


// ─── Internal helpers ─────────────────────────────────────────────────────────

function _readSettingsIntoSnake() {
  _snakeColors = [];
  if (settings && settings.palettes && settings.palettes.length > 0) {
    for (const palette of settings.palettes) {
      for (const c of palette.colors) {
        _snakeColors.push({ r: red(c), g: green(c), b: blue(c) });
      }
    }
  }
  if (_snakeColors.length === 0) {
    _snakeColors = [{ r: 255, g: 255, b: 255 }];
  }

  const mode = (settings && settings.lineMode) ? settings.lineMode : 'Slim';
  if (mode === 'Thick') {
    _snakeStrokeWidth = 3;
  } else if (mode === 'Slim') {
    _snakeStrokeWidth = 1.2;
  } else {
    _snakeStrokeWidth = 1.8;
  }
}


function _snakeTick(timestamp) {
  if (_snakeLastTs === null) _snakeLastTs = timestamp;
  const dt = (timestamp - _snakeLastTs) / 1000;
  _snakeLastTs = timestamp;

  _snakeProgress += dt / ROTATION_DURATION;

  // Lap wrap — reset trigger so next lap can fire
  if (_snakeProgress >= 1) {
    _snakeProgress -= 1;
    _transitionTriggered = false;
  }

  // ── Transition trigger — fires once when snake enters the lead window ─────
  const fadeOutStart = 1 - FADE_OUT_LEAD / ROTATION_DURATION;
  if (!_transitionTriggered && _snakeProgress >= fadeOutStart) {
    startArtworkTransition();            // sketch.js blends both artworks live
    _transitionTriggered = true;
    // Schedule snake colour refresh to midway through the blend (~2s after start)
    _colorRefreshAt = timestamp + 2000;
  }

  // Refresh snake colours partway through the blend so they match the new art
  if (_colorRefreshAt !== null && timestamp >= _colorRefreshAt) {
    _readSettingsIntoSnake();
    _colorRefreshAt = null;
  }

  _drawSnake();
  _snakeRaf = requestAnimationFrame(_snakeTick);
}


// Convert a normalised position t ∈ [0,1) to canvas {x, y}.
// Clockwise from the top-left corner (0, 0).
function _pointOnPerimeter(t) {
  const s = canvasSize;
  t = ((t % 1) + 1) % 1;

  if (t < 0.25) {
    const u = t / 0.25;
    return { x: u * s, y: 0 };
  } else if (t < 0.5) {
    const u = (t - 0.25) / 0.25;
    return { x: s, y: u * s };
  } else if (t < 0.75) {
    const u = (t - 0.5) / 0.25;
    return { x: s - u * s, y: s };
  } else {
    const u = (t - 0.75) / 0.25;
    return { x: 0, y: s - u * s };
  }
}


function _insetPoint(pt, inset) {
  const cx = canvasSize * 0.5;
  const cy = canvasSize * 0.5;
  const dx = cx - pt.x;
  const dy = cy - pt.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    x: pt.x + (dx / len) * inset,
    y: pt.y + (dy / len) * inset
  };
}


function _drawSnake() {
  const ctx = _snakeCtx;
  ctx.clearRect(0, 0, canvasSize, canvasSize);

  if (_snakeColors.length === 0) return;

  const border = canvasSize / 45;
  const inset = border * 0.55;

  const headT = _snakeProgress;
  const tailT = headT - SNAKE_LENGTH_FRACTION;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = _snakeStrokeWidth * (canvasSize / 800);

  for (let i = 0; i < SNAKE_SEGMENTS; i++) {
    const t0 = tailT + (i / SNAKE_SEGMENTS) * SNAKE_LENGTH_FRACTION;
    const t1 = tailT + ((i + 1) / SNAKE_SEGMENTS) * SNAKE_LENGTH_FRACTION;

    const segFraction = (i + 0.5) / SNAKE_SEGMENTS;
    const opacity = segFraction * segFraction;

    const colorIdx = Math.floor(segFraction * _snakeColors.length) % _snakeColors.length;
    const c = _snakeColors[colorIdx];

    const p0 = _insetPoint(_pointOnPerimeter(t0), inset);
    const p1 = _insetPoint(_pointOnPerimeter(t1), inset);

    ctx.beginPath();
    ctx.strokeStyle = `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${opacity.toFixed(3)})`;
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
}
