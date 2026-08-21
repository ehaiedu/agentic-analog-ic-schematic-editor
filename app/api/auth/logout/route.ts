import { destroySession, json, rejectCrossOriginWrite } from "@/lib/auth";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const cookies = await destroySession(request);
  const headers = new Headers();
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return json({ ok: true }, { headers });
}
