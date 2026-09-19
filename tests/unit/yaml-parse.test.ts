import { afterEach, describe, expect, it } from "vitest";
import { executeSteps } from "../../src/yaml/execute.js";
import { parseYamlDocument, parseYamlTest, YamlAuthorError } from "../../src/yaml/parse.js";

const SAMPLE = `
name: driver signs in
platforms: [ios]
tags: [smoke]
fixture: tests/fixtures/signin.json
steps:
  - name: credentials
    type: \${API_TOKEN}
    into: the search field
  - tap: Continue
  - type: \${PASSWORD}
    into: Password
  - tap: Log in
  - which:
      logged in on another device:
        - tap: Continue Anyway
      the home screen: []
  - see: the home screen
  - 'see.not': an error message
  - back: true
`;

const ENV_KEYS = ["API_TOKEN", "PASSWORD"] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

function parseWithSecrets(raw = SAMPLE, filePath = "signin.e2e.yaml") {
  process.env.API_TOKEN = "tok-123";
  process.env.PASSWORD = "secret-pass";
  return parseYamlDocument(raw, filePath);
}

function mockSteps(whichResult = "the home screen") {
  const calls: string[] = [];
  const see = Object.assign(async (intent: string) => {
    calls.push(`see:${intent}`);
  }, {
    not: async (intent: string) => {
      calls.push(`see.not:${intent}`);
    },
  });
  return {
    calls,
    t: {
      tap: async (intent: string) => {
        calls.push(`tap:${intent}`);
      },
      type: async (text: string, opts: { into: string }) => {
        calls.push(`type:${text}:${opts.into}`);
      },
      see,
      which: async (intents: string[]) => {
        calls.push(`which:${intents.join("|")}`);
        return whichResult;
      },
      back: async () => {
        calls.push("back");
      },
    },
  };
}

describe("parseYamlDocument", () => {
  it("parses the happy path including which, see.not, and ${ENV} tokens", () => {
    const doc = parseYamlDocument(SAMPLE, "signin.e2e.yaml");
    expect(doc.name).toBe("driver signs in");
    expect(doc.platforms).toEqual(["ios"]);
    expect(doc.tags).toEqual(["smoke"]);
    expect(doc.fixture).toBe("tests/fixtures/signin.json");
    expect(doc.steps).toEqual([
      { kind: "type", text: "${API_TOKEN}", into: "the search field" },
      { kind: "tap", intent: "Continue" },
      { kind: "type", text: "${PASSWORD}", into: "Password" },
      { kind: "tap", intent: "Log in" },
      {
        kind: "which",
        branches: {
          "logged in on another device": [{ kind: "tap", intent: "Continue Anyway" }],
          "the home screen": [],
        },
      },
      { kind: "see", intent: "the home screen" },
      { kind: "see.not", intent: "an error message" },
      { kind: "back" },
    ]);
    expect(parseYamlTest(SAMPLE, "signin.e2e.yaml")).toEqual(doc);
  });

  it("accepts seeNot, see_not, and not: { see } as see.not", () => {
    const raw = `
name: asserts absence
steps:
  - seeNot: banner
  - see_not: toast
  - not:
      see: modal
`;
    const doc = parseYamlDocument(raw, "absent.e2e.yaml");
    expect(doc.steps).toEqual([
      { kind: "see.not", intent: "banner" },
      { kind: "see.not", intent: "toast" },
      { kind: "see.not", intent: "modal" },
    ]);
  });

  it("throws when name is missing", () => {
    expect(() => parseYamlDocument("steps:\n  - tap: Go\n", "anon.e2e.yaml")).toThrow(YamlAuthorError);
    expect(() => parseYamlDocument("steps:\n  - tap: Go\n", "anon.e2e.yaml")).toThrow(/anon\.e2e\.yaml: missing name/);
  });

  it("throws when steps are empty", () => {
    expect(() => parseYamlDocument("name: empty\nsteps: []\n", "empty.e2e.yaml")).toThrow(
      /empty\.e2e\.yaml: steps must be a non-empty list/,
    );
  });

  it("throws a file+index error for unknown step keys", () => {
    expect(() =>
      parseYamlDocument("name: bad\nsteps:\n  - tap: Go\n  - swipe: left\n", "bad.e2e.yaml"),
    ).toThrow(/bad\.e2e\.yaml: step\[1\]: unknown step keys: swipe/);
  });

  it("expands type secrets at execute time, not parse time", async () => {
    delete process.env.API_TOKEN;
    const doc = parseYamlDocument(
      "name: secrets\nsteps:\n  - type: ${API_TOKEN}\n    into: the search field\n",
      "secrets.e2e.yaml",
    );
    expect(doc.steps[0]).toEqual({ kind: "type", text: "${API_TOKEN}", into: "the search field" });
    const { t } = mockSteps();
    await expect(executeSteps(t, doc.steps, { file: "secrets.e2e.yaml" })).rejects.toThrow(
      /secrets\.e2e\.yaml: step\[0\]: Set API_TOKEN in \.env/,
    );
  });

  it("leaves unset ${NAME} in into and see intents", () => {
    const doc = parseYamlDocument(
      "name: tokens\nsteps:\n  - tap: ${CONVOY_UNSET_INTENT}\n  - see: ${CONVOY_UNSET_SCREEN}\n",
      "tokens.e2e.yaml",
    );
    expect(doc.steps).toEqual([
      { kind: "tap", intent: "${CONVOY_UNSET_INTENT}" },
      { kind: "see", intent: "${CONVOY_UNSET_SCREEN}" },
    ]);
  });
});

describe("executeSteps", () => {
  it("runs tap/type/see/see.not/which/back against a mock Steps", async () => {
    const doc = parseWithSecrets();
    const { t, calls } = mockSteps("the home screen");
    await executeSteps(t, doc.steps);
    expect(calls).toEqual([
      "type:tok-123:the search field",
      "tap:Continue",
      "type:secret-pass:Password",
      "tap:Log in",
      "which:logged in on another device|the home screen",
      "see:the home screen",
      "see.not:an error message",
      "back",
    ]);
  });

  it("runs nested taps only on the matched which branch", async () => {
    const doc = parseWithSecrets();
    const other = mockSteps("logged in on another device");
    await executeSteps(other.t, doc.steps);
    expect(other.calls).toContain("tap:Continue Anyway");

    const home = mockSteps("the home screen");
    await executeSteps(home.t, doc.steps);
    expect(home.calls).not.toContain("tap:Continue Anyway");
    expect(home.calls.filter((c) => c.startsWith("tap:"))).toEqual(["tap:Continue", "tap:Log in"]);
  });
});
