/* NeuroTrack scoring engine (JavaScript port of neurotrack/models.py, triage.py, pipeline.py).
   Coefficients come from model.json, fitted in Python on the synthetic reference sample. */
(function (root) {
  "use strict";

  function orient(M, d, raw) { return M.raw_scales[d].higher_is_better ? raw : -raw; }

  function demog(p) {
    const ageC = (p.age0 - 65) / 10;
    return [1, ageC, ageC * ageC, (p.edu_years - 10) / 4, p.language === "Arabic" ? 1 : 0,
      p.digital === 0 ? 1 : 0, p.digital === 1 ? 1 : 0, p.hearing_loss ? 1 : 0, p.vision_loss ? 1 : 0];
  }

  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  function sdFor(sdMap, session) {
    const keys = Object.keys(sdMap).map(Number).sort((a, b) => a - b);
    const k = Math.min(Math.max(session, keys[0]), keys[keys.length - 1]);
    return sdMap[String(k)];
  }

  /* Norm z-scores: raw = {memory, speed, executive, fluency} */
  function normZ(M, p, raw) {
    const X = demog(p), out = {};
    let sum = 0;
    for (const d of M.domains) {
      const z = (orient(M, d, raw[d]) - dot(X, M.norm.coef[d])) / M.norm.sd[d];
      out[d] = z; sum += z;
    }
    out.composite = sum / M.domains.length / M.norm.comp_sd;
    return out;
  }

  /* SRB change z-scores. base = mean raw of the two baseline sessions. */
  function changeZ(M, p, raw, base, session, years) {
    const X0 = demog(p), out = {};
    const sess = [3, 4, 5, 6, 7].map(k => (session === k ? 1 : 0));
    let sum = 0;
    for (const d of M.domains) {
      const X = X0.concat([orient(M, d, base[d]), years], sess);
      const z = (orient(M, d, raw[d]) - dot(X, M.change.coef[d])) / sdFor(M.change.sd[d], session);
      out[d] = z; sum += z;
    }
    out.composite = sum / M.domains.length / M.change.comp_sd;
    return out;
  }

  function personalSlope(M, years, comps) {
    if (years.length < M.thresholds.rapid_min_points) return null;
    const mx = years.reduce((a, b) => a + b, 0) / years.length;
    const my = comps.reduce((a, b) => a + b, 0) / comps.length;
    let num = 0, den = 0;
    for (let i = 0; i < years.length; i++) { num += (years[i] - mx) * (comps[i] - my); den += (years[i] - mx) ** 2; }
    return num / den;
  }

  function assess(M, cz, faqChange, phq9, sleep, slope) {
    const T = M.thresholds, reasons = [];
    const comp = cz.composite;
    const low = M.domains.filter(d => cz[d] <= T.domain_flag);
    const single = M.domains.filter(d => cz[d] <= T.domain_flag_single);
    if (comp <= T.composite_flag) reasons.push("COMPOSITE_DROP");
    low.forEach(d => reasons.push("DOMAIN_DROP:" + d));
    const cog = comp <= T.composite_flag || single.length > 0 || low.length >= 2;
    const func = faqChange >= T.faq_change_flag && comp <= T.func_cog_support;
    if (func) reasons.push("FUNCTION_DECLINE");
    const rapid = slope !== null && slope !== undefined && slope <= T.rapid_slope && comp <= -1.0;
    if (rapid) reasons.push("RAPID_TRAJECTORY");
    const severe = comp <= T.composite_severe || (low.length >= 2 && func);
    if (comp <= T.composite_severe) reasons.push("MARKED_DROP");
    const conf = phq9 >= T.phq9_confounder || sleep < T.sleep_confounder_hours;
    if (phq9 >= T.phq9_confounder) reasons.push("LOW_MOOD");
    if (sleep < T.sleep_confounder_hours) reasons.push("POOR_SLEEP");
    return { cog, func, severe, conf, rapid, low, comp, reasons };
  }

  function initialLevel(a) {
    if (!(a.cog || a.func || a.severe)) return "GREEN";
    if (a.severe) return "RED_URGENT";
    if (a.conf) return "AMBER_MOOD";
    return "AMBER";
  }

  function healthyRarity(z) {
    if (z >= 0) return 50;
    // Abramowitz-Stegun approximation of the normal CDF
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return Math.max(1, Math.round(100 * p));
  }

  const api = { orient, demog, normZ, changeZ, personalSlope, assess, initialLevel, healthyRarity };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.NT = api;
})(typeof window !== "undefined" ? window : globalThis);
