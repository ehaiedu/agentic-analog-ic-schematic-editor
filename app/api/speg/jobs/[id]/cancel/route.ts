import { getSessionUser, json, rejectCrossOriginWrite } from "@/lib/auth";
import { publicSpegJob, spegApi, SpegApiError } from "@/lib/spegApi.server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  try {
    const status = await spegApi(`/v1/jobs/${encodeURIComponent(id)}`);
    if (!status || typeof status !== "object" || (status as Record<string, unknown>).owner_user_id !== user.id) {
      return json({ error: "任务不存在" }, { status: 404 });
    }
    const upstream = await spegApi(`/v1/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ requested_by: user.id }),
    });
    return json({ job: publicSpegJob(upstream) });
  } catch (error) {
    const problem = error instanceof SpegApiError ? error : new SpegApiError("SPEG 请求失败");
    return json({ error: problem.message }, { status: problem.status });
  }
}
