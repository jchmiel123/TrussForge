// ForgeKit units - engineering-notation numbers ("4.7u", "2.2k", "1meg").
//
// Promoted from CircuitForge's engine/units.js (the engine keeps its own
// copy: it may not import from web/). parseValue accepts "1k", "4.7uF",
// "10 mH", "2.2meg", "5", "-3.3V", "1e-6". Convention: "M" means mega
// (like Falstad), "m" means milli, "meg" also works.
//
//   parseValue('4.7uF')      -> 4.7e-6
//   formatValue(4700, 'ohm') -> '4.7kohm'
//   formatValue(0.00022, 'F')-> '220uF'

const MULT = {
  T: 1e12, G: 1e9, MEG: 1e6, M: 1e6, k: 1e3, K: 1e3,
  m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15,
};

export function parseValue(input) {
  if (typeof input === 'number') return input;
  if (input === null || input === undefined) return NaN;
  const s = String(input).trim();
  const m = s.match(
    /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(meg|MEG|Meg|[TGMkKmunpfµ])?\s*([a-zA-ZΩΩ]*)$/,
  );
  if (!m) return NaN;
  let v = parseFloat(m[1]);
  let suf = m[2] || '';
  if (suf === 'µ') suf = 'u';
  if (suf.length === 3) suf = 'MEG';
  if (suf) v *= MULT[suf];
  return v;
}

const SUF = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
  [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
];

// 4 significant digits, SI suffix, optional unit glued on.
export function formatValue(v, unit = '', digits = 4) {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0' + unit;
  const a = Math.abs(v);
  if (a < 1e-15) return '0' + unit;   // below femto is solver noise, not a reading
  let mult = 1e-15, suf = 'f';
  for (const [m, s] of SUF) {
    if (a >= m * 0.9995) { mult = m; suf = s; break; }
  }
  let str = (v / mult).toPrecision(digits);
  if (str.includes('e')) str = String(parseFloat(str));
  else if (str.includes('.')) str = str.replace(/\.?0+$/, '');
  return str + suf + unit;
}

// Decade helpers shared with the log-mode Dial.
export function decadeOf(v) {
  const a = Math.abs(v);
  return a > 0 && Number.isFinite(a) ? Math.pow(10, Math.floor(Math.log10(a))) : 1;
}

// Position within the current decade, 0..1 (1 -> 0, 3.16 -> 0.5, 10 -> 0).
export function decadeFrac(v) {
  const a = Math.abs(v);
  if (!(a > 0) || !Number.isFinite(a)) return 0;
  return ((Math.log10(a) % 1) + 1) % 1;
}
