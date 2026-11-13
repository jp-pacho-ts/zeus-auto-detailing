// P1-82: browser only, before the app code. Zod's JIT probe (new Function) trips the CSP "no eval" rule; the CSP already blocks the JIT, so validation is unchanged.
import { config } from "zod/v4/core";

config({ jitless: true });
