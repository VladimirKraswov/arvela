// Read-only package checks and a bounded public provenance receipt. No user HOME/config.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const platform = process.argv[2];
const kinds = { macos: ['dmg', '.dmg'], linux: ['deb', '.deb'], windows: ['nsis', '-setup.exe'] };
if (!Object.hasOwn(kinds, platform)) throw Error('Expected macos, linux or windows');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const [folder, suffix] = kinds[platform];
const directory = join('src-tauri', 'target', 'release', 'bundle', folder);
const candidates = (await readdir(directory)).filter(n => n.startsWith(`Arvela_${version}_`) && n.endsWith(suffix));
if (candidates.length !== 1) throw Error(`Expected exactly one current ${platform} package; found ${candidates.length}`);
const file = join(directory, candidates[0]);
const bytes = await readFile(file);
if (bytes.length < 1024) throw Error('Empty or invalid package');
if (platform === 'windows' && bytes.subarray(0, 2).toString() !== 'MZ') throw Error('Installer is not PE');
if (platform === 'linux') {
  const packaged = execFileSync('dpkg-deb', ['--field', file, 'Version'], { encoding: 'utf8' }).trim();
  if (packaged !== version) throw Error('Debian version differs from source');
  const listing = execFileSync('dpkg-deb', ['--contents', file], { encoding: 'utf8' });
  if (!listing.includes('/usr/bin/opencode-desktop') || /Entitlements\.plist|Info\.plist|\.icns\b/.test(listing)) throw Error(`Debian payload/platform isolation failed:\n${listing.slice(0, 8192)}`);
}
if (platform === 'macos') execFileSync('hdiutil', ['verify', file], { stdio: 'inherit' });
const receipt = { schema: 1, version, platform, arch: process.arch, commit: process.env.GITHUB_SHA ?? null,
  artifact: candidates[0], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  node: process.version, rust: execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim(),
  liveAcceptance: 'not-run' };
await mkdir('.local', { recursive: true });
await writeFile('.local/ci-artifacts.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
