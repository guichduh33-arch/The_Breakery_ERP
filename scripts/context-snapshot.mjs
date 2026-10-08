#!/usr/bin/env node

import { extname } from "node:path";
import { ROOT, git } from './agents/lib.mjs';

const usage = `
Usage:
  node scripts/context-snapshot.mjs <profile> [--include-binary] [--json]

Profiles:
  pos         (apps/pos + packages partagés utiles)
  backoffice  (apps/backoffice + packages partagés utiles)
  domain      (packages/domain + packages/utils)
  supabase    (supabase + packages/supabase)
`;

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
  process.stdout.write(usage.trim() + "\n");
  process.exit(0);
}

const includeBinary = args.includes("--include-binary");
const asJson = args.includes("--json");
let profile = args.find((value) => !value.startsWith("--"));

const profileAliases = {
  bo: "backoffice",
};

if (profile && Object.hasOwn(profileAliases, profile)) {
  profile = profileAliases[profile];
}

const profiles = {
  pos: [
    "apps/pos",
    "packages/domain",
    "packages/ui",
    "packages/supabase",
    "packages/utils",
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
  ],
  backoffice: [
    "apps/backoffice",
    "packages/domain",
    "packages/ui",
    "packages/supabase",
    "packages/utils",
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
  ],
  domain: [
    "packages/domain",
    "packages/utils",
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
  ],
  supabase: [
    "supabase/migrations",
    "supabase/functions",
    "supabase/tests",
    "supabase/config.toml",
    "supabase/seed.sql",
    "packages/supabase",
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
  ],
};

const gitCmd = {
  pos: profiles.pos,
  backoffice: profiles.backoffice,
  domain: profiles.domain,
  supabase: profiles.supabase,
};

if (!Object.hasOwn(gitCmd, profile)) {
  process.stderr.write(`Profil inconnu: ${profile}\n`);
  process.stdout.write(usage.trim() + "\n");
  process.exit(1);
}

// Zones vivantes : sources, assets publics et configuration immédiate des packages.
const paths = gitCmd[profile].flatMap((path) => /^(apps|packages)\//.test(path)
  ? [`${path}/src`, `${path}/public`, `${path}/.env.example`,
    ...['json', 'ts', 'js', 'md', 'html'].map((ext) => `:(glob)${path}/*.${ext}`)]
  : [path]);

const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".bmp",
  ".avif",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

const rawFiles = git(['ls-files', '-z', '--', ...paths], ROOT)
  .split("\0")
  .filter(Boolean);

const files = rawFiles.filter((file) => {
  if (!includeBinary) {
    const ext = extname(file).toLowerCase();
    if (binaryExtensions.has(ext)) {
      return false;
    }
  }
  return true;
});

if (asJson) {
  const output = {
    profile,
    includeBinary,
    count: files.length,
    files: files.sort(),
  };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  process.exit(0);
}

for (const file of files.sort()) {
  process.stdout.write(`${file}\n`);
}
console.error(`Context profile: ${profile}`);
console.error(`Files: ${files.length}`);
