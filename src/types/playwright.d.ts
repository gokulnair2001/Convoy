declare module "playwright" {
  export const chromium: {
    launch: (opts: { headless: boolean }) => Promise<{
      newPage: () => Promise<unknown>;
      close: () => Promise<void>;
    }>;
  };
}
