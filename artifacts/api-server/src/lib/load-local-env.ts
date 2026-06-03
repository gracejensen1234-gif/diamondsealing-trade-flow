import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function findEnvFile(startDir: string) {
  let current = startDir;
  const root = path.parse(current).root;

  while (true) {
    const candidate = path.join(current, ".env.local");
    if (existsSync(candidate)) return candidate;
    if (current === root) return null;
    current = path.dirname(current);
  }
}

function cleanValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadLocalEnv() {
  if (process.env.NODE_ENV === "production") return;

  const envFile = findEnvFile(process.cwd());
  if (!envFile) return;

  const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const withoutExport = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const separatorIndex = withoutExport.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = withoutExport.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;

    process.env[key] = cleanValue(withoutExport.slice(separatorIndex + 1));
  }
}

loadLocalEnv();
