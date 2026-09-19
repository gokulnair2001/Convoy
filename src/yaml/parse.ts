import fs from "node:fs";
import { parse } from "yaml";
import { expandEnv } from "../util/expand.js";
import { findYamlTestFiles, yamlRoot } from "./walk.js";

const PLATFORMS = new Set(["ios", "android", "web"]);
const TOP_KEYS = new Set(["name", "platforms", "tags", "fixture", "steps"]);
const ACTION_KEYS = new Set([
  "tap",
  "type",
  "into",
  "see",
  "see.not",
  "seeNot",
  "see_not",
  "not",
  "back",
  "which",
]);

export class YamlAuthorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YamlAuthorError";
  }
}

export type YamlPlatform = "ios" | "android" | "web";

export type NormalizedStep =
  | { kind: "tap"; intent: string }
  | { kind: "type"; text: string; into: string }
  | { kind: "see"; intent: string }
  | { kind: "see.not"; intent: string }
  | { kind: "back" }
  | { kind: "which"; branches: Record<string, NormalizedStep[]> };

export interface ParsedYamlTest {
  name: string;
  platforms?: YamlPlatform[];
  tags?: string[];
  fixture?: string;
  steps: NormalizedStep[];
}

export function parseYamlDocument(raw: string, filePath: string): ParsedYamlTest {
  let doc: unknown;
  try {
    doc = parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new YamlAuthorError(`${filePath}: invalid YAML: ${message}`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new YamlAuthorError(`${filePath}: document must be a mapping with name and steps`);
  }

  const rec = doc as Record<string, unknown>;
  const extra = Object.keys(rec).filter((key) => !TOP_KEYS.has(key));
  if (extra.length > 0) {
    throw new YamlAuthorError(`${filePath}: unknown keys: ${extra.join(", ")}`);
  }

  if (typeof rec.name !== "string" || rec.name.trim() === "") {
    throw new YamlAuthorError(`${filePath}: missing name`);
  }
  if (!Array.isArray(rec.steps) || rec.steps.length === 0) {
    throw new YamlAuthorError(`${filePath}: steps must be a non-empty list`);
  }

  return {
    name: rec.name,
    platforms: rec.platforms === undefined ? undefined : parsePlatforms(rec.platforms, filePath),
    tags: rec.tags === undefined ? undefined : parseStringList(rec.tags, filePath, "tags"),
    fixture: rec.fixture === undefined ? undefined : parseFixture(rec.fixture, filePath),
    steps: rec.steps.map((step, index) => normalizeStep(step, filePath, `step[${index}]`)),
  };
}

export function parseYamlTest(raw: string, filePath: string): ParsedYamlTest {
  return parseYamlDocument(raw, filePath);
}

export function loadYamlTests(root: string = yamlRoot()): ParsedYamlTest[] {
  return findYamlTestFiles(root).map((file) => parseYamlDocument(fs.readFileSync(file, "utf8"), file));
}

function parsePlatforms(value: unknown, filePath: string): YamlPlatform[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new YamlAuthorError(`${filePath}: platforms must be a list of ios | android | web`);
  }
  const platforms: YamlPlatform[] = [];
  for (const item of value) {
    if (!PLATFORMS.has(item)) {
      throw new YamlAuthorError(`${filePath}: unknown platform ${JSON.stringify(item)}`);
    }
    platforms.push(item as YamlPlatform);
  }
  return platforms;
}

function parseStringList(value: unknown, filePath: string, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new YamlAuthorError(`${filePath}: ${field} must be a list of strings`);
  }
  return value as string[];
}

function parseFixture(value: unknown, filePath: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new YamlAuthorError(`${filePath}: fixture must be a path string`);
  }
  return value;
}

