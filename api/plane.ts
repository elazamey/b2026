/**
 * Vercel serverless entry for the public product UI and /admin Control Plane.
 * Guardian does not run here. GitHub Actions remains the execution environment.
 */
export { default, createVercelHandler } from "../src/web/vercel.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 10,
};
