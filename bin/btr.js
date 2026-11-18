#!/usr/bin/env bun
import { run } from "../src/cli/btr.ts";
process.exit(await run(process.argv.slice(2), console.log));
