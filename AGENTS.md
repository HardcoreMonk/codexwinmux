# AGENTS.md

AI-generated code should look as if a senior engineer wrote it. Avoid excessive
comments, unnecessary explanations, and AI-specific patterns.

Always respond in the same language the user wrote in. Project rules like
"commit messages in English" apply only to the artifacts they describe.

## Project Overview

- Product: codexwinmux, a Windows-first Codex workspace/session manager.
- Product target: Windows-only service/product transition. Treat the existing
  tmux-centered macOS/Linux server and Electron/Android shell docs as
  legacy/deferred surfaces unless a current transition plan keeps them in scope.
- Framework: Next.js Pages Router with a custom Node server.
- Package manager: pnpm. Prefer `corepack pnpm ...` when running commands.
- Styling: Tailwind CSS v4 and shadcn/ui.
- Language: TypeScript.
- Runtime state: runtime v2 workers plus `~/.codexwinmux/` persisted app state; tmux remains a compatibility/runtime adapter surface.
- Platform shells: Electron desktop app and Capacitor Android app connect to a running codexwinmux server.
- Supported UI languages: Korean and English. Default locale is Korean.

## Core Rules

- Use the Pages Router, not the App Router.
- Do not add `"use client"`.
- `src/proxy.ts` is the auth middleware path for this Next.js version.
- Use `@/` imports instead of relative parent paths.
- Keep filenames lowercase with dashes.
- Prefer arrow functions over `function` declarations.
- Prefix interfaces with `I` and union/alias types with `T`.
- Use lucide-react for icons unless an existing icon component is already local.
- Use react-hook-form, zod, and @hookform/resolvers for forms.
- Use dayjs for date/time handling.
- Use sonner for notifications.
- Keep app screens dense and operational. Do not introduce marketing-style hero layouts into the product UI.
- Preserve terminal/input/reconnect stability over visual polish.

## Commands

```bash
corepack pnpm dev
corepack pnpm build
corepack pnpm lint
corepack pnpm tsc --noEmit
corepack pnpm test
corepack pnpm exec playwright install chromium
corepack pnpm build:electron
corepack pnpm android:build:debug
```

Use pnpm for package management. The shadcn CLI is the one exception:

```bash
npx shadcn@latest add <component-name>
```

## Platform Notes

- Electron code lives under `electron/` and is documented in `docs/ELECTRON.md`.
- Android code lives under `android/`, with launcher assets in `android-web/`, and is documented in `docs/ANDROID.md`.
- Android app ID is `com.hardcoremonk.codexmux`.
- Android debug install verification uses SDK adb, for example `~/Android/Sdk/platform-tools/adb shell pm path com.hardcoremonk.codexmux`.

## Codex And Terminal Rules

When dealing with terminal process names, paths, or Codex session state, reuse
existing utilities. Do not call `pgrep`, `ps`, or `lsof` directly.

Client helpers:

| Function | File | Purpose |
| --- | --- | --- |
| `parseCurrentCommand(raw)` | `src/lib/tab-title.ts` | Extract process name from title |
| `isShellProcess(raw)` | `src/lib/tab-title.ts` | Detect whether the foreground process is a shell |
| `formatTabTitle(raw)` | `src/lib/tab-title.ts` | Convert to tab display name |
| `onTitleChange` | `src/hooks/use-terminal.ts` | Receive title change events |

Server helpers:

| Function | File | Purpose |
| --- | --- | --- |
| `getPaneCurrentCommand(session)` | `src/lib/tmux.ts` | Get foreground process name |
| `getSessionCwd(session)` | `src/lib/tmux.ts` | Get current working directory |
| `getSessionPanePid(session)` | `src/lib/tmux.ts` | Get the pane shell PID |
| `checkTerminalProcess(session)` | `src/lib/tmux.ts` | Safe shell check before resume |
| `isCodexRunning(panePid)` | `src/lib/codex-session-detection.ts` | Check whether Codex is running under the pane |
| `detectActiveCodexSession(panePid)` | `src/lib/codex-session-detection.ts` | Detect active Codex session metadata |
| `watchCodexSessions(panePid, cb)` | `src/lib/codex-session-detection.ts` | Watch Codex session start/stop |

## Shared State

The custom server (`server.ts`) and Next.js API routes run in separate module
graphs inside one Node process. Shared singleton state must live on
`globalThis`, guarded against reinitialization.

```typescript
const g = globalThis as unknown as { __ptFooStore?: Map<string, IFoo> };
if (!g.__ptFooStore) g.__ptFooStore = new Map();
const store = g.__ptFooStore;
```

Preserve nearby key conventions. New shared state should generally use `__pt`
plus a PascalCase name. Keep existing `__codexmux*` or `__cmux*` keys as-is when
editing nearby code.

## UI And Locale Rules

