export function promptIds(tokenizer, meta, mission) {
  const imageId = meta.image_token_id;
  const nImg = meta.image.tokens;
  const [mh, mw] = meta.image.merged;
  const ids = meta.questions.map((q) => {
    const state = (meta.state_prefix + mission).trim();
    const text = meta.prompt.replace('{state}', () => state).replace('{question}', () => meta.question_text[q]);
    const raw = tokenizer.encode(text, { add_special_tokens: false }).ids;
    const at = raw.indexOf(imageId);
    if (at < 0 || raw.indexOf(imageId, at + 1) >= 0) throw new Error('prompt: exactly one image token expected');
    return [...raw.slice(0, at), ...new Array(nImg).fill(imageId), ...raw.slice(at + 1)];
  });
  const n = Math.min(...ids.map((x) => x.length));
  let cut = n;
  for (let i = 0; i < n; i++) if (ids.some((x) => x[i] !== ids[0][i])) { cut = i; break; }
  cut = Math.min(cut, n - 1);
  const a = ids[0].indexOf(imageId);
  const b = a + nImg;
  if (b > cut) throw new Error('prompt: the questions do not share the image');
  const pos = ids.map((x) => {
    const t = new Array(x.length), h = new Array(x.length), w = new Array(x.length);
    for (let i = 0; i < a; i++) t[i] = h[i] = w[i] = i;
    for (let r = 0; r < mh; r++) for (let c = 0; c < mw; c++) { const i = a + r * mw + c; t[i] = a; h[i] = a + r; w[i] = a + c; }
    const next = a + Math.max(mh, mw);
    for (let i = a + nImg; i < x.length; i++) t[i] = h[i] = w[i] = next + i - a - nImg;
    return [t, h, w];
  });
  return { ids, pos, cut, a, b };
}
