const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// node_modules/@workspace/shared 심링크가 pnpm에 의해 생성되지 않을 때를 위한
// 명시적 매핑. watchFolders는 추가하지 않는다 (TypeScript 캐시 디렉토리를
// 감시하다 ENOENT가 발생하는 Metro FallbackWatcher 버그를 피하기 위해).
config.resolver.extraNodeModules = {
  "@workspace/shared": path.resolve(workspaceRoot, "lib/shared"),
};

module.exports = config;
