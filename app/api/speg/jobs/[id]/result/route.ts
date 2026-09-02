import { getSessionUser, json } from "@/lib/auth";
import { spegApi, SpegApiError } from "@/lib/spegApi.server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  try {
    const status = await spegApi(`/v1/jobs/${encodeURIComponent(id)}`);
    if (!status || typeof status !== "object" || (status as Record<string, unknown>).owner_user_id !== user.id) {
      return json({ error: "任务不存在" }, { status: 404 });
    }
    const result = await spegApi(`/v1/jobs/${encodeURIComponent(id)}/result`);
    return json({ result });
  } catch (error) {
    const problem = error instanceof SpegApiError ? error : new SpegApiError("SPEG 请求失败");
    return json({ error: problem.status === 404 ? "结果尚未生成" : problem.message }, { status: problem.status });
  }
}
