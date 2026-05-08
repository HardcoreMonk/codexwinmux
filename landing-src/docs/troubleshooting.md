---
title: 문제 해결 & FAQ
description: 자주 마주치는 이슈, 빠른 답, 그리고 가장 많이 들어오는 질문들.
eyebrow: 레퍼런스
permalink: /docs/troubleshooting/index.html
---
{% from "docs/callouts.njk" import callout %}

여기 적힌 내용과 다른 증상이라면, 플랫폼·브라우저와 `~/.codexmux/logs/`의 로그 파일을 첨부해 [이슈를 열어주세요](https://github.com/HardcoreMonk/codexmux/issues).

## 설치와 시작

### `tmux: command not found`

호스트에 tmux 3.0 이상이 필요합니다. 설치:

```bash
# macOS (Homebrew)
brew install tmux

# Ubuntu / Debian
sudo apt install tmux

# Fedora
sudo dnf install tmux
```

`tmux -V`로 확인. 기술적으로는 2.9+가 preflight를 통과하지만, 테스트 기준은 3.0+입니다.

### `node: command not found` 또는 Node.js 20 이상 오류

Node.js 20 LTS 이상을 설치하세요. `node -v`로 확인. macOS 네이티브 앱은 자체 Node를 번들하므로 이 항목은 `npx` / `npm install -g` 경로에만 해당됩니다.

### `Cannot find module '../dist/server.js'` 또는 `.next/standalone/server.js`

소스 체크아웃에서 빌드 산출물 없이 production entrypoint를 실행한 경우입니다. 바로 실행하려면 개발 서버를 사용하세요:

```bash
corepack pnpm dev
```

production 모드로 실행하려면 먼저 빌드합니다:

```bash
corepack pnpm build
corepack pnpm start
```

`bin/codexmux.js`는 배포 패키지나 빌드 완료 상태를 전제로 합니다.

### "codexmux is already running (pid=…, port=…)"

다른 codexmux 인스턴스가 살아 있고 `/api/health`에 응답합니다. 그것을 그대로 쓰거나(출력된 URL 열기), 먼저 종료하세요:

```bash
# 찾기
ps aux | grep codexmux

# 또는 lock 파일로 바로 종료
kill $(jq -r .pid ~/.codexmux/cmux.lock)
```

### Stale 락 — 시작이 거부되는데 프로세스는 없음

`~/.codexmux/cmux.lock`이 남았습니다. 제거:

```bash
rm ~/.codexmux/cmux.lock
```

과거에 `sudo`로 실행한 적이 있다면 root 소유일 수 있으니 `sudo rm`로 한 번 정리하세요.

### `Port 8121 is in use, finding an available port...`

다른 프로세스가 `8121`를 사용 중입니다. 서버는 임의의 빈 포트로 폴백하고 새 URL을 출력합니다. 직접 포트를 지정하려면:

```bash
PORT=9000 codexmux
```

`8121`을 잡고 있는 프로세스는 `lsof -iTCP:8121 -sTCP:LISTEN -n -P`로 찾을 수 있습니다.

### Windows에서 동작하나요?

서버 실행은 macOS와 Linux를 기준으로 지원합니다. 현재 codexmux는 Windows 네이티브 서버나 별도 기기 연동 경로를 제공하지 않습니다.

## 세션과 복원

### 브라우저를 닫았더니 다 사라졌어요

그럴 리가 없습니다 — tmux가 모든 셸을 서버에서 유지합니다. 새로고침해도 탭이 돌아오지 않으면:

1. 서버가 살아 있는지 확인 (`http://localhost:8121/api/health`).
2. tmux 세션 존재 확인: `tmux -L codexmux ls`.
3. `autoResumeOnStartup` 중 에러가 없었는지 `~/.codexmux/logs/codexmux.YYYY-MM-DD.N.log` 확인.

tmux가 "no server running"이라면 호스트가 재부팅됐거나 tmux가 죽은 것입니다. 세션은 사라지지만 레이아웃(워크스페이스, 탭, 작업 디렉토리)은 `~/.codexmux/workspaces/{wsId}/layout.json`에 보존되어 있어 다음 codexmux 시작 시 다시 launch됩니다.

### Codex 세션이 resume되지 않아요

`autoResumeOnStartup`이 각 탭의 저장된 `codex resume <uuid>`를 다시 실행하지만, 대응되는 `~/.codex/sessions/.../sessionId.jsonl`이 더 이상 없으면(삭제, 아카이브, 프로젝트 이동) resume이 실패합니다. 탭을 열어 새 대화를 시작하세요.

### 모든 탭이 "unknown" 상태입니다

`unknown`은 서버 재시작 전에 `busy`였던 탭이 아직 복구 중임을 의미합니다. `resolveUnknown`이 백그라운드에서 돌면서 `idle` (Codex 종료) 또는 `ready-for-review` (마지막 어시스턴트 메시지 있음)를 확정합니다. 10분 이상 `unknown`에 머무르면 **busy stuck safety net**이 조용히 `idle`로 넘깁니다. 전체 상태 머신은 [STATUS.md](https://github.com/HardcoreMonk/codexmux/blob/main/docs/STATUS.md) 참고.

## 브라우저와 UI

### Web Push 알림이 오지 않아요

체크리스트:

1. **iOS Safari ≥ 16.4 만 가능.** 이전 iOS는 Web Push 자체가 없습니다.
2. **iOS는 PWA 필수.** **공유 → 홈 화면에 추가** 후에만 푸시가 옵니다 — 일반 Safari 탭에서는 안 옵니다.
3. **HTTPS 필수.** 자체 서명 인증서로는 안 됩니다 — Web Push 등록 자체가 조용히 거부됩니다. Tailscale Serve(자동 Let's Encrypt)나 실제 도메인 + Nginx / Caddy를 쓰세요.
4. **알림 권한 허용.** codexmux 안의 **설정 → 알림 → On** *과* 브라우저 레벨 권한 둘 다 허용되어야 합니다.
5. **구독이 존재해야 함.** `~/.codexmux/push-subscriptions.json`에 해당 디바이스 항목이 있어야 합니다. 비어 있으면 권한을 다시 부여하세요.

전체 호환성 매트릭스는 [브라우저 지원](/codexmux/docs/browser-support/) 참고.

### iOS Safari 16.4+인데도 알림이 안 와요

일부 iOS 버전은 PWA가 오래 닫혀 있으면 구독을 잃습니다. PWA를 열어 알림 권한을 거부했다가 다시 허용하고 `push-subscriptions.json`을 다시 확인하세요.

### Safari 프라이빗 창에서 아무 것도 저장되지 않아요

Safari 17+ 프라이빗 창은 IndexedDB가 비활성화되어 워크스페이스 캐시가 재시작 후 살아남지 않습니다. 일반 창을 사용하세요.

### 모바일 터미널이 백그라운드 후 사라져요

모바일 브라우저와 Android WebView는 백그라운드에서 WebSocket이 끊기거나, 객체가 `OPEN`으로 남아도 실제 TCP 연결이 죽을 수 있습니다. tmux는 실제 세션을 계속 유지하므로 foreground 복귀 시 codexmux가 terminal/status/timeline/sync 연결을 강제로 재확인하고 다시 렌더링합니다. Android foreground forced reconnect 중 예상 가능한 stale WebSocket 오류는 짧은 grace window에서 console noise로 남기지 않습니다.

Capacitor Android 앱에서는 모바일 메뉴의 앱 정보에서 Android 앱 버전과 서버 버전을 확인할 수 있고, 앱 재시작으로 WebView/Activity를 다시 열 수 있습니다. 재시작 후에도 같은 워크스페이스가 멈춰 보이면 서버 로그와 해당 세션의 timeline/sync WebSocket 상태를 같이 확인하세요.

### "다시 연결"이 보이는데 눌리지 않아요

서버 재시작 뒤 terminal session 자체가 사라진 `session-not-found` 상태에서는 단순 WebSocket 재연결이 아니라 tab session 재시작이 필요합니다. 최신 빌드는 중앙 복구 overlay가 활성화된 동안 우상단 floating "다시 연결" 버튼을 숨기고, 복구 overlay의 재시작 버튼만 표시합니다.

배포 직후 이미 열린 브라우저 탭이나 Android WebView가 이전 JavaScript chunk를 들고 있으면 예전 UI가 남을 수 있습니다. 페이지를 새로고침하거나 앱을 재시작한 뒤에도 같은 증상이 보이면 `/api/health`의 `commit` 값과 브라우저 console, `~/.codexmux/logs/`를 같이 확인하세요.

### Firefox + Tailscale serve 인증서 경고

`*.ts.net`이 아닌 커스텀 도메인을 tailnet에 쓰면 Firefox가 Chrome보다 HTTPS 신뢰에 까다롭습니다. 한 번 수락하면 계속 유지됩니다.

### 브라우저가 너무 오래되었거나 일부 기능이 안 보여요

**설정 → 브라우저 체크**를 실행해 API별 리포트를 보세요. [브라우저 지원](/codexmux/docs/browser-support/)의 최소 버전 미만은 기능을 그레이스풀하게 잃지만 공식 지원은 아닙니다.

### 서버가 느리거나 메모리 사용량이 높아요

`corepack pnpm deploy:local` 후 인증된 요청으로 `/api/debug/perf`를 확인하세요. 이 endpoint는 process memory, event loop delay, terminal/status/timeline/sync WebSocket 수, JSONL watcher, status poll duration, diff/stats cache counter를 숫자로만 반환합니다. prompt, assistant text, terminal output, cwd, JSONL path는 반환하지 않습니다. 운영 판단 기준은 [PERFORMANCE.md](https://github.com/HardcoreMonk/codexmux/blob/main/docs/PERFORMANCE.md)를 참고하세요.

## 네트워크와 외부 접근

### 인터넷에 노출해도 되나요?

가능하지만 항상 HTTPS로. 권장:

1. **Tailscale Serve** — `tailscale serve --bg --https=443 localhost:8121`로 WireGuard 암호화 + 자동 인증서. 포트 포워딩 불필요.
2. **리버스 프록시** — Nginx / Caddy / Traefik. `Upgrade`와 `Connection` 헤더를 반드시 포워딩하세요. 안 그러면 WebSocket이 깨집니다.

오픈 인터넷 위 평문 HTTP는 권하지 않습니다 — 인증 쿠키는 HMAC 서명이지만 WebSocket 페이로드(터미널 바이트!)는 암호화되지 않습니다.

### 모바일에서 Tailscale로 접속하고 싶어요

서버 PC와 모바일이 같은 tailnet에 로그인되어 있어야 합니다. 서버 PC가 아직 로그인되지 않았다면:

```bash
sudo tailscale up
tailscale status
tailscale ip -4
```

codexmux는 Tailscale 대역을 허용해서 실행합니다. 아래 예시는 포트를 `8121`로 고정한 경우입니다:

```bash
HOST=localhost,tailscale PORT=8121 codexmux
```

모바일 Tailscale 앱에서 VPN을 켠 뒤 브라우저에서 `http://<tailscale-ip>:8121`로 접속합니다. HTTPS와 짧은 `*.ts.net` 주소가 필요하면 codexmux를 켜둔 상태에서 서버 PC에 Serve를 설정하세요:

```bash
tailscale serve --bg --https=443 localhost:8121
tailscale serve status
```

codexmux는 터미널 입출력을 다루므로 공개 인터넷용 `tailscale funnel`보다 tailnet 내부 공유인 Serve를 권장합니다.

### LAN의 다른 디바이스에서 접근이 안 돼요

기본은 localhost 전용입니다. env 또는 앱 설정으로 접근 범위를 엽니다:

```bash
HOST=lan,localhost codexmux       # LAN
HOST=tailscale,localhost codexmux # tailnet
HOST=all codexmux                 # 모두
```

또는 앱의 **설정 → 네트워크 접근** (이 값은 `~/.codexmux/config.json`에 기록). env로 `HOST`를 지정한 경우 이 필드는 잠깁니다. 키워드와 CIDR 문법은 [포트 & 환경변수](/codexmux/docs/ports-env-vars/) 참고.

### 리버스 프록시 WebSocket 이슈

`/api/terminal`이 연결됐다가 즉시 끊긴다면 프록시가 `Upgrade` / `Connection` 헤더를 떨어뜨리고 있습니다. 최소 Nginx 설정:

```nginx
location / {
  proxy_pass http://127.0.0.1:8121;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

Caddy는 WebSocket 포워딩이 기본이므로 `reverse_proxy 127.0.0.1:8121`만 적으면 됩니다.

## 데이터와 저장소

### 데이터는 어디에 저장되나요?

전부 로컬 `~/.codexmux/` 안. 외부로 나가는 데이터는 없습니다. 로그인 비밀번호는 `config.json` 안의 scrypt 해시. 전체 구조는 [데이터 디렉토리](/codexmux/docs/data-directory/) 참고.

### 비밀번호를 잊었어요

비밀번호는 평문이 아니라 `config.json` 안의 scrypt 해시로만 저장됩니다. 기존 비밀번호를 복구할 수는 없고, 비밀번호 필드만 지운 뒤 재시작해서 새로 설정합니다:

```bash
cp ~/.codexmux/config.json ~/.codexmux/config.json.bak
node -e 'const fs=require("fs"); const p=process.env.HOME+"/.codexmux/config.json"; const c=JSON.parse(fs.readFileSync(p,"utf8")); delete c.authPassword; delete c.authSecret; c.updatedAt=new Date().toISOString(); fs.writeFileSync(p, JSON.stringify(c,null,2)+"\n", {mode:0o600});'
```

그 다음 codexmux를 재시작하고 로그인 화면에서 새 비밀번호를 설정하세요. `config.json` 전체를 삭제하면 테마, 네트워크 접근, Codex 옵션 같은 앱 설정도 함께 초기화됩니다.

### 탭 인디케이터가 영원히 "busy"에서 멈춰요

`busy stuck safety net`이 Codex 프로세스가 죽었다면 10분 후 조용히 `idle`로 전환합니다. 기다리기 싫다면 탭을 닫았다 다시 열어 로컬 상태를 리셋하세요 — 다음 상태 업데이트가 깨끗한 상태에서 재개됩니다. 근본 원인 추적은 `LOG_LEVELS=status=debug,tmux=trace`로 실행하세요.

### 기존 tmux 설정과 충돌하나요?

아니요. codexmux는 전용 소켓(`-L codexmux`)에서 자체 설정(`src/config/tmux.conf`)으로 격리된 tmux를 실행합니다. `~/.tmux.conf`나 기존 tmux 세션은 건드리지 않습니다.

## 비용과 사용량

### codexmux를 쓰면 비용이 절약되나요?

직접 절약시키지는 않습니다. 다만 **사용량을 투명하게** 만듭니다: 오늘/이달/프로젝트별 비용, 모델별 토큰 분해, 5시간/7일 rate-limit 카운트다운이 한 화면에 모여 있어 한도에 부딪치기 전에 페이스를 조절할 수 있습니다.

### codexmux 자체에 비용이 드나요?

아니요. codexmux는 MIT 라이선스 오픈소스입니다. Codex 사용료는 OpenAI이 별도로 청구합니다.

### 데이터가 외부로 전송되나요?

아니요. codexmux는 완전히 셀프호스팅입니다. 외부로 나가는 네트워크 호출은 (1) 로컬 Codex CLI가 알아서 OpenAI과 통신하는 것, (2) 시작 시 `update-notifier`의 버전 확인뿐입니다. 버전 확인을 끄려면 `NO_UPDATE_NOTIFIER=1`.

## 다음으로

- **[브라우저 지원](/codexmux/docs/browser-support/)** — 자세한 호환성 매트릭스와 알려진 quirk
- **[데이터 디렉토리](/codexmux/docs/data-directory/)** — 각 파일의 역할과 삭제 안전성
- **[아키텍처](/codexmux/docs/architecture/)** — 더 깊이 파야 할 때 컴포넌트가 어떻게 맞물리는지
