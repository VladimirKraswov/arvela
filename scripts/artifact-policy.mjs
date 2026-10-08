// dpkg-deb accepts both tar-relative and ./-prefixed member names.
// Require the exact regular executable; a directory/symlink/name substring is insufficient.
export function assertDebianPayload(listing) {
  const executable = /^-..x......\s.+\s(?:\.\/|\/)?usr\/bin\/opencode-desktop\s*$/m.test(listing);
  if (!executable || /Entitlements\.plist|Info\.plist|\.icns\b/.test(listing)) {
    throw Error(`Debian payload/platform isolation failed:\n${listing.slice(0, 8192)}`);
  }
}
