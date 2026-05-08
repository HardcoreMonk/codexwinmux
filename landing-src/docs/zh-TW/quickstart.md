---
title: 빠른 시작
description: Node.js와 tmux만 있으면 1분 안에 codexmux를 실행할 수 있습니다.
eyebrow: 시작하기
permalink: /zh-TW/docs/quickstart/index.html
---
{% from "docs/callouts.njk" import callout %}

codexmux는 웹 기반 터미널 멀티플렉서입니다. 모든 Codex 세션을 하나의 대시보드에서 관리하고, `tmux`로 세션을 유지하며, 책상에서도 휴대폰에서도 바로 이어서 작업할 수 있습니다.

## 시작하기 전에

실행할 머신에 두 가지가 필요합니다.

- **Node.js 20 이상** — `node -v`로 확인
- **tmux** — `tmux -V`로 확인. 3.0 이상이면 OK

{% call callout('note', 'macOS / Linux 전용') %}
서버 실행은 macOS와 Linux를 기준으로 지원합니다.
{% endcall %}

## 실행

명령어 하나. 글로벌 설치도 필요 없습니다.

```bash
npx codexmux
```

`8121` 포트에서 서버가 뜹니다. 브라우저로 열어보세요.

```
http://localhost:8121
```

처음 실행 시 비밀번호 설정과 첫 워크스페이스 생성 절차가 안내됩니다.

{% call callout('tip') %}
영구 설치를 원하시면 `pnpm add -g codexmux && codexmux`로 쓸 수도 있습니다. 업데이트는 `pnpm up -g codexmux` 한 번이면 됩니다.
{% endcall %}

## Codex 세션 열기

대시보드에서:

1. 원하는 워크스페이스에서 **새 탭**을 누릅니다.
2. **Codex** 템플릿을 선택하거나, 일반 터미널에서 `codex`를 직접 실행해도 됩니다.
3. codexmux가 실행 중인 Codex CLI를 자동으로 인식해 상태·타임라인·권한/입력 프롬프트를 실시간으로 보여줍니다.

브라우저를 닫아도 세션은 유지됩니다 — tmux가 프로세스를 계속 살려두기 때문입니다.

## 휴대폰에서 접근

기본값으로 codexmux는 `localhost`에만 바인드합니다. 외부에서 안전하게 접근하려면 Tailscale Serve를 쓰세요 (WireGuard + 자동 HTTPS, 포트 포워딩 불필요):

```bash
tailscale serve --bg --https=443 localhost:8121
```

휴대폰에서 `https://<machine>.<tailnet>.ts.net`를 열고 **공유 → 홈 화면에 추가**하면 PWA로 설치되고, 백그라운드에서도 Web Push 알림을 받을 수 있습니다.

자세한 설정은 [Tailscale 접속](/codexmux/zh-TW/docs/tailscale/), iOS/Android 구체 방법은 [PWA 설정](/codexmux/zh-TW/docs/pwa-setup/)을 참고하세요.

## 다음으로

- **[설치](/codexmux/zh-TW/docs/installation/)** — 플랫폼별 세부 사항, macOS 네이티브 앱, 자동 시작
- **[브라우저 지원](/codexmux/zh-TW/docs/browser-support/)** — 데스크탑/모바일 호환성 매트릭스
- **[첫 세션](/codexmux/zh-TW/docs/first-session/)** — 대시보드 투어
- **[키보드 단축키](/codexmux/zh-TW/docs/keyboard-shortcuts/)** — 전체 바인딩 한눈에
