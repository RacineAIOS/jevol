import { copyDiagnostics } from './notice.js';

const KEYS = [
  [['Drag'], 'Look around'],
  [['Wheel'], 'Camera distance'],
  [['/'], 'Write a mission'],
  [['Enter'], 'Fly the mission'],
  [['↑', '↓'], 'Forward / back, model stopped'],
  [['←', '→'], 'Turn left / right'],
  [['U', 'J'], 'Climb / descend'],
  [['R'], 'Back to the start'],
  [['2'], 'Farm start, object mission'],
  [['3'], 'Street start, street mission'],
  [['F'], 'Follow camera'],
  [['G'], 'Free camera'],
  [['Esc'], 'Close this view'],
];
const TIPS = ['Describe what is visible now.', 'Like a person, it sees far or small things poorly.'];
const SEEN_KEY = 'jevol-tutorial-seen';
const VIDEO = 'tutorial/flight.webm';
const POSTER = 'tutorial/poster.jpg';
const FLOW_MISSION = 'Follow the road';
const FLOW = [
  { forward: 2.59, yaw: -0.052, up: 0 },
  { forward: 2.74, yaw: -0.087, up: 0 },
  { forward: 2.70, yaw: -0.070, up: 0 },
  { forward: 2.77, yaw: 0, up: 0 },
  { forward: 2.81, yaw: 0.087, up: 0 },
  { forward: 2.81, yaw: 0.017, up: 0 },
];
const FLOW_MS = 400;
const MAX_FORWARD = 7;
const MAX_YAW = 0.35;
const MAX_UP = 3;
const ARROW_LINE = '<svg class="hud-flow-arrow" viewBox="0 0 48 12" aria-hidden="true"><path d="M2 6h40" class="hud-flow-dash"/><path d="M38 2l4 4-4 4" fill="none"/></svg>';

const SCREENS = [
  {
    title: 'Tell the drone what to do',
    body: `<video class="hud-video" src="${VIDEO}" poster="${POSTER}" muted loop playsinline preload="metadata" aria-label="A mission typed in the bar, then the drone flies it"></video>`
      + '<div class="hud-text">Write a mission in plain English and press Fly: the model then flies the drone on its own.</div>',
  },
  {
    title: 'How the model decides',
    body: '<div class="hud-flow" aria-hidden="true">'
      + '<div class="hud-flow-in"><div class="hud-label">Drone camera</div><img data-k="flow-img" alt="">'
      + `<div class="hud-label">Your prompt</div><div class="hud-flow-prompt">${FLOW_MISSION}</div></div>`
      + ARROW_LINE
      + '<div class="hud-flow-model"><div>Model</div><div class="hud-flow-every">every 0.4 s</div><div class="hud-flow-tick"><div></div></div></div>'
      + ARROW_LINE
      + '<div class="hud-flow-out">'
      + '<div class="hud-label">Speed</div><div class="hud-flow-bar"><div data-k="forward"></div></div><span data-k="forward-v"></span>'
      + '<div class="hud-label">Turn</div><div class="hud-flow-bar hud-mid"><div data-k="yaw"></div></div><span data-k="yaw-v"></span>'
      + '<div class="hud-label">Climb</div><div class="hud-flow-bar hud-mid"><div data-k="up"></div></div><span data-k="up-v"></span>'
      + '</div></div>'
      + '<div class="hud-memory" aria-hidden="true"><div class="hud-label">No memory</div><div class="hud-memory-frames">'
      + [3, 2, 1, 0].map((k) => `<figure class="${k ? 'hud-memory-past' : 'hud-memory-now'}"><img data-k="mem-${k}" alt=""><figcaption>${k ? `-${(k * 0.4).toFixed(1)} s · not used` : 'now · used'}</figcaption></figure>`).join('')
      + '</div></div>',
  },
  {
    title: 'Tips',
    body: `<ul class="hud-text hud-tips">${TIPS.map((t) => `<li>${t}</li>`).join('')}</ul>`
      + '<div class="hud-rule hud-rule-tight"></div>'
      + '<div class="hud-label">Mission examples</div>'
      + '<div data-k="examples" class="hud-examples"></div>'
      + '<div class="hud-rule hud-rule-tight"></div>'
      + '<div class="hud-label">Controls</div>'
      + '<div data-k="keys" class="hud-keys hud-keys-2"></div>'
      + '<div class="hud-compute"><div data-k="compute" class="hud-text"></div></div>',
  },
  {
    title: 'Known limits',
    body: '<div class="hud-text hud-limits">It keeps no memory: it does not know where it was a second earlier, has no map and no GPS, and a target that leaves the image is lost. '
      + 'It aims poorly at what is far: sent to a billboard 280 m away, it reached a barn. '
      + 'It struggles to gain height, especially with no building nearby as a visual reference. '
      + 'It can touch a nearby wall or fence, and beyond 0.4 s per decision it reacts too late.</div>'
      + '<div class="hud-text hud-limits">They can be reduced with more training data, with reinforcement learning, or by placing Jevol inside an agentic system that carries the memory and the plan of the mission.</div>'
      + '<div class="hud-text hud-limits">Found another one? <a href="https://racine.ai/contact" target="_blank" rel="noopener">Write to us</a>.</div>',
  },
];

