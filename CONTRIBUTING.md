# Contributing to Sythoria 🤝

Thank you for your interest in contributing to Sythoria! We welcome contributions from developers of all skill levels. By participating in this project, you help make Sythoria a better, more secure, and more powerful desktop AI workspace.

This guide outlines our development workflow, coding standards, and the process for submitting contributions.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Ways to Contribute](#ways-to-contribute)
3. [Local Development Setup](#local-development-setup)
4. [Development Workflow](#development-workflow)
5. [Coding Guidelines & Standards](#coding-guidelines--standards)
6. [Testing & Verification](#testing--verification)
7. [Submitting a Pull Request](#submitting-a-pull-request)
8. [Contribution Licensing](#contribution-licensing)

---

## Code of Conduct

We expect all contributors to adhere to a respectful and inclusive code of conduct:

- Use welcoming and inclusive language.
- Be respectful of differing viewpoints and experiences.
- Gracefully accept constructive criticism.
- Focus on what is best for the community.
- Show empathy and kindness towards other community members.

---

## Ways to Contribute

- **Report Bugs**: Submit an issue detailing the bug, including steps to reproduce, expected behavior, and screenshots or logs.
- **Suggest Features**: Propose new ideas, features, or UI improvements via issues.
- **Improve Documentation**: Fix typos, clarify explanations, or add missing documentation in markdown files.
- **Submit Code**: Fix open bugs or implement planned features via Pull Requests.

---

## Local Development Setup

Sythoria is a cross-platform desktop application built using **Tauri v2 (Rust)** and **React 19 (TypeScript)**.

### Prerequisites

Before you begin, ensure you have the following installed on your development machine:

1. **Node.js** (v20 or newer) & **npm**
2. **Rust** stable toolchain (installed via [rustup](https://rustup.rs/))
3. **Git**
4. **Platform-Specific Dependencies**:
   - **Linux (Debian/Ubuntu)**: Tauri requires certain system libraries for compilation:
     ```bash
     sudo apt update
     sudo apt install -y build-essential curl wget file libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
     ```
   - **macOS**: Install Xcode Command Line Tools:
     ```bash
     xcode-select --install
     ```
   - **Windows**: Install the C++ Build Tools via Visual Studio Installer.

### Steps to Run Locally

1. **Fork and Clone the Repository**

   ```bash
   git clone https://github.com/YOUR-USERNAME/sythoria-desktop.git
   cd sythoria-desktop
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

   _Note: This automatically initializes Git Hooks using **Husky** to ensure automatic linting and formatting on commit._

3. **Run the Application in Development Mode**
   ```bash
   npm run tauri dev
   ```
   This compiles the Rust backend, starts the Vite frontend dev server (port 1420), and launches the Tauri desktop window.

---

## Development Workflow

### 1. Branch Naming Conventions

Always create a new branch from `main` for your changes. Use descriptive prefixes followed by a short summary:

- `feature/your-feature-name` (new features or enhancements)
- `bugfix/issue-description` (bug fixes)
- `docs/update-readme` (documentation updates)
- `chore/upgrade-deps` (maintenance, refactoring, dependencies)

### 2. Commit Message Guidelines

We follow **Conventional Commits** for clean and readable repository history. Your commits should be prefixed with an appropriate type:

- `feat:` A new feature for the user
- `fix:` A bug fix
- `docs:` Documentation-only changes
- `style:` Changes that do not affect the meaning of the code (formatting, white-space, missing semi-colons, etc.)
- `refactor:` A code change that neither fixes a bug nor adds a feature
- `perf:` A code change that improves performance
- `test:` Adding missing tests or correcting existing tests
- `chore:` Changes to the build process, tool configs, or auxiliary tools/libraries

_Example:_

```bash
git commit -m "feat: add keyboard shortcut for sidebar toggle"
```

---

## Coding Guidelines & Standards

### Frontend (React & TypeScript)

- **Formatting**: We use **Prettier** for code formatting. You can check or apply formatting using:
  ```bash
  npm run format:check  # Check files
  npm run format        # Apply formatting
  ```
- **Linting**: We use **ESLint 9 (flat config)**. Rules are checked automatically before commit, or manually via:
  ```bash
  npm run lint          # Run linter
  npm run lint:fix      # Automatically fix autofixable issues
  ```
- **Type Checking**: Ensure TypeScript compiles cleanly:
  ```bash
  npm run typecheck
  ```
- **Animations**: Use the motion system defined in `src/lib/motion-tokens.ts` and the `use-safe-motion.ts` hooks to ensure animations respect `prefers-reduced-motion` and perform well on low-end hardware.

### Backend (Rust)

- Follow standard Rust style. Run `cargo fmt` and `cargo clippy` in `src-tauri` to ensure your backend code is clean and idiomatic.

---

## Testing & Verification

Before submitting a Pull Request, verify that all tests pass:

### Frontend Unit Tests

We use **Vitest** with JSDOM for testing React components and Zustand stores:

```bash
npm run test          # Run tests once
npm run test:watch    # Run tests in watch mode
```

### Rust Backend Tests

Run the Rust unit and integration tests:

```bash
cd src-tauri
cargo test
```

---

## Submitting a Pull Request

1. **Verify your build locally**: Ensure `npm run build` compiles without errors.
2. **Push your branch**: Push the feature branch to your fork.
3. **Open a Pull Request**: Submit your PR targeting the `main` branch of the original repository.
4. **Describe the changes**:
   - Provide a clear summary of what your changes do.
   - Mention any related issues (e.g., `Closes #12`).
   - If your changes affect the UI, include before/after screenshots or GIFs.
5. **Participate in Code Review**: Address reviewer feedback and make updates to your branch as needed.

## Contribution Licensing

Sythoria is distributed under the [MIT License](LICENSE). By intentionally submitting a contribution for inclusion in
this repository, you agree to license that contribution under the same MIT terms and represent that you have the
right to do so. You retain copyright in your contribution; no copyright assignment is required.

If your contribution includes or adapts third-party material, identify its source and license in the pull request and
preserve any required copyright, attribution, or notice text. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for
the project's direct dependency notice summary.

Thank you for contributing to Sythoria! 🚀
