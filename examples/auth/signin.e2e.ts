import { e2e } from "convoy-e2e";

e2e.serial("driver signs in", { platforms: ["ios"], tags: ["smoke"] }, (step) => {
  step("enters credentials", async (t) => {
    await t.type(secret("USERNAME"), { into: "Email / Username" });
    await t.tap("Continue");
  });

  step("submits and goes home", async (t) => {
    await t.type(secret("PASSWORD"), { into: "Password" });
    await t.tap("Log in");

    const screen = await t.which([
      "logged in on another device",
      "the home screen",
    ]);
    if (screen === "logged in on another device") {
      await t.tap("Continue Anyway");
    }
    await t.see("the home screen");
  });
});

function secret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env (gitignored).`);
  return value;
}
