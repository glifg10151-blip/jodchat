# Third-party notices

Sythoria is licensed under the [MIT License](LICENSE). It also incorporates third-party open-source software whose
authors retain their respective copyrights. Those components remain subject to their own license terms; Sythoria's
MIT license does not replace or modify them.

The exact dependency versions used by a build are recorded in `package-lock.json` and `src-tauri/Cargo.lock`. The
tables below summarize direct runtime dependencies and the SPDX license expressions declared by their package
metadata. Transitive dependencies and platform-specific build selections are recorded in those lockfiles and in the
corresponding package source distributions.

## JavaScript runtime dependencies

| Components                                                                                                                                                        | Declared license      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-log`, `@tauri-apps/plugin-opener`, `@tauri-apps/plugin-process`, `@tauri-apps/plugin-updater` | MIT OR Apache-2.0     |
| `@xterm/xterm`, `@xterm/addon-fit`                                                                                                                               | MIT                   |
| `dompurify`                                                                                                                                                       | MPL-2.0 OR Apache-2.0 |
| `highlight.js`                                                                                                                                                    | BSD-3-Clause          |
| `lucide-react`                                                                                                                                                    | ISC                   |
| `katex`, `lowlight`, `motion`, `react`, `react-dom`, `react-markdown`, `react-virtuoso`, `rehype-katex`, `remark-gfm`, `remark-math`, `zod`, `zustand`            | MIT                   |

## Rust runtime dependencies

| Components                                                                                                                                                                                                                         | Declared license   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `tauri`, Tauri plugins, `serde`, `serde_json`, `reqwest`, `futures-util`, `url`, `chrono`, `uuid`, `thiserror`, `log`, `keyring-core`, `window-vibrancy`, `base64`, `zeroize`, `image`, `regex`, and the platform keyring backends | MIT OR Apache-2.0  |
| `tokio`, `tokio-util`, `tokio-tungstenite`, `urlencoding`, `which`, `smappservice-rs`, `portable-pty`                                                                                                                              | MIT                |
| `rmcp`, `xcap`, `cpal`                                                                                                                                                                                                             | Apache-2.0         |
| `ring`                                                                                                                                                                                                                             | Apache-2.0 AND ISC |
| `ignore`                                                                                                                                                                                                                           | Unlicense OR MIT   |
| `whisper-rs`                                                                                                                                                                                                                       | Unlicense          |

## Bundled fonts

| Component | Version | Declared license |
| --------- | ------- | ---------------- |
| Nerd Fonts Symbols Only Mono (`SymbolsNerdFontMono-Regular.ttf`) | 3.5.0 | MIT |

The Nerd Fonts license text is distributed with the font at
`src/assets/fonts/NERD_FONTS_LICENSE.txt`.

License texts and package-specific notices are available from each package's source distribution and the canonical
[SPDX License List](https://spdx.org/licenses/). Distributors should preserve any attribution or notice files shipped
by dependencies and review the locked dependency set for the target platform when preparing binary distributions.
