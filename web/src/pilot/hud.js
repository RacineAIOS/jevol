import { createTutorial } from './tutorial.js';

const CSS = `
.hud { --hud-panel: rgba(0, 0, 0, .74); --hud-bar: rgb(24, 24, 26); --hud-card: #111214; --hud-line: #2b2c31; --hud-fg: #fff;
  --hud-muted: #9d9ea6; --hud-ink: #1e1f2b; --hud-font: "Heros", "Helvetica Neue", Helvetica, Arial, sans-serif;
  --hud-edge: 24px; --hud-view: clamp(150px, 15.05vw, 260px); --hud-bottom: clamp(16px, 3.59vw, 62px);
  --hud-bar-h: clamp(64px, 6.71vw, 116px); --hud-gap: clamp(10px, 1.04vw, 18px);
  font-family: var(--hud-font); color: var(--hud-fg); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
.hud-panel { background: var(--hud-panel); border: 1px solid var(--hud-line); border-radius: 0; box-sizing: border-box; }
.hud-label { font-size: 12px; line-height: 1.05; letter-spacing: .04em; text-transform: uppercase; color: var(--hud-muted); }
.hud-logo { position: fixed; left: var(--hud-edge); top: 20px; z-index: 20; padding: 18px 22px; color: #fff; }
.hud-bar { position: fixed; right: calc(var(--hud-edge) * 2 + var(--hud-view) + 2px); bottom: var(--hud-bottom); z-index: 21;
  width: min(1200px, calc(100vw - var(--hud-edge) * 3 - var(--hud-view) - 2px)); height: var(--hud-bar-h);
  display: flex; align-items: center; gap: var(--hud-gap); padding: 0 clamp(8px, .81vw, 14px); background: var(--hud-bar);
  font-size: clamp(15px, 1.5625vw, 27px); }
.hud-input { flex: 1; min-width: 0; font: 600 clamp(20px, 2.315vw, 40px)/1.2 var(--hud-font); letter-spacing: -.01em; color: #fff;
  background: transparent; border: 0; outline: none; padding: 0 0 0 clamp(4px, .69vw, 12px); }
.hud-input::placeholder { color: var(--hud-muted); font-weight: 400; }
.hud-btn { font: 1em/1.2 var(--hud-font); letter-spacing: -.01em; display: inline-flex; align-items: center; gap: .67em;
  padding: .815em 1.333em; border: 1px solid #fff; border-radius: 0; background: #fff; color: var(--hud-ink); cursor: pointer;
  white-space: nowrap; flex: none; }
.hud-btn.hud-ghost { background: transparent; color: #fff; }
.hud-btn:hover { opacity: .85; }
.hud-btn:disabled { opacity: .4; cursor: default; }
.hud-loading { position: fixed; bottom: calc(var(--hud-bottom) + var(--hud-bar-h) + 12px); right: calc(var(--hud-edge) * 2 + var(--hud-view) + 2px);
  width: min(1200px, calc(100vw - var(--hud-edge) * 3 - var(--hud-view) - 2px)); z-index: 30; display: flex; justify-content: center; pointer-events: none; }
.hud-loading > div { width: min(420px, 100%); padding: 10px 14px; font: 12px/1.4 var(--hud-font); color: var(--hud-muted); }
.hud-progress { height: 2px; margin-top: 8px; background: var(--hud-line); overflow: hidden; }
.hud-progress > div { height: 100%; width: 0; background: #fff; }
.hud-btn svg { width: .93em; height: .93em; }
.hud-btn.hud-icon { padding: 0; width: calc(2.83em + 2px); height: calc(2.83em + 2px); justify-content: center; border-color: var(--hud-line); }
.hud-btn.hud-icon:hover { border-color: #fff; opacity: 1; }
.hud-status { position: fixed; bottom: calc(var(--hud-bottom) + var(--hud-bar-h) + 10px); right: calc(var(--hud-edge) * 2 + var(--hud-view) + 2px);
  width: min(1200px, calc(100vw - var(--hud-edge) * 3 - var(--hud-view) - 2px)); z-index: 21; text-align: center;
  font: 13px/1.4 var(--hud-font); color: rgb(255, 190, 120); text-shadow: 0 1px 2px rgba(0, 0, 0, .8); white-space: pre-wrap; }
.hud-speed { position: fixed; top: 20px; right: var(--hud-edge); z-index: 20; padding: 8px 12px; font: 13px/1.2 var(--hud-font);
  letter-spacing: .01em; color: var(--hud-muted); font-variant-numeric: tabular-nums; }
.hud-speed.hud-slow { color: rgb(255, 125, 115); border-color: rgba(255, 125, 115, .55); cursor: help; }
.hud-view { position: fixed; right: var(--hud-edge); bottom: var(--hud-bottom); z-index: 20; line-height: 0; }
.hud-view canvas { display: block; width: var(--hud-view); background: #000; }
.hud-view .hud-label { position: absolute; left: 0; top: 0; padding: 6px 8px; background: var(--hud-panel); color: #fff; }
.hud-chip { font: 13px/1.2 var(--hud-font); letter-spacing: -.005em; padding: 7px 10px; border: 1px solid var(--hud-line); border-radius: 0;
  background: transparent; color: #fff; cursor: pointer; text-align: left; }
.hud-chip:hover { border-color: #fff; }
.hud-modal { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 16px;
  background: rgba(0, 0, 0, .55); box-sizing: border-box; }
.hud-card { width: min(680px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 28px 28px 24px; background: var(--hud-card); }
.hud-card .hud-btn { font-size: 15px; }
.hud-title { font: 500 28px/1.15 var(--hud-font); letter-spacing: -.02em; margin-top: 10px; }
.hud-text { font: 15px/1.45 var(--hud-font); color: var(--hud-muted); margin-top: 12px; }
.hud-rule { height: 1px; background: var(--hud-line); margin: 22px 0 16px; }
.hud-keys { display: grid; grid-template-columns: max-content 1fr; gap: 10px 16px; margin-top: 12px; align-items: center;
  font: 14px/1.3 var(--hud-font); color: var(--hud-muted); }
.hud-keys > span:nth-child(odd) { display: flex; gap: 4px; }
.hud-kbd { font: 12px/1 var(--hud-font); color: #fff; border: 1px solid var(--hud-line); padding: 5px 7px; min-width: 12px; text-align: center; }
.hud-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 24px; }
.hud-nav { display: flex; gap: 8px; }
.hud-dots { display: flex; gap: 6px; }
.hud-dots > span { width: 6px; height: 6px; background: var(--hud-line); }
.hud-dots > span.hud-on { background: #fff; }
.hud-video { display: block; width: 100%; aspect-ratio: 16 / 9; margin-top: 18px; background: #000; object-fit: cover; }
.hud-tips { margin: 14px 0 0; padding-left: 1.1em; display: grid; gap: 6px; color: #fff; }
.hud-limits { color: #fff; }
.hud-limits a { color: #fff; text-decoration: underline; text-underline-offset: 3px; }
.hud-examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.hud-keys-2 { grid-template-columns: max-content 1fr max-content 1fr; gap: 6px 14px; }
.hud-rule-tight { margin: 16px 0 12px; }
.hud-compute { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin-top: 16px; }
.hud-compute .hud-text { margin: 0; font-size: 13px; }
.hud-flow { display: flex; align-items: center; gap: 10px; margin-top: 20px; padding: 16px; border: 1px solid var(--hud-line); }
.hud-flow .hud-label { font-size: 11px; }
.hud-flow-in { flex: none; width: 168px; display: grid; gap: 6px; }
.hud-flow-in img { display: block; width: 168px; aspect-ratio: 4 / 3; background: #000; margin-bottom: 6px; }
.hud-flow-prompt { font: 14px/1.3 var(--hud-font); color: #fff; padding: 6px 8px; border: 1px solid var(--hud-line); }
.hud-flow-arrow { flex: 1; min-width: 28px; max-width: 48px; height: 12px; stroke: var(--hud-muted); stroke-width: 1.5; fill: none; }
.hud-flow-dash { stroke-dasharray: 4 4; animation: hud-flow 0.4s linear infinite; }
@keyframes hud-flow { to { stroke-dashoffset: -8; } }
.hud-flow-model { flex: none; display: grid; gap: 6px; justify-items: center; padding: 14px 16px; border: 1px solid #fff;
  font: 500 16px/1.2 var(--hud-font); }
.hud-flow-every { font: 12px/1.2 var(--hud-font); color: var(--hud-muted); }
.hud-flow-tick { width: 56px; height: 2px; background: var(--hud-line); overflow: hidden; }
.hud-flow-tick > div { height: 100%; background: #fff; transform-origin: left; animation: hud-tick 0.4s linear infinite; }
@keyframes hud-tick { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.hud-flow-out { flex: 1; min-width: 150px; display: grid; grid-template-columns: max-content 1fr; gap: 6px 10px; align-items: center;
  font: 13px/1.2 var(--hud-font); color: #fff; font-variant-numeric: tabular-nums; }
.hud-flow-out > span { grid-column: 2; margin-top: -2px; color: var(--hud-muted); }
.hud-flow-bar { position: relative; height: 6px; background: var(--hud-line); }
.hud-flow-bar > div { position: absolute; top: 0; bottom: 0; left: 0; width: 0; background: #fff; transition: left .2s, width .2s; }
.hud-flow-bar.hud-mid::after { content: ""; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1px; background: var(--hud-muted); }
.hud-memory { display: grid; gap: 8px; margin-top: 12px; padding: 12px 16px 14px; border: 1px solid var(--hud-line); }
.hud-memory .hud-label { font-size: 11px; }
.hud-memory-frames { display: grid; grid-template-columns: repeat(4, minmax(0, 84px)); gap: 8px; }
.hud-memory figure { margin: 0; display: grid; gap: 4px; }
.hud-memory img { display: block; width: 100%; aspect-ratio: 4 / 3; background: #000; }
.hud-memory figcaption { font: 11px/1.2 var(--hud-font); color: var(--hud-muted); }
.hud-memory-past { position: relative; }
.hud-memory-past img { opacity: .3; filter: grayscale(1); }
.hud-memory-past::after { content: ""; position: absolute; left: 0; top: 0; width: 100%; aspect-ratio: 4 / 3;
  background: linear-gradient(to top right, transparent calc(50% - 1px), var(--hud-muted) calc(50% - 1px), var(--hud-muted) calc(50% + 1px), transparent calc(50% + 1px)); }
.hud-memory-now img { outline: 1px solid #fff; outline-offset: 0; }
.hud-memory-now figcaption { color: #fff; }
@media (max-width: 720px) {
  .hud { --hud-edge: 12px; --hud-view: 140px; --hud-bottom: 12px; --hud-bar-h: 60px; }
  .hud-logo { padding: 12px 14px; }
  .hud-speed { top: 12px; }
  .hud-bar, .hud-status, .hud-loading { left: var(--hud-edge); right: var(--hud-edge); width: auto; }
  .hud-bar { font-size: 14px; }
  .hud-input { font-size: 17px; }
  .hud-btn { padding: .7em .9em; }
  .hud-btn.hud-icon { width: 40px; height: 40px; }
  .hud-view { bottom: calc(var(--hud-bottom) + var(--hud-bar-h) + 12px); }
  .hud-status { bottom: calc(var(--hud-bottom) * 2 + var(--hud-bar-h) + var(--hud-view) * .75 + 16px); }
  .hud-card { padding: 20px 18px 18px; }
  .hud-title { font-size: 22px; }
  .hud-keys-2 { grid-template-columns: max-content 1fr; }
  .hud-flow { flex-direction: column; align-items: stretch; gap: 6px; }
  .hud-flow-in { width: auto; }
  .hud-flow-in img { width: 160px; }
  .hud-flow-arrow { align-self: center; flex: none; width: 36px; margin: 12px 0; transform: rotate(90deg); }
  .hud-flow-model { align-self: center; }
  .hud-flow-out { flex: none; }
}
`;

