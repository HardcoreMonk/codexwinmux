# systemd user service

codexmux는 Linux에서 `systemd --user` 서비스로 상시 실행하는 방식을 권장한다. system-wide 서비스로 실행하면 `~/.codexmux/`, `~/.codex/sessions/`, 사용자 tmux socket, NVM Node 경로가 root 또는 다른 사용자 기준으로 바뀔 수 있다.

## 현재 워크스테이션

현재 등록된 서비스:

```text
~/.config/systemd/user/codexmux.service
```

현재 네트워크와 포트:

```text
HOST=localhost,tailscale,192.168.0.0/16
PORT=8121
```

접속 범위:

| 값 | 범위 |
|---|---|
| `localhost` | `127.0.0.0/8`, `::1/128` |
| `tailscale` | `100.64.0.0/10`, `fd7a:115c:a1e0::/48` |
| `192.168.0.0/16` | 사설 LAN 중 192.168.x.x 대역 |

## 서비스 파일

`~/.config/systemd/user/codexmux.service`:

```ini
[Unit]
Description=codexmux web session manager
Documentation=https://github.com/HardcoreMonk/codexmux

[Service]
Type=simple
WorkingDirectory=/data/projects/codex-zone/codexmux
Environment=NODE_ENV=production
Environment=HOST=localhost,tailscale,192.168.0.0/16
Environment=PORT=8121
Environment=PATH=/home/hardcoremonk/.nvm/versions/node/v24.15.0/bin:/home/hardcoremonk/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/home/hardcoremonk/.nvm/versions/node/v24.15.0/bin/node /data/projects/codex-zone/codexmux/bin/codexmux.js
Restart=on-failure
RestartSec=3
KillSignal=SIGINT
SuccessExitStatus=130
TimeoutStopSec=20

[Install]
WantedBy=default.target
```

Runtime v2 mode는 base unit을 직접 수정하지 않고 drop-in으로 적용한다. 전체 runtime v2 rollback은 drop-in 삭제와 daemon reload/restart로 처리한다.

```text
~/.config/systemd/user/codexmux.service.d/runtime-v2-shadow.conf
```

```ini
[Service]
Environment=CODEXMUX_RUNTIME_V2=1
Environment=CODEXMUX_RUNTIME_STORAGE_V2_MODE=default
Environment=CODEXMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs
Environment=CODEXMUX_RUNTIME_TIMELINE_V2_MODE=default
Environment=CODEXMUX_RUNTIME_STATUS_V2_MODE=default
```

Phase 6 code fallback 이후에는 `CODEXMUX_RUNTIME_V2=1`만 남겨도 unset surface mode가
terminal `new-tabs`, storage/timeline/status `default`로 해석된다. 운영 중 의도를 명확히
보이게 하려면 위처럼 명시 값을 유지한다. Surface rollback만 필요하면 해당 mode를 `off`로
설정한 뒤 daemon reload/restart를 수행한다. 전체 runtime v2 rollback:

```bash
rm ~/.config/systemd/user/codexmux.service.d/runtime-v2-shadow.conf
systemctl --user daemon-reload
systemctl --user restart codexmux.service
```

`KillSignal=SIGINT`는 terminal/WebSocket shutdown을 정리할 시간을 주기 위한 설정이다. Node 계열 프로세스는 SIGINT 종료를 exit code 130으로 남길 수 있으므로 `SuccessExitStatus=130`을 같이 둬서 `systemctl --user restart codexmux.service`가 의도된 중지인데도 journal에 실패처럼 남지 않게 한다.

Node를 NVM으로 관리하는 환경에서는 `ExecStart`와 `PATH`의 Node 버전 경로가 실제 `command -v node` 결과와 일치해야 한다. Node 버전을 바꾸면 이 파일도 함께 갱신한다.

## 등록과 시작

```bash
mkdir -p ~/.config/systemd/user
systemctl --user daemon-reload
systemctl --user enable --now codexmux.service
```

로그인하지 않은 상태에서도 서비스를 시작해야 하면 linger를 켠다.

```bash
loginctl enable-linger "$USER"
```

현재 상태 확인:

```bash
systemctl --user status codexmux.service
systemctl --user is-enabled codexmux.service
loginctl show-user "$USER" -p Linger
```

## 운영 명령

```bash
systemctl --user restart codexmux.service
systemctl --user stop codexmux.service
systemctl --user start codexmux.service
journalctl --user -u codexmux.service -f
```

health check:

```bash
curl -sS http://127.0.0.1:8121/api/health
```

정상 응답 형식:

```json
{"app":"codexmux","version":"0.4.1","commit":"<deployed-git-short-hash>","buildTime":"<iso-build-time>"}
```

## 빌드와 재시작

