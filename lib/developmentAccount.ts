export const DEVELOPMENT_ACCOUNT_USERNAME = "dev_user";

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLocaleLowerCase("en-US");
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

export function isDevelopmentAccountUsername(username: string): boolean {
  return username.trim().toLocaleLowerCase("zh-CN") === DEVELOPMENT_ACCOUNT_USERNAME;
}
