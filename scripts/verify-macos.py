"""Validate the signed release artifact, not just source plist files.

Run on macOS after bundling: python3 scripts/verify-macos.py /path/to/App.app
"""
import pathlib
import plistlib
import subprocess
import sys


def verify(app):
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    result = subprocess.run(
        ["codesign", "-d", "--entitlements", ":-", str(app)],
        capture_output=True, check=True,
    )
    if not result.stdout.strip():
        raise ValueError("Signed bundle has no entitlements: microphone capture will be denied")
    entitlements = plistlib.loads(result.stdout)
    if entitlements.get("com.apple.security.device.audio-input") is not True:
        raise ValueError("Signed bundle is missing the audio-input entitlement")
    with (app / "Contents/Info.plist").open("rb") as file:
        info = plistlib.load(file)
    if not info.get("NSMicrophoneUsageDescription", "").strip():
        raise ValueError("Bundle is missing NSMicrophoneUsageDescription")
    print(f"Verified signature and microphone capability: {info['CFBundleShortVersionString']}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python3 scripts/verify-macos.py /path/to/App.app")
    try:
        verify(pathlib.Path(sys.argv[1]))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