export const ARROW = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4"/></svg>';
const MENU = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12"/></svg>';
const WORDMARK = '/textures/racine/racine-wordmark.svg';
const SPEED_SAMPLES = 8;
const SPEED_EVERY_MS = 500;
const SLOW_MS = 400;
const SLOW_TIP = 'Above 0.4 s per decision the drone will not fly well. Close other tabs, plug in the computer, or use a faster GPU.';

function installStyle() {
  if (document.getElementById('hud-style')) return;
  const style = document.createElement('style');
  style.id = 'hud-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}

async function wordmark(target, height) {
  try {
    target.innerHTML = await (await fetch(WORDMARK)).text();
    const svg = target.querySelector('svg');
    svg.removeAttribute('class');
    Object.assign(svg.style, { height: `${height}px`, width: 'auto', display: 'block' });
  } catch {
    target.textContent = 'racine.ai';
  }
}

export function createHud({ view, mission, examples, onFly, onStop }) {
  installStyle();
  const logo = document.createElement('div');
  logo.className = 'hud hud-panel hud-logo';
  document.body.appendChild(logo);
  wordmark(logo, 20);

  const bar = document.createElement('div');
  bar.className = 'hud hud-panel hud-bar';
  bar.innerHTML = `<button data-k="help" class="hud-btn hud-ghost hud-icon" title="Help" aria-label="Help">${MENU}</button>`
    + '<input data-k="mission" class="hud-input" type="text" autocomplete="off" spellcheck="false" placeholder="Describe a mission in English">'
    + `<button data-k="fly" class="hud-btn">Fly ${ARROW}</button>`
    + '<button data-k="stop" class="hud-btn hud-ghost">Stop</button>';
  document.body.appendChild(bar);
  const input = bar.querySelector('[data-k="mission"]');
  input.value = mission;
  const fly = () => { if (!input.value.trim() || flyButton.disabled) return; onFly(); input.blur(); };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') fly();
    else if (e.key === 'Escape') input.blur();
  });
  const onSlash = (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    input.focus();
    input.select();
  };
  window.addEventListener('keydown', onSlash);
  const flyButton = bar.querySelector('[data-k="fly"]');
  flyButton.disabled = true;
  bar.querySelector('[data-k="fly"]').onclick = (e) => { fly(); e.currentTarget.blur(); };
  bar.querySelector('[data-k="stop"]').onclick = (e) => { onStop(); e.currentTarget.blur(); };

  const status = document.createElement('div');
  status.className = 'hud hud-status';
  document.body.appendChild(status);

  const frame = document.createElement('div');
  frame.className = 'hud hud-panel hud-view';
  frame.appendChild(view);
  const caption = document.createElement('div');
  caption.className = 'hud-label';
  caption.textContent = 'Model view';
  frame.appendChild(caption);
  document.body.appendChild(frame);

  const speed = document.createElement('div');
  speed.className = 'hud hud-panel hud-speed';
  speed.style.display = 'none';
  document.body.appendChild(speed);
  const samples = [];
  let speedAt = -Infinity;
  let speedTimer = null;
  const showSpeed = () => {
    speedTimer = null;
    speedAt = performance.now();
    const sorted = [...samples].sort((a, b) => a - b);
    const ms = Math.round(sorted[Math.floor(sorted.length / 2)]);
    const slow = ms > SLOW_MS;
    speed.textContent = slow ? `Slow GPU · ${ms} ms per decision` : `Model ${ms} ms`;
    speed.classList.toggle('hud-slow', slow);
    speed.title = slow ? SLOW_TIP : '';
    speed.style.display = '';
  };

  const tutorial = createTutorial({ examples, arrow: ARROW, onPick: (text) => { input.value = text; } });
  bar.querySelector('[data-k="help"]').onclick = (e) => { tutorial.open(); e.currentTarget.blur(); };
  if (!tutorial.seen()) tutorial.open();

  return {
    get mission() { return input.value.trim(); },
    setMission(text) { input.value = text; },
    setStatus(text) { status.textContent = text; },
    decision(ms) {
      samples.push(ms);
      if (samples.length > SPEED_SAMPLES) samples.shift();
      if (speedTimer) return;
      const wait = speedAt + SPEED_EVERY_MS - performance.now();
      if (wait <= 0) showSpeed();
      else speedTimer = setTimeout(showSpeed, wait);
    },
    setReady(on) { flyButton.disabled = !on; },
    loadingBar() {
      const box = document.createElement('div');
      box.className = 'hud hud-loading';
      box.innerHTML = '<div class="hud-panel"><div data-k="text">Loading the model…</div><div class="hud-progress"><div data-k="bar"></div></div></div>';
      document.body.appendChild(box);
      const text = box.querySelector('[data-k="text"]');
      const fill = box.querySelector('[data-k="bar"]');
      return {
        update({ loaded, total, text: label }) { fill.style.width = `${Math.min(100, (100 * loaded) / Math.max(total, 1))}%`; if (label) text.textContent = label; },
        remove() { box.remove(); },
      };
    },
    setCompute(text) { tutorial.setCompute(text); },
    setDiagnostics(fn) { tutorial.setDiagnostics(fn); },
    remove() {
      for (const e of [logo, bar, status, frame, speed]) e.remove();
      clearTimeout(speedTimer);
      window.removeEventListener('keydown', onSlash);
      tutorial.remove();
    },
  };
}
