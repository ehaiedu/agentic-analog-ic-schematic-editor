declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    LOCAL_DEV_ACCOUNT_ENABLED?: string;
    LOCAL_DEV_ACCOUNT_PASSWORD?: string;
  }
}
