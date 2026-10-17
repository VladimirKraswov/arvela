// The frontend invoke payloads and the Rust command signatures must stay in sync:
// Tauri v2 resolves command arguments by camelCase names, so `admin_key` in the
// webview silently becomes None and publishing with an admin key stops working.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const client = readFileSync(fileURLToPath(new URL("../src/hub/modelCatalog.ts", import.meta.url)), "utf8");
const rust = readFileSync(fileURLToPath(new URL("../src-tauri/src/hub.rs", import.meta.url)), "utf8");
const localServer = readFileSync(fileURLToPath(new URL("../src/native/localServer.ts", import.meta.url)), "utf8");
const server = readFileSync(fileURLToPath(new URL("../src-tauri/src/lib.rs", import.meta.url)), "utf8");

it("sends the admin key under the camelCase name the Rust command expects", () => {
  expect(rust).toMatch(/pub async fn hub_model_catalog[\s\S]{0,400}admin_key: Option<String>/);
  expect(client).toContain("adminKey:");
  expect(client).not.toContain("admin_key:");
});

it("registers the catalog and restart commands in the invoke handler", () => {
  expect(server).toContain("hub::hub_model_catalog");
  expect(server).toContain("local_server::restart_local_opencode");
  expect(server).toContain("config::read_pi_models");
  expect(server).toContain("config::write_pi_models");
  expect(localServer).toContain('"restart_local_opencode"');
});

it("gates catalog application behind the device preference", () => {
  expect(client).toMatch(/if \(!prefs\.enabled\) throw new Error/);
});
