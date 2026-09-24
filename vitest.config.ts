import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      TESLA_MOCK: "1",
    },
  },
});
