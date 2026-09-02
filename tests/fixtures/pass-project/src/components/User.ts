import { formatName } from "../lib/format.js";

export function User(name: string): string {
  return formatName(name);
}
