import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERSION = "0.1.0";

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function nowIso() {
  return new Date().toISOString();
}

export function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

export function resolveWorkspacePath() {
  if (process.env.AGENT_BI_WORKSPACE) {
    return path.resolve(expandHome(process.env.AGENT_BI_WORKSPACE));
  }
  if (process.env.BAIZHI_BI_WORKSPACE) {
    return path.resolve(expandHome(process.env.BAIZHI_BI_WORKSPACE));
  }

  for (const configPath of [
    path.join(os.homedir(), ".agent-bi", "config.json"),
    path.join(os.homedir(), ".baizhi-bi", "config.json")
  ]) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.workspacePath) {
        return path.resolve(expandHome(config.workspacePath));
      }
    } catch {
      // Missing or unreadable user config falls through to the next option.
    }
  }

  const legacyWorkspace = path.join(os.homedir(), "Documents", "BaizhiBI", "agent-bi-workspace");
  if (fs.existsSync(legacyWorkspace)) {
    return legacyWorkspace;
  }
  return path.join(os.homedir(), "Documents", "AgentBI", "agent-bi-workspace");
}

export function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, value);
}

export function appendText(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.appendFileSync(filePath, value);
}

export function appendJsonl(filePath, value) {
  appendText(filePath, `${JSON.stringify(value)}\n`);
}

export function logSkillRun(workspacePath, event, detail = {}) {
  const logPath = path.join(workspacePath, "logs", "skill-runs.jsonl");
  appendJsonl(logPath, {
    ts: nowIso(),
    event,
    ...detail
  });
  return logPath;
}

export function writeIfMissing(filePath, value) {
  if (!fs.existsSync(filePath)) {
    writeText(filePath, value);
  }
}

export function ensureUserConfig(workspacePath) {
  const configDir = path.join(os.homedir(), ".agent-bi");
  const configPath = path.join(configDir, "config.json");
  const payload = {
    workspacePath,
    version: VERSION,
    lastUsedAt: nowIso()
  };

  try {
    mkdirp(configDir);
    const existing = readJson(configPath, {});
    writeJson(configPath, {
      ...payload,
      createdAt: existing.createdAt || nowIso()
    });
    return { path: configPath, written: true };
  } catch (error) {
    return { path: configPath, written: false, error: error.message };
  }
}

export function sessionDir(workspacePath, sessionId) {
  const [year, month] = sessionId.split("-");
  return path.join(workspacePath, "sessions", year, month, sessionId);
}

export function findSessionDir(workspacePath, sessionId) {
  const direct = sessionDir(workspacePath, sessionId);
  if (fs.existsSync(direct)) {
    return direct;
  }

  const sessionsRoot = path.join(workspacePath, "sessions");
  if (!fs.existsSync(sessionsRoot)) {
    return null;
  }

  const years = fs.readdirSync(sessionsRoot);
  for (const year of years) {
    const yearPath = path.join(sessionsRoot, year);
    if (!fs.statSync(yearPath).isDirectory()) {
      continue;
    }
    const months = fs.readdirSync(yearPath);
    for (const month of months) {
      const candidate = path.join(yearPath, month, sessionId);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export function listSessionIds(workspacePath) {
  const root = path.join(workspacePath, "sessions");
  if (!fs.existsSync(root)) {
    return [];
  }

  const ids = [];
  for (const year of fs.readdirSync(root)) {
    const yearPath = path.join(root, year);
    if (!fs.statSync(yearPath).isDirectory()) {
      continue;
    }
    for (const month of fs.readdirSync(yearPath)) {
      const monthPath = path.join(yearPath, month);
      if (!fs.statSync(monthPath).isDirectory()) {
        continue;
      }
      for (const id of fs.readdirSync(monthPath)) {
        const full = path.join(monthPath, id);
        if (fs.statSync(full).isDirectory()) {
          ids.push(id);
        }
      }
    }
  }

  return ids.sort().reverse();
}

export function safeReadText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

export function safeName(value, fallback = "item") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}
