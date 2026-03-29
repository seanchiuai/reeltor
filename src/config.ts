import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ReeltorConfig {
  openai_api_key: string;
  anthropic_api_key: string;
  ingest_port: number;
  db_path: string;
}

const REELTOR_DIR = join(homedir(), ".reeltor");
const CONFIG_PATH = join(REELTOR_DIR, "config.json");
const DEFAULT_DB_PATH = join(REELTOR_DIR, "reeltor.db");

const DEFAULT_CONFIG: ReeltorConfig = {
  openai_api_key: "",
  anthropic_api_key: "",
  ingest_port: 7433,
  db_path: DEFAULT_DB_PATH,
};

export function getReeltorDir(): string {
  return REELTOR_DIR;
}

export function ensureReeltorDir(): void {
  if (!existsSync(REELTOR_DIR)) {
    mkdirSync(REELTOR_DIR, { recursive: true });
  }
  const logsDir = join(REELTOR_DIR, "logs");
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
}

export function loadConfig(): ReeltorConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(config: ReeltorConfig): void {
  ensureReeltorDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}
