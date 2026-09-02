import type { CheckName, CheckResult, ScanContext } from "../types.js";
import { scanArchitecture } from "./architecture.js";
import { scanBoundaries } from "./boundaries.js";
import { scanDependencies } from "./dependencies.js";
import { scanBuild, scanTests } from "./quality.js";
import { scanSecurity } from "./security.js";

export const SCANNERS: Record<CheckName, (ctx: ScanContext) => CheckResult> = {
  architecture: scanArchitecture,
  dependencies: scanDependencies,
  security: scanSecurity,
  boundaries: scanBoundaries,
  tests: scanTests,
  build: scanBuild,
};

export { scanArchitecture, scanBoundaries, scanDependencies, scanSecurity, scanTests, scanBuild };
