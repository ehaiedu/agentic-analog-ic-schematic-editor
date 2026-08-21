import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVELOPMENT_ACCOUNT_USERNAME,
  isDevelopmentAccountUsername,
  isLoopbackHostname,
} from "../lib/developmentAccount";

test("development account recognizes only the reserved username", () => {
  assert.equal(DEVELOPMENT_ACCOUNT_USERNAME, "dev_user");
  assert.equal(isDevelopmentAccountUsername("DEV_USER"), true);
  assert.equal(isDevelopmentAccountUsername(" dev_user "), true);
  assert.equal(isDevelopmentAccountUsername("developer"), false);
});

test("loopback detection excludes LAN addresses and lookalike hosts", () => {
  for (const hostname of ["localhost", "LOCALHOST", "127.0.0.1", "::1", "[::1]"]) {
    assert.equal(isLoopbackHostname(hostname), true, hostname);
  }
  for (const hostname of ["192.0.2.112", "0.0.0.0", "localhost.example.com", "127.0.0.2"]) {
    assert.equal(isLoopbackHostname(hostname), false, hostname);
  }
});
