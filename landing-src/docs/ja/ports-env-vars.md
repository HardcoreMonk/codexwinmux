---
title: 포트 & 환경 변수
description: codexmux가 사용하는 port, network access, logging, CLI token 설정.
eyebrow: 레퍼런스
permalink: /ja/docs/ports-env-vars/index.html
---
{% from "docs/callouts.njk" import callout %}

codexmux는 기본적으로 `localhost:8121`에서 실행됩니다. 필요하면 환경 변수로 port, network access, logging을 조정할 수 있습니다.

## port와 host

```bash
PORT=9000 codexmux
HOST=localhost,tailscale codexmux
HOST=localhost,tailscale PORT=8121 codexmux
HOST=all PORT=9000 codexmux
```

| 변수 | 기본값 | 의미 |
|---|---|---|
| `PORT` | `8121` | 외부 server port |
| `HOST` | `localhost` | 허용할 접근 범위. env로 지정하면 앱의 네트워크 접근 설정이 잠김 |
| `NODE_ENV` | 실행 방식에 따라 다름 | development/production pipeline 선택 |
| `NO_UPDATE_NOTIFIER` | unset | `1`이면 version check 비활성화 |

`HOST`는 단순 bind 주소가 아니라 접근 필터입니다. 사용할 수 있는 키워드는 `localhost`, `tailscale`, `lan`, `all`이고, CIDR도 직접 지정할 수 있습니다. 예를 들어 `HOST=localhost,tailscale`은 로컬 브라우저와 Tailscale 대역만 허용합니다.

`8121`가 사용 중이면 빈 port를 찾아 바인딩하고 `~/.codexmux/port`에 기록합니다.

## shell 기본값 고정

매번 같은 port와 접근 범위로 실행한다면 shell 함수로 감쌀 수 있습니다. zsh의 `$HOST`는 기본적으로 호스트명을 담는 특수 파라미터라서, 사용자가 실제로 export한 환경 변수만 읽도록 `printenv`를 사용합니다.

```zsh
codexmux() {
  local host="$(printenv HOST 2>/dev/null)"
  local port="$(printenv PORT 2>/dev/null)"
  [[ -n "$host" ]] || host="localhost,tailscale"
  [[ -n "$port" ]] || port="8121"

  HOST="$host" PORT="$port" command codexmux "$@"
}
```

소스 체크아웃에서 직접 실행 중이고 아직 빌드하지 않았다면 함수 안의 마지막 줄을 `cd /path/to/codexmux && HOST="$host" PORT="$port" corepack pnpm dev` 형태로 바꾸세요.

## logging

```bash
LOG_LEVEL=debug codexmux
LOG_LEVELS=status=debug codexmux
LOG_LEVELS=status=debug,tmux=trace codexmux
```

| 변수 | 의미 |
|---|---|
| `LOG_LEVEL` | 기본 log level |
| `LOG_LEVELS` | module별 `name=level` override |

주요 module은 `status`, `tmux`, `hooks`, `server`, `lock`입니다. log file은 `~/.codexmux/logs/`에 저장됩니다.

## 파일 기반 값

| 파일 | 내용 | 사용처 |
|---|---|---|
| `~/.codexmux/port` | 현재 server port | CLI, bridge script |
| `~/.codexmux/cli-token` | 32-byte CLI token | `x-cmux-token` 인증 |

CLI는 `CMUX_PORT`, `CMUX_TOKEN` 환경 변수가 있으면 파일보다 우선합니다.

## 다음 단계

- **[설치](/codexmux/ja/docs/installation/)**
- **[데이터 디렉터리](/codexmux/ja/docs/data-directory/)**
- **[CLI 레퍼런스](/codexmux/ja/docs/cli-reference/)**
