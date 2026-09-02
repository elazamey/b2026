/**
 * Vercel serverless entry for the read-only Control Plane.
 * Guardian does not run here. GitHub Actions remains the execution environment.
 */
export { default, createVercelHandler } from "../src/control-plane/vercel.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 10,
};
