import { env } from "cloudflare:workers";
import {
  DEVELOPMENT_ACCOUNT_USERNAME,
  isLoopbackHostname,
} from "@/lib/developmentAccount";

export type DevelopmentAccountCredentials = {
  username: string;
  password: string;
};

export function getDevelopmentAccountCredentials(
  request: Request,
): DevelopmentAccountCredentials | null {
  if (env.LOCAL_DEV_ACCOUNT_ENABLED !== "true") return null;
  if (!isLoopbackHostname(new URL(request.url).hostname)) return null;

  const password = env.LOCAL_DEV_ACCOUNT_PASSWORD;
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return null;
  }
  return { username: DEVELOPMENT_ACCOUNT_USERNAME, password };
}

export function isDevelopmentAccountRequest(request: Request): boolean {
  return getDevelopmentAccountCredentials(request) !== null;
}
