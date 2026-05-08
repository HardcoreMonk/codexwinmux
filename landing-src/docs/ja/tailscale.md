---
title: Tailscale 접속
description: Tailscale Serve로 휴대폰에서도 HTTPS로 codexmux에 접근합니다 — 포트 포워딩도, 인증서 고민도 없이.
eyebrow: 모바일 & 원격
permalink: /ja/docs/tailscale/index.html
---
{% from "docs/callouts.njk" import callout %}

기본적으로 codexmux는 로컬에서만 listen 합니다. 다른 기기에서 안전하게 접근하기에 가장 깔끔한 방법은 Tailscale Serve입니다 — WireGuard 암호화, Let's Encrypt 인증서 자동 발급, 방화벽 변경 불필요.

## 왜 Tailscale인가

- **WireGuard** — 모든 연결이 기기 대 기기로 암호화됩니다.
- **자동 HTTPS** — Tailscale이 `*.<tailnet>.ts.net`에 대한 실제 인증서를 발급해줍니다.
- **포트 포워딩 불필요** — 머신이 공개 인터넷에 포트를 열지 않습니다.
- **iOS는 HTTPS 필수** — PWA 설치와 Web Push 모두 HTTPS 없이는 거부됩니다. [PWA 설정](/codexmux/ja/docs/pwa-setup/), [웹 푸시](/codexmux/ja/docs/web-push/) 참고.

## 사전 준비

- Tailscale 계정과, codexmux 실행 머신에 설치/로그인된 `tailscale` 데몬
- 테일넷 HTTPS 활성화 (Admin console → DNS → HTTPS Certificates, 이미 켜져 있으면 패스)
- codexmux가 기본 포트 `8121` (또는 `PORT`로 지정한 포트)에서 실행 중

## 실행

한 줄이면 됩니다.

```bash
tailscale serve --bg --https=443 localhost:8121
```

Tailscale이 로컬 `http://localhost:8121`를 HTTPS로 감싸 테일넷 내부에 노출합니다.

```
https://<machine>.<tailnet>.ts.net
```

`<machine>`은 머신의 호스트명, `<tailnet>`은 테일넷의 MagicDNS 접미사입니다. 같은 테일넷에 로그인한 다른 기기에서 이 URL을 열면 바로 접속됩니다.

서빙 중지:

```bash
tailscale serve reset
```

## 동작 후 할 일

- 휴대폰에서 URL을 열고 **공유 → 홈 화면에 추가** — [PWA 설정](/codexmux/ja/docs/pwa-setup/) 참고
- Standalone PWA 창 안에서 푸시 활성화 — [웹 푸시](/codexmux/ja/docs/web-push/)
- 태블릿, 노트북, 다른 데스크탑에서도 같은 대시보드에 접속 — 워크스페이스 상태가 실시간으로 동기화됩니다

{% call callout('tip', 'Funnel vs Serve') %}
`tailscale serve`는 codexmux를 테일넷 내부에만 노출합니다 — 거의 모든 경우 이쪽이 정답입니다. `tailscale funnel`은 공개 인터넷에 노출하는 옵션이며, 개인용 멀티플렉서로는 과하고 위험합니다.
{% endcall %}

## 리버스 프록시 대안

Tailscale을 쓰기 어렵다면, 실제 TLS 인증서를 가진 리버스 프록시 중 어느 것이든 사용 가능합니다. 반드시 챙겨야 할 한 가지는 **WebSocket 업그레이드** — codexmux의 터미널 I/O, 상태 동기화, 라이브 타임라인이 모두 WebSocket을 사용합니다.

Nginx 예시:

```
location / {
  proxy_pass http://127.0.0.1:8121;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 86400;
}
```

Caddy는 더 간단합니다 — `reverse_proxy 127.0.0.1:8121`만 써도 업그레이드 헤더를 알아서 처리합니다.

`Upgrade` / `Connection` 포워딩이 빠지면 대시보드는 렌더링되지만 터미널이 연결되지 않고 상태도 그대로 멈춥니다. 반쪽짜리로 동작한다면 이 헤더부터 의심하세요.

## 문제 해결

- **HTTPS 인증서 미발급** — 첫 발급은 1분 정도 걸릴 수 있습니다. 잠시 기다린 후 `tailscale serve --bg --https=443 localhost:8121`를 다시 실행하면 보통 해결됩니다.
- **브라우저가 인증서 경고** — `<machine>.<tailnet>.ts.net` URL을 정확히 사용하고 있는지, LAN IP를 쓰고 있지 않은지 확인하세요.
- **모바일에서 접근 불가** — 휴대폰이 같은 테일넷에 로그인되어 있고 OS 설정에서 Tailscale이 활성 상태인지 확인하세요.
- **자체 서명 인증서** — Web Push 등록이 거부됩니다. Tailscale Serve 또는 ACME가 발급한 실제 인증서를 사용하세요.

## 다음으로

- **[PWA 설정](/codexmux/ja/docs/pwa-setup/)** — HTTPS 확보 후 홈 화면에 설치
- **[웹 푸시 알림](/codexmux/ja/docs/web-push/)** — 백그라운드 알림 켜기
- **[보안과 인증](/codexmux/ja/docs/security-auth/)** — 비밀번호, 해싱, 그리고 테일넷 노출이 의미하는 것
