// ForgeKit assert - the tiny known-answer test harness every CodeLab
// engine repo re-typed (TrussForge, CircuitForge, ForgeKit itself...).
// Node only, zero deps, prints PASS/FAIL lines and exits non-zero on any
// failure so `node tests/run-tests.js` works as a gate.
//
//   import { suite } from '../web/vendor/forgekit/assert.js';
//   const t = suite('TrussForge');
//   t.check('T1 period', measured, 2 * Math.PI, 1e-3);   // numeric, tolerance
//   t.ok('T2 walker moved', dx > 1, `dx=${dx}`);         // boolean + note
//   t.eq('T3 name round-trips', doc.name, 'walker');     // deep-equal via JSON
//   t.throws('T4 NaN rejected', () => build({ r: NaN }), /NaN/);
//   t.done();                                            // summary + exit code
//
// Rule of the house: `want` values come from an INDEPENDENT source
// (closed form, bisection, a hand calculation), never from the engine.

export function fmt(x) {
  if (typeof x !== 'number') return String(x);
  if (!Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return x.toExponential(6);
  return Number(x.toPrecision(7)).toString();
}

export const near = (a, b, tol = 1e-12) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

export function suite(title = '', { log = console.log, exit = true } = {}) {
  let pass = 0, fail = 0;
  const failures = [];
  function record(ok, line) {
    if (ok) pass++; else { fail++; failures.push(line); }
    log(`${ok ? 'PASS' : 'FAIL'}  ${line}`);
    return ok;
  }
  return {
    // |got - want| <= tol (tol 0 = exact)
    check(name, got, want, tol = 0) {
      const ok = near(got, want, tol);
      return record(ok, `${name}  got=${fmt(got)} want=${fmt(want)}${tol ? ' tol=' + fmt(tol) : ''}`);
    },
    ok(name, cond, note = '') { return record(!!cond, name + (note ? '  ' + note : '')); },
    eq(name, got, want) {
      const ok = Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want);
      return record(ok, ok ? name : `${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
    },
    throws(name, fn, re) {
      let err = null;
      try { fn(); } catch (e) { err = e; }
      const ok = !!err && (!re || re.test(String(err && err.message || err)));
      return record(ok, name + (err ? '' : '  (did not throw)'));
    },
    section(label) { log(`\n-- ${label}`); },
    get pass() { return pass; },
    get fail() { return fail; },
    get failures() { return failures.slice(); },
    // Print the summary. Exits the process with 1 on failure unless
    // { exit: false } was given (then returns the boolean).
    done() {
      log(`\n${title ? title + ': ' : ''}${pass}/${pass + fail} checks passed${fail ? `  (${fail} FAILED)` : ''}`);
      if (exit && typeof process !== 'undefined' && process.exit) process.exit(fail ? 1 : 0);
      return fail === 0;
    },
  };
}
