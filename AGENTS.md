# Repository Guidelines

## Project Structure & Module Organization
- `src/` runs the Axum-based service; `proxy`, `routing`, `realtime`, and `config` modules power the request pipeline and persist profiles under `~/.paf/`.
- `frontend/` hosts the Vite/React dashboard; shadcn UI lives in `src/components/`, i18n files in `public/locales/`. The frontend is automatically built and embedded during Cargo builds via `build.rs`.
- `cli_proxy/` archives the previous Python CLI (`pyproject.toml`, entry `src/main.py`, static assets under `src/ui/static`) and serves as a reference for the current project.
- CLI commands: `paf start` runs the service as a daemon, `paf dev` runs in foreground mode, `paf ui` opens the web dashboard.

## Build, Test, and Development Commands
- Initial setup: `cargo build` automatically installs Node dependencies and builds the frontend via `build.rs`.
- Development: `paf dev` runs the backend in foreground mode; for frontend development, also run `cd frontend && npm run dev` in a separate terminal.
- Production: `cargo build --release` builds and embeds the optimized frontend bundle.
- Backend guardrails: `cargo check`, `cargo +nightly fmt`, `cargo clippy`, `cargo test`.
- Frontend workflow: `cd frontend && npm run dev`, `npm run build`, `npm run type-check`, `npm run lint`.
- CLI work: `pip install -e cli_proxy` then `python -m src.main --help` for smoke tests.

## Coding Style & Naming Conventions
- `rustfmt.toml` enforces two-space indentation and crate-level import grouping; keep files `snake_case.rs`, types `PascalCase`, and rely on `cargo +nightly fmt` plus `cargo clippy`.
- Write inline comments and docstrings in English to keep reviews consistent across teams.
- React files follow `PascalCase.tsx` for components and `camelCase.ts` for hooks/utilities; reuse Tailwind tokens defined in `tailwind.config.ts`.
- Python modules respect PEP 8 naming and should avoid import-time side effects.

## Testing Guidelines
- Co-locate Rust unit tests via `#[cfg(test)]`; promote broader scenarios to `tests/` as they emerge.
- After touching routing or config, run `cargo test` and perform a smoke pass with `paf dev` and check the dashboard at http://localhost:8800.
- Frontend safety: `cd frontend && npm run type-check`, `npm run lint`; add Vitest or Playwright for WebSocket-heavy UI.

## Commit & Pull Request Guidelines
- With no history yet, write short, imperative summaries (e.g., `Add realtime request monitor`) and keep each commit scoped to a single concern.
- Reference the affected area (backend, frontend, cli) in the body, link issues, and call out schema or config migrations.
- Pull requests need a focused description, screenshots for UI tweaks, and clear test evidence (`cargo test`, `npm run build`, etc.); update docs when workflows change.

## Security & Configuration Tips
- Never commit secrets from `~/.paf/*.toml`, `.env`, or build artifacts such as `frontend/node_modules`; extend `.gitignore` as needed.
- When altering config schemas, supply migrations and update `ARCHITECTURE.md`; ensure logs do not expose credentials.
