# Codex Sub-Agent Timeline UI Design

## 목표

Codex JSONL에서 생성된 fork/sub-agent 실행을 일반 tool call 목록이 아니라 timeline의
관계형 sub-agent 카드로 표시한다. 사용자는 상위 Codex turn 안에서 어떤 sub-agent가
생성됐고 어떤 결과를 돌려줬는지 한눈에 확인할 수 있어야 한다.

## 범위

- Codex `response_item.payload.type="function_call"` 중 `spawn_agent`와 `Agent`를 sub-agent
  생성 신호로 취급한다.
- matching `function_call_output.call_id`가 같은 parse window 안에 있으면 하나의
  `agent-group` entry로 접는다.
- `agent-group`에는 agent type, 생성 설명 또는 prompt, output summary를 보존한다.
- 기존 `AgentGroupItem`을 재사용하되 header에 `Sub-agent`, agent type, 설명을 같이 표시한다.

## 비범위

- Codex app-server protocol adapter 추가.
- tmux/process 감지 변경.
- sub-agent live 실행 중 상태를 별도 worker state로 추적하는 기능.
- provider contract 전체 재설계.

## 데이터 흐름

1. `codex-session-parser`가 JSONL line을 순서대로 읽는다.
2. `spawn_agent` 또는 `Agent` function call이면 call id 기준 pending sub-agent metadata를
   저장하고 일반 tool-call entry는 만들지 않는다.
3. matching function output을 만나면 pending metadata와 output을 합쳐 `agent-group` entry를
   생성한다.
4. timeline renderer는 기존 `agent-group` 분기를 사용해 접힌 관계 카드를 표시한다.

## 오류와 안정성

- matching output이 없는 call은 현재 parse 결과에서 group으로 만들지 않는다.
- output이 비어 있으면 비어 있는 group으로 표시할 수 있지만 원문 command, cwd, JSONL path는
  추가로 노출하지 않는다.
- entry id는 기존 `createTimelineEntryId`를 사용해 같은 JSONL content에서 안정적으로 생성한다.

## 검증

- `tests/unit/lib/codex-session-parser.test.ts`에서 `spawn_agent` call/output pair가 하나의
  `agent-group`으로 접히는지 확인한다.
- `tests/unit/components/agent-group-item.test.ts`에서 header에 `Sub-agent`, agent type, 설명이
  렌더링되는지 확인한다.
