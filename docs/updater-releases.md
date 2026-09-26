# Signed updater releases

Sythoria uses Tauri's native updater. It checks the published GitHub Release for `latest.json`, verifies the signed update artifact, installs it, and relaunches the app.

This guide covers the one-time signing setup, local signed builds, releases, and end-to-end testing.

## Important rules

- Never commit a private signing key. `.tauri/*.key` is ignored by Git.
- Back up the private key and its password securely. Once an updater-enabled release is published, losing that key prevents those installations from accepting future updates.
- The public key is safe to commit and must stay in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
- The GitHub release and its assets must be public. The installed app cannot authenticate to a private GitHub Release.

## Create the signing key

The repository already has an updater public key in `src-tauri/tauri.conf.json`. Only generate a new key before the first updater-enabled release. Do not replace it after users have installed an updater-enabled build.

From the repository root:

```sh
mkdir -p .tauri
npm run tauri signer generate -- --write-keys .tauri/sythoria-updater.key
```

Tauri writes the private key to `.tauri/sythoria-updater.key` and the public key to `.tauri/sythoria-updater.key.pub`.

When prompted, use a strong password and store it separately from the key. Copy the full single-line public-key value from the `.pub` file into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.

If the key is generated without a password, omit the password steps below; GitHub Actions still keeps the private key encrypted as a secret.

## Configure GitHub Actions

The release workflow reads these repository Actions secrets:

| Secret                               | Value                                          |
| ------------------------------------ | ---------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | Full contents of `.tauri/sythoria-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password, only when one was set            |

With the GitHub CLI installed and authenticated, set them from the repository root:

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY < .tauri/sythoria-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

The second command securely prompts for the password. Alternatively, add both values in **GitHub repository → Settings → Secrets and variables → Actions**.

## Create a signed local build

Use a packaged build for updater testing; `npm run tauri dev` cannot install an update.

```sh
export TAURI_SIGNING_PRIVATE_KEY="$PWD/.tauri/sythoria-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-key-password"
npm run tauri build
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

If the key has no password, leave out the password export. Avoid placing a real password in shell history; use a prompt or a temporary shell environment instead.

`createUpdaterArtifacts: true` produces the signed artifacts alongside platform bundles:

| Platform | Updater artifact                                                 |
| -------- | ---------------------------------------------------------------- |
| macOS    | `src-tauri/target/release/bundle/macos/*.app.tar.gz` and `.sig`  |
| Windows  | `src-tauri/target/release/bundle/nsis/*.exe` and `.sig`          |
| Linux    | `src-tauri/target/release/bundle/appimage/*.AppImage` and `.sig` |

On macOS, the `app` target must remain in `bundle.targets`. A DMG by itself is not an updater artifact; Tauri packages the `.app` bundle as `.app.tar.gz` for updates.

Tauri verifies the `.sig` content before installing. Native updater signing does not replace platform code signing: use Apple signing/notarization for macOS and a Windows signing certificate for production distribution.

## Publish a release

1. Update the application version using one of the `release:*` scripts, then commit the version changes.
2. Create and push a matching tag, for example `v0.3.1`.
3. The `Release` workflow builds every platform, signs the updater artifacts, and uploads the installers, signatures, and `latest.json` as a draft release.
4. Confirm that the draft has `latest.json` and the matching `.sig` assets, then publish the release.

The updater endpoint is:

```text
https://github.com/sythoria/sythoria-desktop/releases/latest/download/latest.json
```

`releases/latest` excludes drafts, so users cannot discover an update until the release is published.

## Test an update end-to-end

You need two updater-enabled versions. The first migration release must be installed manually because older Sythoria builds only opened GitHub Releases.

1. Build and publish `v0.3.1` with the updater configured, then manually install it.
2. Bump the version to `v0.3.2`, build and publish it using the same signing key.
3. On the installed `v0.3.1` app, open **Settings → General → Check for Updates**.
4. Confirm the update modal shows `v0.3.2`, then select **Download & Install**.
5. Wait for progress to complete. Sythoria should restart, and Settings should report `v0.3.2`.

Before testing the app, verify the published metadata is reachable and complete:

```sh
curl --fail --location https://github.com/sythoria/sythoria-desktop/releases/latest/download/latest.json
```

The JSON must include the new semantic version and a platform entry with both a download URL and signature for the platform under test.

## Troubleshooting

| Symptom                                                  | Likely cause and fix                                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Release workflow cannot create update artifacts          | `TAURI_SIGNING_PRIVATE_KEY` is absent, malformed, or its password secret is missing.                                                                                                                   |
| No update is found                                       | The release is still a draft, `latest.json` is missing, the app version was not increased, or the endpoint is inaccessible.                                                                            |
| Signature verification fails                             | The artifact was signed by a different key than the public key in `tauri.conf.json`. Rebuild with the original private key.                                                                            |
| `darwin-aarch64-app` / `darwin-aarch64` is missing       | The macOS `.app.tar.gz` updater artifact was not built. Keep `app` in `bundle.targets`, rebuild the release, and verify that both `.app.tar.gz` and `.app.tar.gz.sig` were uploaded before publishing. |
| App opens GitHub instead of installing                   | It is an older build without the native updater. Manually install the first updater-enabled release.                                                                                                   |
| macOS says the app is damaged or Windows shows a warning | Configure platform code signing; updater signatures verify update integrity but do not replace OS publisher signing.                                                                                   |
