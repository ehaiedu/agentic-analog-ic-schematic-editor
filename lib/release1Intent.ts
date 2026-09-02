import type { ReleaseFamily } from "./analogweaveAgent";

function numberWithUnit(
  prompt: string,
  terms: string,
  units: Record<string, number>,
): number | undefined {
  const unitPattern = Object.keys(units).join("|");
  const patterns = [
    new RegExp(`(?:${terms})[^0-9,;\\n]{0,32}([0-9]+(?:\\.[0-9]+)?)\\s*(${unitPattern})`, "i"),
    new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*(${unitPattern})[^,;\\n]{0,28}(?:${terms})`, "i"),
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const unit = match[2].toLowerCase();
    return Number(match[1]) * (units[unit] ?? 1);
  }
  return undefined;
}

export function inferReleaseFamily(prompt: string, fallback?: ReleaseFamily | null): ReleaseFamily | null {
  if (/(?:comparator|\bcmp\b|比较器|判决器)/i.test(prompt)) return "comparator";
  if (/(?:op\s*-?\s*amp|opamp|\bota\b|运放|运算放大器|跨导放大器)/i.test(prompt)) return "opamp";
  return fallback ?? null;
}

export function requestsSpegExecution(prompt: string): boolean {
  if (/(?:不|不要|无需|不用|禁止|仅|只).{0,6}(?:run|simulate|simulation|verify|optimi[sz]e|执行|运行|仿真|验证|优化|调优|重跑)/i.test(prompt)) {
    return false;
  }
  return /(?:run|simulate|simulation|verify|verification|optimi[sz]e|rerun|re-eval|re-evaluate|执行|运行|仿真|验证|优化|调优|重跑|重新评估|修改(?:尺寸|参数|拓扑))/i.test(prompt);
}

export function release1Targets(prompt: string, family: ReleaseFamily): Record<string, number> {
  const targets: Record<string, number> = {};
  const powerUw = numberWithUnit(prompt, "power|功耗", { uw: 1, "µw": 1, mw: 1000, w: 1_000_000 });
  if (powerUw !== undefined) targets.power_mw_max = powerUw / 1000;
  if (family === "comparator") {
    const average = numberWithUnit(prompt, "average\\s+delay|avg\\s+delay|tpd_avg|平均(?:延时|延迟)|(?:传播)?延时|(?:传播)?延迟", { ns: 1, ps: 0.001, us: 1000, "µs": 1000 });
    const rise = numberWithUnit(prompt, "rise\\s+delay|tpd_rise|上升(?:延时|延迟)", { ns: 1, ps: 0.001, us: 1000, "µs": 1000 });
    const fall = numberWithUnit(prompt, "fall\\s+delay|tpd_fall|下降(?:延时|延迟)", { ns: 1, ps: 0.001, us: 1000, "µs": 1000 });
    const swing = numberWithUnit(prompt, "differential\\s+swing|output\\s+swing|swing|差分摆幅|输出摆幅|摆幅", { v: 1, mv: 0.001 });
    if (average !== undefined) targets.tpd_avg_ns_max = average;
    if (rise !== undefined) targets.tpd_rise_ns_max = rise;
    if (fall !== undefined) targets.tpd_fall_ns_max = fall;
    if (swing !== undefined) targets.output_swing_v_min = swing;
  } else {
    const gain = numberWithUnit(prompt, "dc\\s+gain|gain|增益", { db: 1 });
    const ugbw = numberWithUnit(prompt, "ugbw|unity[- ]gain\\s+bandwidth|单位增益带宽", { hz: 1, khz: 1000, mhz: 1_000_000, ghz: 1_000_000_000 });
    const pm = numberWithUnit(prompt, "phase\\s+margin|\\bpm\\b|相位裕度", { deg: 1, "°": 1, degree: 1, degrees: 1, 度: 1 });
    const settling = numberWithUnit(prompt, "settling(?:\\s+time)?|建立时间|稳定时间", { ns: 1, ps: 0.001, us: 1000, "µs": 1000 });
    const slew = numberWithUnit(prompt, "slew(?:\\s+rate)?|压摆率", { "v/us": 1, "v/µs": 1 });
    if (gain !== undefined) targets.gain_db_min = gain;
    if (ugbw !== undefined) targets.ugbw_hz_min = ugbw;
    if (pm !== undefined) targets.pm_deg_min = pm;
    if (settling !== undefined) targets.settling_time_ns_max = settling;
    if (slew !== undefined) targets.slew_rate_v_per_us_min = slew;
  }
  return targets;
}
