const DEFAULT_MANIFEST_URL = "https://github.com/sythoria/sythoria-desktop/releases/latest/download/latest.json";

export function validateUpdaterManifest(manifest, expectedVersion, expectedPlatformPrefixes) {
  if (!manifest || typeof manifest !== "object") throw new Error("Updater manifest must be a JSON object");
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("Updater manifest is missing a version");
  }
  if (expectedVersion && manifest.version !== expectedVersion.replace(/^v/, "")) {
    throw new Error(`Expected updater version ${expectedVersion}, received ${manifest.version}`);
  }
  if (!manifest.platforms || typeof manifest.platforms !== "object") {
    throw new Error("Updater manifest is missing platform entries");
  }

  const entries = Object.entries(manifest.platforms);
  if (entries.length === 0) throw new Error("Updater manifest contains no platform entries");
  for (const [platform, artifact] of entries) {
    if (!artifact || typeof artifact !== "object") throw new Error(`Invalid artifact for ${platform}`);
    if (typeof artifact.url !== "string" || !artifact.url.startsWith("https://")) {
      throw new Error(`Updater artifact for ${platform} must use HTTPS`);
    }
    if (typeof artifact.signature !== "string" || artifact.signature.trim().length === 0) {
      throw new Error(`Updater artifact for ${platform} is missing its signature`);
    }
  }

  for (const prefix of expectedPlatformPrefixes) {
    if (!entries.some(([platform]) => platform.startsWith(prefix))) {
      throw new Error(`Updater manifest is missing a supported ${prefix.replace(/-$/, "")} platform`);
    }
  }
  return entries.map(([platform]) => platform);
}

async function main() {
  const manifestUrl = process.env.UPDATER_MANIFEST_URL || DEFAULT_MANIFEST_URL;
  const response = await fetch(manifestUrl, { redirect: "error" });
  if (!response.ok) throw new Error(`Updater manifest returned HTTP ${response.status}`);
  const manifest = await response.json();
  const prefixes = (process.env.EXPECTED_PLATFORM_PREFIXES || "windows-,linux-,darwin-")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const platforms = validateUpdaterManifest(manifest, process.env.EXPECTED_VERSION || "", prefixes);
  console.log(`Verified updater ${manifest.version}: ${platforms.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
import { pathToFileURL } from "node:url";
