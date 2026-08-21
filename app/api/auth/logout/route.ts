import { destroySession, json, rejectCrossOriginWrite } from "@/lib/auth";

export async function POST(request: Request) {
  const crossOrigin = rejectCrossOriginWrite(request);
  if (crossOrigin) return crossOrigin;
  const cookie = await destroySession(request);
  return json({ ok: true }, { headers: { "set-cookie": cookie } });
}