function normalizeStep(raw: unknown, filePath: string, loc: string): NormalizedStep {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new YamlAuthorError(`${filePath}: ${loc}: each step must be a mapping`);
  }
  const rec = raw as Record<string, unknown>;
  const keys = Object.keys(rec).filter((key) => key !== "name");
  const unknown = keys.filter((key) => !ACTION_KEYS.has(key));
  if (unknown.length > 0) {
    throw new YamlAuthorError(`${filePath}: ${loc}: unknown step keys: ${unknown.join(", ")}`);
  }

  const actions: string[] = [];
  if (keys.includes("tap")) actions.push("tap");
  if (keys.includes("type") || keys.includes("into")) actions.push("type");
  if (keys.includes("see")) actions.push("see");
  if (keys.includes("see.not") || keys.includes("seeNot") || keys.includes("see_not") || keys.includes("not")) {
    actions.push("see.not");
  }
  if (keys.includes("back")) actions.push("back");
  if (keys.includes("which")) actions.push("which");

  if (actions.length === 0) {
    throw new YamlAuthorError(
      `${filePath}: ${loc}: step is missing an action (tap, type, see, see.not, back, which)`,
    );
  }
  if (actions.length > 1) {
    throw new YamlAuthorError(`${filePath}: ${loc}: step has multiple actions: ${actions.join(", ")}`);
  }

  switch (actions[0]) {
    case "tap":
      return { kind: "tap", intent: expandPlain(requireString(rec.tap, filePath, loc, "tap")) };
    case "type":
      return normalizeType(rec, filePath, loc);
    case "see":
      return { kind: "see", intent: expandPlain(requireString(rec.see, filePath, loc, "see")) };
    case "see.not":
      return { kind: "see.not", intent: expandPlain(seeNotIntent(rec, filePath, loc)) };
    case "back":
      if (rec.back !== true) {
        throw new YamlAuthorError(`${filePath}: ${loc}: back must be true`);
      }
      return { kind: "back" };
    case "which":
      return normalizeWhich(rec.which, filePath, loc);
    default:
      throw new YamlAuthorError(`${filePath}: ${loc}: unknown step`);
  }
}

function normalizeType(rec: Record<string, unknown>, filePath: string, loc: string): NormalizedStep {
  const text = requireString(rec.type, filePath, loc, "type");
  const into = expandPlain(requireString(rec.into, filePath, loc, "into"));
  return { kind: "type", text, into };
}

function normalizeWhich(raw: unknown, filePath: string, loc: string): NormalizedStep {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new YamlAuthorError(`${filePath}: ${loc}: which must be a mapping of intent → steps`);
  }
  const rec = raw as Record<string, unknown>;
  const intents = Object.keys(rec);
  if (intents.length < 2) {
    throw new YamlAuthorError(`${filePath}: ${loc}: which needs at least 2 intents`);
  }
  const branches: Record<string, NormalizedStep[]> = {};
  for (const intent of intents) {
    const nested = rec[intent];
    if (nested == null) {
      branches[intent] = [];
      continue;
    }
    if (!Array.isArray(nested)) {
      throw new YamlAuthorError(`${filePath}: ${loc}: which branch ${JSON.stringify(intent)} must be a list of steps`);
    }
    branches[intent] = nested.map((step, index) =>
      normalizeStep(step, filePath, `${loc}.which[${JSON.stringify(intent)}][${index}]`),
    );
  }
  return { kind: "which", branches };
}

function seeNotIntent(rec: Record<string, unknown>, filePath: string, loc: string): string {
  if (typeof rec["see.not"] === "string") return rec["see.not"];
  if (typeof rec.seeNot === "string") return rec.seeNot;
  if (typeof rec.see_not === "string") return rec.see_not;
  if (rec.not !== null && typeof rec.not === "object" && !Array.isArray(rec.not)) {
    const inner = rec.not as Record<string, unknown>;
    if (typeof inner.see === "string") return inner.see;
  }
  throw new YamlAuthorError(
    `${filePath}: ${loc}: see.not must be a string (or not: { see: string })`,
  );
}

function requireString(value: unknown, filePath: string, loc: string, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new YamlAuthorError(`${filePath}: ${loc}: ${field} must be a non-empty string`);
  }
  return value;
}

function expandPlain(value: string): string {
  return expandEnv(value);
}

/** Expand `${ENV}` for typed secrets. Throws if the token is still unset. */
export function expandSecret(value: string, filePath: string, loc: string): string {
  const expanded = expandEnv(value);
  const leftover = expanded.match(/\$\{([A-Z_][A-Z0-9_]*)\}/g);
  if (leftover) {
    const names = leftover.map((token) => token.slice(2, -1)).join(", ");
    throw new YamlAuthorError(
      `${filePath}: ${loc}: Set ${names} in .env (gitignored). Do not put test passwords in the test file.`,
    );
  }
  if (expanded.includes("${")) {
    throw new YamlAuthorError(`${filePath}: ${loc}: type text still contains \${ after expanding env — secrets must be set`);
  }
  return expanded;
}
