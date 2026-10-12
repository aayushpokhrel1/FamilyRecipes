// Writes the commit this build came from into dist/prerender/version.txt, which the Worker
// serves at /health/version. That is what makes a deploy VERIFIABLE: without it, a push that
// never built is indistinguishable from one that did, because the old Worker keeps serving
// 200s. On 2026-10-12 five commits sat undeployed for over three hours for exactly that
// reason, and nothing anywhere went red.
//
// SEPARATE FROM scripts/prerender.mjs ON PURPOSE, though both write into the same directory.
// This file is the alarm and that one is a thing the alarm watches; folding them together
// would mean a prerender failure also silently takes out the check that would have reported
// it.
//
// It lands under prerender/ so it inherits that path's two existing guards: route() refuses
// /prerender/ as a public path, and robots.txt disallows it. A new location would need both
// written again.
import { mkdir, writeFile } from "node:fs/promises";

// Cloudflare Workers Builds sets WORKERS_CI_COMMIT_SHA. GitHub Actions sets GITHUB_SHA, so a
// deploy from CI would stamp correctly too. Neither is set on a developer's machine, where
// "dev" is the honest answer: CI only ever compares against a real SHA, so "dev" can never
// look like a successful deploy.
const sha = (process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || "dev").trim();

const OUT_DIR = new URL("../dist/prerender/", import.meta.url);
await mkdir(OUT_DIR, { recursive: true });
await writeFile(new URL("version.txt", OUT_DIR), sha, "utf8");
console.log(`stamp-version: ${sha}`);
