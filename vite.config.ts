import { randomBytes } from "node:crypto";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json" with { type: "json" };
import { sites } from "./build/sites-vite-plugin.ts";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

function resolveLocalDevelopmentPassword(enabled: boolean) {
  if (!enabled) return undefined;

  const configuredPassword = process.env.ANALOG_LOCAL_DEV_PASSWORD;
  if (configuredPassword !== undefined) {
    if (configuredPassword.length < 8 || configuredPassword.length > 128) {
      throw new Error("ANALOG_LOCAL_DEV_PASSWORD must contain 8 to 128 characters.");
    }
    return configuredPassword;
  }

  return [...randomBytes(24)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default defineConfig(async () => {
  const localDevelopmentAccountEnabled = process.env.ANALOG_LOCAL_DEV_ACCOUNT === "true";
  const localDevelopmentAccountPassword = resolveLocalDevelopmentPassword(
    localDevelopmentAccountEnabled,
  );
  const localBindingConfig = {
    main: "./worker/index.ts",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      LOCAL_DEV_ACCOUNT_ENABLED: localDevelopmentAccountEnabled ? "true" : "false",
      ...(localDevelopmentAccountPassword
        ? { LOCAL_DEV_ACCOUNT_PASSWORD: localDevelopmentAccountPassword }
        : {}),
    },
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: "site-creator-d1",
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: "site-creator-r2",
          },
        ]
      : [],
  };

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