소스 체크아웃을 기준으로 실행하지만, 프로덕션 서비스는 `src/` 파일을 직접 로드하지 않는다. `bin/codexmux.js`는 빌드 산출물인 `dist/server.js`와 Next.js standalone/static asset을 실행하므로 서버, WebSocket route, timeline parser, dedupe, API, 배포 관련 코드를 바꾼 뒤에는 production build를 갱신한 다음 서비스를 재시작한다.

```bash
corepack pnpm deploy:local
curl -fsS http://127.0.0.1:8121/api/health
```

`deploy:local`은 `corepack pnpm build`, `systemctl --user restart codexmux.service`, health check를 한 번에 실행한다. 정상 응답은 `app`, `version`, `commit`, `buildTime`을 포함한다. 브라우저가 이전 hashed chunk를 들고 있으면 UI 동작이 오래된 것처럼 보일 수 있으므로, 배포 후에도 타임라인 표시가 예전과 같으면 페이지를 새로고침한다. 이미 화면에 쌓인 중복 메시지는 새 parser로 초기 snapshot을 다시 읽을 때 정규화된다.

`corepack pnpm build:electron`처럼 `.next/standalone`을 다시 만드는 명령을 live checkout에서 실행하면 실행 중인 service process의 cwd가 삭제된 standalone directory를 가리킬 수 있다. 현재 server는 `__CMUX_APP_DIR` 기준으로 build info와 daily report child cwd를 보정하지만, 운영 상태를 깔끔하게 유지하려면 Electron build smoke 뒤에 `corepack pnpm deploy:local`로 service cwd를 정상화한다.

## Lifecycle Control actions

`/experimental/runtime`의 Lifecycle Control panel은 임의 shell 입력을 받지 않고 서버 allowlist action만 실행한다. 현재 action은 `phase6-gate`, `restart-service`, `deploy-local`이다.

| Action | 실행 | 확인 |
| --- | --- | --- |
| `phase6-gate` | `corepack pnpm smoke:runtime-v2:phase6-default-gate` | 없음 |
| `restart-service` | `systemctl --user restart codexmux.service` | `restart codexmux.service` |
| `deploy-local` | `corepack pnpm deploy:local` | `deploy local` |

한 번에 하나의 action만 실행된다. `restart-service`와 `deploy-local`은 요청 중인 서버 process를 재시작할 수 있으므로 브라우저 요청이 중간에 끊길 수 있다. 이 경우 `/api/health` 새로고침 또는 페이지 reload로 배포 commit과 service 상태를 다시 확인한다. 실행 기록은 `~/.codexmux/lifecycle-actions.jsonl`에 action id, status, timestamp, duration, exit code, sanitized failure label만 남기며 stdout/stderr, env, cwd, token, session name, prompt, terminal output은 저장하지 않는다.

`corepack pnpm lifecycle:rollback-dry-run`은 현재 runtime v2 drop-in의 `CODEXMUX_RUNTIME_*`
환경값과 rollback 시 필요한 명령을 JSON으로 출력한다. 이 명령은 파일 삭제, daemon reload,
service restart를 실행하지 않으며 `"mutates": false`를 포함한다. 실행형 UI 범위는 여전히
`phase6-gate`, `restart-service`, `deploy-local`로 제한된다.

성능 변경 배포 후에는 인증된 session cookie 또는 `x-cmux-token`으로 `/api/debug/perf`를 확인한다. 이 endpoint는 public health check가 아니며 process memory, event loop, WebSocket, watcher, status poll, diff/stats cache 숫자만 반환한다.

Runtime v2 shadow mode를 켠 뒤에는 `/api/v2/runtime/health`와 `/api/debug/perf`의 `services.runtimeWorkers`를 같이 확인한다. surface mode가 모두 `off`이면 legacy `/api/terminal`, `/api/timeline`, `/api/status`, `/api/sync`와 JSON store가 production source of truth이며, worker `restarts`, `timeouts`, `healthFailures`, `readyFailures`, `commandFailures`가 증가하지 않는지 관찰한다.

서비스가 이미 8121 포트를 사용하므로 수동 실행을 병행하지 않는다. 임시로 수동 실행이 필요하면 먼저 서비스를 중지한다.

```bash
systemctl --user stop codexmux.service
HOST=localhost,tailscale,192.168.0.0/16 PORT=8121 codexmux
```

## 2026-05-05 운영 기준

2026-05-05 `d3248c4` 배포 기준 live service는 `0.4.1` build를 실행한다. 정확한 배포 commit은 `curl -sS http://127.0.0.1:8121/api/health`의 `commit` 값을 기준으로 판단한다.

```text
ActiveState=active
SubState=running
WorkingDirectory=/data/projects/codex-zone/codexmux
Health version=0.4.1
Health commit=d3248c4
```

릴리스 smoke 결과는 `docs/operations/2026-05-04-release-v0.4.1-handoff.md`, 최신 runtime v2 timeline watcher/Android foreground 배포 결과는 `docs/operations/2026-05-05-deploy-d3248c4-handoff.md`를 기준으로 본다.
