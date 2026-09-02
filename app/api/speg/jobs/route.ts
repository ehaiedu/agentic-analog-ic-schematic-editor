import { getD1 } from "@/db";
import { ensureDatabase } from "@/db/runtime";
import { getSessionUser, json, rejectCrossOriginWrite } from "@/lib/auth";
import { publicSpegJob, spegApi, SpegApiError, spegBackendAlias } from "@/lib/spegApi.server";

const FAMILIES = new Set(["comparator", "opamp"]);
const OPERATIONS = new Set(["nominal_signoff", "full_signoff"]);
const TARGET_KEYS = new Set([
  "tpd_avg_ns_max",
  "tpd_rise_ns_max",
  "tpd_fall_ns_max",
  "output_swing_v_min",
  "gain_db_min",
  "ugbw_hz_min",
  "pm_deg_min",
  "settling_time_ns_max",
  "slew_rate_v_per_us_min",
  "power_mw_max",
]);
const VARIABLE_KEYS = new Set([
  "vdd",
  "temp_c",
  "input_overdrive_v",
  "output_load_pf",
  "load_cap_pf",
  "step_amplitude_v",
]);
const MATRIX_NUMBER_KEYS = new Set(["mc_samples", "mc_seed"]);
const MATRIX_BOOLEAN_KEYS = new Set(["scale_power_budget_with_vdd", "smic180_mismatch_ckt_models", "resume_existing"]);

function unsafeNetlist(text: string): boolean {
  return /^\s*(?:include|ahdl_include|shell|system)\b/im.test(text) || /(?:\/home\/|[a-z]:\\|\\users\\)/i.test(text);
}

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 1_500_000) return json({ error: "SPEG 请求超过大小限制" }, { status: 413 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "请求格式不正确" }, { status: 400 });
  }
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const family = typeof body.family === "string" ? body.family.toLowerCase() : "";
  const promptText = typeof body.promptText === "string" ? body.promptText.trim() : "";
  const netlistText = typeof body.netlistText === "string" ? body.netlistText : "";
  const inputRevision = typeof body.inputRevision === "string" ? body.inputRevision : "";
  const pdkProfileId = typeof body.pdkProfileId === "string" ? body.pdkProfileId : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  const operation = typeof body.operation === "string" && OPERATIONS.has(body.operation)
    ? body.operation
    : "nominal_signoff";
  if (!projectId || !FAMILIES.has(family)) return json({ error: "只允许项目内的 Comparator 或 OTA 任务" }, { status: 400 });
  if (!promptText || promptText.length > 8_000) return json({ error: "设计需求需为 1–8000 个字符" }, { status: 400 });
  if (!netlistText || netlistText.length > 1_000_000 || unsafeNetlist(netlistText)) {
    return json({ error: "网表为空、过大或包含不允许的外部引用" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_.:-]{1,160}$/u.test(inputRevision) || !/^[A-Za-z0-9_.:-]{1,80}$/u.test(pdkProfileId)) {
    return json({ error: "工程版本或 PDK 标识无效" }, { status: 400 });
  }
  if (idempotencyKey && !/^[A-Za-z0-9_.:-]{1,180}$/u.test(idempotencyKey)) {
    return json({ error: "幂等标识无效" }, { status: 400 });
  }
  await ensureDatabase();
  const owned = await getD1().prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?")
    .bind(projectId, user.id)
    .first<{ id: string }>();
  if (!owned) return json({ error: "项目不存在" }, { status: 404 });

  const sourceTargets = body.targets && typeof body.targets === "object" && !Array.isArray(body.targets)
    ? body.targets as Record<string, unknown>
    : {};
  const targets = Object.fromEntries(Object.entries(sourceTargets).flatMap(([key, value]) => {
    const numeric = typeof value === "number" ? value : Number(value);
    return TARGET_KEYS.has(key) && Number.isFinite(numeric) ? [[key, numeric]] : [];
  }));
  const sourceParameters = body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters)
    ? body.parameters as Record<string, unknown>
    : {};
  const configuredParameters: Record<string, number | string | boolean> = Object.fromEntries(Object.entries(sourceParameters).flatMap(([key, value]) => {
    const numeric = typeof value === "number" ? value : Number(value);
    return VARIABLE_KEYS.has(key) && Number.isFinite(numeric) ? [[key, numeric]] : [];
  }));
  if (operation === "full_signoff") {
    for (const [key, value] of Object.entries(sourceParameters)) {
      if (MATRIX_NUMBER_KEYS.has(key)) {
        const numeric = typeof value === "number" ? value : Number(value);
        if (Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 1000) configuredParameters[key] = numeric;
      } else if (MATRIX_BOOLEAN_KEYS.has(key) && typeof value === "boolean") {
        configuredParameters[key] = value;
      } else if (key === "corner_preset" && ["full", "smoke3", "smoke5"].includes(String(value))) {
        configuredParameters[key] = String(value);
      }
    }
  }
  const parameters = {
    netlist_text: netlistText,
    ...configuredParameters,
    ...targets,
    ...(family === "comparator" ? { clocked: /(?:clock|clk|动态|时钟)/i.test(promptText) } : {}),
  };
  try {
    const upstream = await spegApi("/v1/jobs", {
      method: "POST",
      body: JSON.stringify({
        family,
        operation,
        execution_backend: spegBackendAlias(),
        parameters,
        project_id: projectId,
        owner_user_id: user.id,
        input_revision: inputRevision,
        idempotency_key: idempotencyKey,
        max_retries: 1,
        timeout_s: operation === "full_signoff" ? 14_400 : 900,
      }),
    });
    return json({ job: publicSpegJob(upstream) }, { status: 202 });
  } catch (error) {
    const problem = error instanceof SpegApiError ? error : new SpegApiError("SPEG 请求失败");
    return json({ error: problem.message }, { status: problem.status });
  }
}
