import { ARROW } from './hud.js';

const BROWSERS = {
  chrome: {
    settings: 'chrome://settings/system',
    gpu: 'chrome://gpu',
  },
  edge: {
    settings: 'edge://settings/system',
    gpu: 'edge://gpu',
  },
};

function browser() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

function steps() {
  const b = browser();
  if (b === 'firefox' || b === 'ios' || b === 'other') return ['Open this page in Chrome or Edge on a computer.'];
  if (b === 'safari') {
    return [
      'Update to Safari 26 or later: WebGPU is on by default there.',
      'On an older Safari: Settings > Advanced > "Show features for web developers", then Develop > Feature Flags > turn on WebGPU.',
      'Reload this page.',
    ];
  }
  const { settings, gpu } = BROWSERS[b];
  const list = [
    { text: `Open ${settings} in a new tab (copy the address below).`, copy: settings },
    { text: `Turn on "Use graphics acceleration when available", then click Relaunch.` },
    { text: `Check ${gpu}: "WebGPU" must say "Hardware accelerated".`, copy: gpu },
  ];
  list.push({ text: 'Reload this page.' });
  return list;
}

function slowSteps() {
  const b = browser();
  const list = b === 'chrome' || b === 'edge' ? [] : ['Open this page in Chrome or Edge on a computer.'];
  list.push('Close other tabs and apps that use the GPU.', 'Plug in the laptop and turn off Low Power Mode.', 'Reload this page.');
  return list;
}

export function showNotice({ kind, detail, diagnostics = null }) {
  const missing = kind === 'missing';
  const title = missing ? 'Turn on WebGPU to fly the drone' : 'Your GPU is too slow for this demo';
  const intro = {
    missing: `The model runs in your browser with WebGPU, and WebGPU is not available here (${detail}). A web page cannot turn it on: please do it in the browser settings.`,
    slow: `One decision takes ${detail} here. The drone needs 0.8 s or less.`,
  }[kind];
  const root = document.createElement('div');
  root.className = 'hud hud-modal';
  root.style.zIndex = '45';
  root.innerHTML = '<div class="hud-panel hud-card" role="dialog" aria-modal="true" aria-labelledby="hud-notice-title">'
    + `<div class="hud-label">${missing ? 'WebGPU' : 'GPU'}</div>`
    + '<div id="hud-notice-title" class="hud-title"></div>'
    + '<div data-k="intro" class="hud-text"></div>'
    + '<div class="hud-rule"></div>'
    + '<ol data-k="steps" class="hud-text" style="margin:0;padding-left:1.2em;display:grid;gap:10px"></ol>'
    + '<div class="hud-foot" style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px">'
    + '<button data-k="diag" class="hud-btn hud-ghost" style="margin-right:auto">Copy diagnostics</button>'
    + '<button data-k="close" class="hud-btn hud-ghost">Close</button>'
    + `<button data-k="reload" class="hud-btn">Reload ${ARROW}</button>`
    + '</div></div>';
  root.querySelector('#hud-notice-title').textContent = title;
  root.querySelector('[data-k="intro"]').textContent = intro;
  const list = root.querySelector('[data-k="steps"]');
  for (const step of missing ? steps() : slowSteps()) {
    const item = document.createElement('li');
    const s = typeof step === 'string' ? { text: step } : step;
    item.textContent = s.text;
    if (s.copy) {
      const button = document.createElement('button');
      button.className = 'hud-btn hud-ghost';
      button.style.cssText = 'margin-left:10px;padding:4px 10px;font-size:13px';
      button.textContent = `Copy ${s.copy}`;
      button.onclick = async () => {
        try { await navigator.clipboard.writeText(s.copy); button.textContent = 'Copied'; } catch { button.textContent = s.copy; }
      };
      item.appendChild(button);
    }
    list.appendChild(item);
  }
  const close = () => { root.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); };
  window.addEventListener('keydown', onKey, true);
  root.querySelector('[data-k="close"]').onclick = close;
  const diag = root.querySelector('[data-k="diag"]');
  if (diagnostics) diag.onclick = () => copyDiagnostics(diagnostics, diag);
  else diag.remove();
  root.querySelector('[data-k="reload"]').onclick = () => location.reload();
  document.body.appendChild(root);
  return { close };
}

export async function copyDiagnostics(diagnostics, button) {
  const text = JSON.stringify(await diagnostics(), null, 1);
  try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; } catch { console.log(text); button.textContent = 'See the console'; }
}