- Default locale is `ko`; keep English support in parallel.
- When changing server-rendered pages that load messages, preserve SSR locale hydration.
- Korean-first screens should use the project font stack and `word-break: keep-all`; terminal, code, diff, path, input, textarea, and xterm areas are exceptions.
- Mobile touch targets should be at least 44px where practical and include `active` plus `focus-visible` states.
- Use notification settings consistently: `notificationsEnabled`, `soundOnCompleteEnabled`, and toast settings all live in `config.json`.

## Documentation

Complex topics live under `docs/`:

| Document | Purpose |
| --- | --- |
| `docs/README.md` | Internal documentation map and update rules |
| `docs/ADR.md` | Architecture decisions and decision triggers |
| `docs/ARCHITECTURE-LOGIC.md` | Architecture flow and service logic |
| `docs/STATUS.md` | Codex work-state detection and status flow |
| `docs/TMUX.md` | tmux, terminal management, and WebSocket flow |
| `docs/DATA-DIR.md` | `~/.codexwinmux/` directory structure |
| `docs/TESTING.md` | Test tiers, Playwright/Chromium, platform smoke, and live deploy checks |
| `docs/WINDOWS-ONLY-GAP-AUDIT.md` | Windows-only product transition gaps and architecture candidates |
| `docs/SYSTEMD.md` | Linux user service operation |
| `docs/PERFORMANCE.md` | Perf snapshot, render/cache optimization, and validation |
| `docs/STYLE.md` | Theme and color usage rules |
| `docs/ELECTRON.md` | Electron desktop development and packaging |
| `docs/ANDROID.md` | Android Capacitor development, build, and install |
| `docs/FOLLOW-UP.md` | Release checks and post-MVP backlog |

When modifying status-related code (`TCliState`, `ITabState`, `StatusManager`,
`selectSessionView`, `agentSessionId`, provider detection, etc.), update
`docs/STATUS.md` together.

When changing durable architecture decisions, update `docs/ADR.md`. This includes framework/router choices, custom server boundaries, shared state placement, tmux/session strategy, provider model, storage layout, platform shells, auth/security, notification semantics, and locale policy. Small component styling changes do not need an ADR unless they change a documented design rule.

## Agent Workflow Contract

- Issue tracker rules live in `docs/agents/issue-tracker.md`.
- Triage label/status mapping lives in `docs/agents/triage-labels.md`.
- Domain docs and ADR consumption rules live in `docs/agents/domain.md`.
- Do not create, close, or relabel issues, or commit/push changes, unless the user explicitly asks.

## Comment Policy

Only add comments when they explain why something non-obvious is needed. Avoid
comments that restate what the code already says.

## Refactoring Exclusions

Do not refactor third-party component folders unless required:

| Directory | Description |
| --- | --- |
| `src/components/ui/` | shadcn/ui components |
| `src/components/ai-elements/` | AI Elements components |

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing any code. Heed deprecation
notices.
<!-- END:nextjs-agent-rules -->

## Plan Grilling
- `grill-me`는 원본 installer를 설치하지 않고 Codex zone의 `Plan Grilling` workflow로 사용한다.
- 신규 기능/프로젝트 설계는 `superpowers:brainstorming`이 만든 `writing-spec` 산출물을 기준으로 `domain-architecture` pass를 먼저 수행한 뒤, `superpowers:writing-plans` 전에 `grill-me 방식으로 검토해줘`라고 호출한다.
- `writing-spec`은 별도 lifecycle gate가 아니라 `superpowers:brainstorming`의 design spec 산출물이다.
- 질문은 한 번에 하나만 하고, 각 질문에는 Codex의 추천 답을 함께 제시한다.
- 코드/문서로 확인 가능한 내용은 사용자에게 묻지 않고 직접 확인한다.
- `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/adr/`가 있으면 용어 충돌과 ADR 후보를 함께 검토한다.
- `npx skills@latest add mattpocock/skills`, `scripts/link-skills.sh`, Claude hook installer는 실행하지 않는다.

## Lifecycle Control Plane
- 표준 lifecycle contract는 zone 상대 경로 `codex-project-mgmt/docs/codex-lifecycle-control-plane.md`를 따른다.
- 기본 순서: `intake -> office-hours optional -> superpowers:brainstorming / writing-spec -> domain-architecture -> grill-me -> plan-design-review -> superpowers:writing-plans -> plan-eng-review -> implement -> code-review -> release -> operate`.
- 실제 spec, grill-me 기록, plan, handoff는 해당 project root의 project-local 산출물로 둔다.
- 새 기능, behavior change, workflow contract change, multi-file change는 lightweight path를 사용하지 않는다.
- `release` 이후에는 `docs/operations/YYYY-MM-DD-<topic>-handoff.md` 또는 project-equivalent handoff로 운영 진입 상태를 기록한다.
