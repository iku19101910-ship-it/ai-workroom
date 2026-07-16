// アプリローカル設定(同期対象外)。ワークスペースの場所などPC固有の情報のみを持つ。
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function configPath() {
  return path.join(app.getPath("userData"), "app-config.json");
}

function getAppConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return { workspacePath: null };
  }
}

function setAppConfig(patch) {
  const cur = getAppConfig();
  const next = { ...cur, ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

module.exports = { getAppConfig, setAppConfig };
