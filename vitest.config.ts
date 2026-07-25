import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 테스트는 소스 옆에 *.test.ts로 둔다. node_modules와 빌드 산출물은 제외.
    include: ["{lib,artifacts,scripts}/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
  },
  resolve: {
    // 워크스페이스 패키지는 빌드 없이 소스를 바로 읽는다 (package.json exports와 동일).
    conditions: ["workspace", "import", "node"],
  },
});
