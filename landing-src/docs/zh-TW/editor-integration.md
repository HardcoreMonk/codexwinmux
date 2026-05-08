---
title: 에디터 연동
description: 헤더의 EDITOR 버튼으로 현재 폴더를 VS Code · Cursor · Zed · code-server · 커스텀 URL로 엽니다.
eyebrow: 커스터마이즈
permalink: /zh-TW/docs/editor-integration/index.html
---
{% from "docs/callouts.njk" import callout %}

워크스페이스 헤더에 **EDITOR** 버튼이 있습니다. 누르면 현재 세션의 폴더가 선택한 에디터로 열립니다. 프리셋을 고르고 URL을 입력하거나 OS 핸들러에 맡기면 끝입니다.

## 설정 화면 열기

설정(<kbd>⌘,</kbd>) → **Editor** 탭. 프리셋 목록과, 선택에 따라 URL 입력란이 나타납니다.

## 제공 프리셋

| 프리셋 | 동작 |
|---|---|
| **Code Server (Web)** | 호스팅 중인 [code-server](https://github.com/coder/code-server)에 `?folder=<path>`를 붙여 엽니다. URL 필요. |
| **VS Code** | `vscode://file/<path>?windowId=_blank` 호출 |
| **VS Code Insiders** | `vscode-insiders://...` |
| **Cursor** | `cursor://...` |
| **Windsurf** | `windsurf://...` |
| **Zed** | `zed://file<path>` |
| **사용자 URL** | 직접 정의하는 URL 템플릿. `{folder}` / `{folderEncoded}` 플레이스홀더를 사용 |
| **Disabled** | EDITOR 버튼을 숨깁니다 |

데스크탑 IDE 4종(VS Code, Cursor, Windsurf, Zed)은 OS에 등록된 URI 핸들러를 통해 동작합니다. 로컬에 IDE가 설치되어 있으면 그대로 열립니다.

## 웹 방식과 로컬 방식

폴더를 여는 방식에 의미 있는 차이가 있습니다.

- **code-server**는 브라우저 안에서 동작합니다. URL은 호스팅 중인 서버(로컬·사내망·Tailscale 뒤)를 가리킵니다. 버튼을 누르면 새 탭이 열리며 폴더가 로드됩니다.
- **로컬 IDE**(VS Code, Cursor, Windsurf, Zed)는 *브라우저가 실행 중인 머신*에 IDE가 설치되어 있어야 합니다. OS가 등록된 URI 핸들러를 호출하는 방식입니다.

휴대폰에서 codexmux를 쓴다면 code-server 프리셋만 의미가 있습니다. 휴대폰에서 `vscode://`로 데스크탑 앱을 열 수는 없습니다.

## code-server 설정

설정 화면에 그대로 노출되는 표준 셋업입니다.

```bash
# macOS 설치
brew install code-server

# 실행
code-server --port 8080

# 외부 접속 (선택) — Tailscale
tailscale serve --bg --https=8443 http://localhost:8080
```

그다음 Editor 탭에 code-server 주소를 입력합니다. 로컬이면 `http://localhost:8080`, Tailscale Serve를 통한다면 `https://<machine>.<tailnet>.ts.net:8443`처럼 입력합니다. codexmux가 `http://` 또는 `https://` 여부를 검증한 뒤, 절대 경로를 `?folder=<path>` 형태로 자동 부착합니다.

{% call callout('note', '8121 포트는 피하세요') %}
codexmux가 이미 `8121`를 씁니다. code-server는 다른 포트(예시는 `8080`)에서 띄우세요.
{% endcall %}

## 커스텀 URL 템플릿

사용자 프리셋은 폴더를 URL에 받는 어떤 도구든 연결할 수 있습니다 — Coder 워크스페이스, Gitpod, Theia, 사내 도구 등. 템플릿에는 다음 플레이스홀더가 **반드시** 하나 이상 있어야 합니다.

- `{folder}` — 절대 경로(인코딩 없음)
- `{folderEncoded}` — URL 인코딩된 경로

```
myeditor://open?path={folderEncoded}
https://my.coder.example/workspace?dir={folderEncoded}
```

저장 시점에 검증하며, 플레이스홀더가 없으면 저장이 거부됩니다.

## 버튼 숨기기

**Disabled**를 선택하면 워크스페이스 헤더에서 EDITOR 버튼이 사라집니다.

## 다음으로

- **[사이드바 & Codex 옵션](/codexmux/zh-TW/docs/sidebar-options/)** — 사이드바 정렬, Codex 플래그 토글
- **[커스텀 CSS](/codexmux/zh-TW/docs/custom-css/)** — 시각 요소 추가 조정
- **[Tailscale](/codexmux/zh-TW/docs/tailscale/)** — code-server 외부 접속도 동일하게 활용
