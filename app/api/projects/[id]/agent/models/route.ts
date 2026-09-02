import { getSessionUser, json } from "@/lib/auth";
import { ownedProject } from "@/lib/agentHistory.server";
import { MultimodalProviderError, publicAgentModelCatalog } from "@/lib/multimodalProvider.server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return json({ error: "请先登录" }, { status: 401 });
  const { id: projectId } = await context.params;
  if (!await ownedProject(projectId, user.id)) return json({ error: "项目不存在" }, { status: 404 });
  try {
    return json({ models: publicAgentModelCatalog() });
  } catch (error) {
    const problem = error instanceof MultimodalProviderError ? error : new MultimodalProviderError("模型目录不可用", 503);
    return json({ error: problem.message }, { status: problem.status });
  }
}