function setBar(bar, value, max, centred) {
  const v = Math.max(-1, Math.min(1, value / max));
  if (centred) {
    bar.style.left = `${50 + Math.min(0, v) * 50}%`;
    bar.style.width = `${Math.abs(v) * 50}%`;
  } else {
    bar.style.left = '0';
    bar.style.width = `${Math.max(0, v) * 100}%`;
  }
}

export function createTutorial({ examples, arrow, onPick }) {
  const root = document.createElement('div');
  root.className = 'hud hud-modal';
  root.style.display = 'none';
  root.innerHTML = '<div class="hud-panel hud-card" role="dialog" aria-modal="true" aria-labelledby="hud-tutorial-title">'
    + '<div class="hud-label">Jevol</div>'
    + '<div id="hud-tutorial-title" class="hud-title"></div>'
    + SCREENS.map((s, i) => `<div data-screen="${i}" style="display:none">${s.body}</div>`).join('')
    + '<div class="hud-foot">'
    + `<div class="hud-dots">${SCREENS.map(() => '<span></span>').join('')}</div>`
    + '<div class="hud-nav">'
    + '<button data-k="skip" class="hud-btn hud-ghost">Skip</button>'
    + '<button data-k="back" class="hud-btn hud-ghost">Back</button>'
    + `<button data-k="next" class="hud-btn">Next ${arrow}</button>`
    + '</div></div></div>';
  document.body.appendChild(root);

  const card = root.firstElementChild;
  const title = root.querySelector('#hud-tutorial-title');
  const screens = [...root.querySelectorAll('[data-screen]')];
  const dots = [...root.querySelectorAll('.hud-dots > span')];
  const skip = root.querySelector('[data-k="skip"]');
  const back = root.querySelector('[data-k="back"]');
  const next = root.querySelector('[data-k="next"]');
  const video = root.querySelector('video');
  const flowImg = root.querySelector('[data-k="flow-img"]');
  const memImgs = [0, 1, 2, 3].map((k) => [k, root.querySelector(`[data-k="mem-${k}"]`)]);
  const flowBars = Object.fromEntries(['forward', 'yaw', 'up'].map((k) => [k, [root.querySelector(`[data-k="${k}"]`), root.querySelector(`[data-k="${k}-v"]`)]]));
  const flowImages = FLOW.map((_, i) => `tutorial/decision-${i}.jpg`);
  let flowTimer = null;
  let flowIndex = 0;
  let index = 0;

  const chips = root.querySelector('[data-k="examples"]');
  for (const text of examples) {
    const chip = document.createElement('button');
    chip.className = 'hud-chip';
    chip.textContent = text;
    chip.onclick = () => { onPick(text); close(); };
    chips.appendChild(chip);
  }
  const keys = root.querySelector('[data-k="keys"]');
  for (const [caps, text] of KEYS) {
    const left = document.createElement('span');
    for (const cap of caps) {
      const k = document.createElement('span');
      k.className = 'hud-kbd';
      k.textContent = cap;
      left.appendChild(k);
    }
    const right = document.createElement('span');
    right.textContent = text;
    keys.append(left, right);
  }
  const computeLine = root.querySelector('[data-k="compute"]');
  computeLine.textContent = __JEVOL_BACKEND__ === 'server' ? 'Connecting to the model server…' : 'Loading the model in your browser…';

  function flowStep() {
    const d = FLOW[flowIndex % FLOW.length];
    flowImg.src = flowImages[flowIndex % FLOW.length];
    for (const [k, img] of memImgs) {
      const j = flowIndex - k;
      img.style.visibility = j < 0 ? 'hidden' : 'visible';
      if (j >= 0) img.src = flowImages[j % FLOW.length];
    }
    setBar(flowBars.forward[0], d.forward, MAX_FORWARD, false);
    setBar(flowBars.yaw[0], -d.yaw, MAX_YAW, true);
    setBar(flowBars.up[0], d.up, MAX_UP, true);
    const deg = Math.round((Math.abs(d.yaw) * 180) / Math.PI);
    flowBars.forward[1].textContent = `${d.forward.toFixed(1)} m/s`;
    flowBars.yaw[1].textContent = deg ? `${deg}°/s ${d.yaw > 0 ? 'left' : 'right'}` : 'straight';
    flowBars.up[1].textContent = `${d.up > 0 ? '+' : ''}${d.up.toFixed(1)} m/s`;
    flowIndex++;
  }

  function show(i) {
    index = Math.max(0, Math.min(SCREENS.length - 1, i));
    title.textContent = SCREENS[index].title;
    screens.forEach((s, k) => { s.style.display = k === index ? '' : 'none'; });
    dots.forEach((d, k) => d.classList.toggle('hud-on', k === index));
    back.style.visibility = index === 0 ? 'hidden' : '';
    skip.style.display = index === SCREENS.length - 1 ? 'none' : '';
    next.innerHTML = `${index === SCREENS.length - 1 ? 'Start' : 'Next'} ${arrow}`;
    card.scrollTop = 0;
    if (index === 0 && root.style.display !== 'none') video.play().catch(() => {});
    else video.pause();
    clearInterval(flowTimer);
    flowTimer = null;
    if (index === 1 && root.style.display !== 'none') {
      flowStep();
      flowTimer = setInterval(flowStep, FLOW_MS);
    }
  }

  const onKey = (e) => {
    if (root.style.display === 'none') return;
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'ArrowLeft') show(index - 1);
  };
  window.addEventListener('keydown', onKey, true);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  skip.onclick = () => close();
  back.onclick = () => show(index - 1);
  next.onclick = () => { if (index === SCREENS.length - 1) close(); else show(index + 1); };

  function open() {
    root.style.display = '';
    show(0);
    next.focus({ preventScroll: true });
  }
  function close() {
    root.style.display = 'none';
    video.pause();
    clearInterval(flowTimer);
    flowTimer = null;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch {}
    document.activeElement?.blur?.();
  }
  function seen() {
    try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
  }
  return {
    open,
    close,
    seen,
    setCompute(text) { computeLine.textContent = text; },
    setDiagnostics(fn) {
      if (root.querySelector('[data-k="diag"]')) return;
      const button = document.createElement('button');
      button.dataset.k = 'diag';
      button.className = 'hud-btn hud-ghost';
      button.style.cssText = 'padding:4px 10px;font-size:13px';
      button.textContent = 'Copy diagnostics';
      button.onclick = () => copyDiagnostics(fn, button);
      computeLine.after(button);
    },
    remove() { clearInterval(flowTimer); window.removeEventListener('keydown', onKey, true); root.remove(); },
  };
}
