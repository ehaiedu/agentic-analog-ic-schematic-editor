import { json } from "@/lib/auth";
import { getDevelopmentAccountCredentials } from "@/lib/developmentAccountGate.server";

export async function GET(request: Request) {
  const credentials = getDevelopmentAccountCredentials(request);
  if (!credentials) return json({ error: "Not found" }, { status: 404 });
  return json(credentials);
}
