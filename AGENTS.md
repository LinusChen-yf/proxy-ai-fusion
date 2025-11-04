# Repository Guidelines

## Project Structure & Module Organization
`server/` contains the Bun backend with modular folders for `config/`, `routing/`, `proxy/`, and `logging/`; it reads and writes service profiles under `~/.paf/`. The React dashboard lives in `src/` (components, hooks, services, styles) and is bundled straight into `public/assets/`. Built server artifacts land in `dist/`, while `public/` serves static files and generated CSS/JS bundles. Use `test/` for Bun-powered integration and unit tests as they are added. The legacy Python CLI is archived in `cli_proxy/` for reference only—do not modify it unless porting behavior.

## Build, Test, and Development Commands
Install dependencies with `bun install`. `bun run dev` now invokes `scripts/dev.ts`, which supervises Tailwind, the browser bundle, and `bun run --hot server/index.ts` so changes land instantly without manual restarts. Ship builds via `bun run build` (frontend + server); `bun run build:frontend` or `bun run build:server` target individual steps. `bun run start` executes the compiled server from `dist/index.js`. Clean generated artifacts with `bun run clean`. Type safety lives under `bun run type-check`.

## Coding Style & Naming Conventions
TypeScript files lean on Bun’s ESM tooling—keep imports sorted logically and favor concise modules. React components use `PascalCase.tsx`, hooks/utilities use `camelCase.ts`, and shared types live in `src/types/`. Tailwind tokens and animations are declared once in `tailwind.config.ts`, and global styles start at `src/styles/globals.css`. Follow Prettier-style two-space indentation and keep log messages actionable; backend helpers should include short JSDoc when behavior is non-obvious.

## Testing Guidelines
Place Bun `test()` suites under `test/` or co-locate lightweight specs beside the module when that improves readability. Run `bun test` before submitting changes and pair it with `bun run type-check` to catch structural regressions. For proxy or routing changes, exercise `bun run dev` and manually confirm the dashboard at `http://localhost:8800` can proxy requests for both services. Capture tricky integration scenarios with fixture TOML files under a temporary directory rather than touching `~/.paf/`.

## Commit & Pull Request Guidelines
Write short, imperative commit messages (`Add load balancer health checks`) and scope each commit to one concern (frontend, server, config, docs). Reference relevant areas in the body (e.g. `server/routing`, `src/components`) and note when you touched persisted config formats. Pull requests should include a summary, linked issues, screenshots or terminal recordings for UI/CLI updates, and a checklist of executed commands such as `bun test`, `bun run build`, or targeted smoke tests.

## Security & Configuration Tips
Never commit personal TOML files from `~/.paf/`, `.env` secrets, or generated bundles under `public/assets/` and `dist/`. When evolving configuration schemas, provide upgrade notes, keep defaults backward compatible, and ensure logs redact API keys or tokens before writing to disk.
