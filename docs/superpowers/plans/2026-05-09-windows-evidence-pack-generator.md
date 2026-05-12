# Windows Evidence Pack Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `corepack pnpm smoke:windows:evidence-pack` so Windows smoke evidence can be summarized into `summary.json` and four internal release documents.

**Architecture:** Add a focused evidence-pack library that normalizes existing smoke JSON/artifact payloads, computes release readiness, renders Markdown documents, and writes outputs. Add a small CLI wrapper for `--from` and `--run` modes without changing existing Windows smoke scripts or their pass/fail criteria.

**Tech Stack:** Node.js ESM scripts, `fs/promises`, `child_process.spawn`, Vitest, existing `corepack pnpm` scripts, Markdown docs.

---

## File Structure

- Create `scripts/windows-evidence-pack-lib.mjs`
  - Pure helpers for sanitization, evidence normalization, summary calculation, document rendering, and file writes.
- Create `scripts/smoke-windows-evidence-pack.mjs`
  - CLI entrypoint for `--from`, `--run`, `--out`, and `--force`.
- Modify `package.json`
  - Add `smoke:windows:evidence-pack`.
- Create `tests/unit/scripts/windows-evidence-pack-lib.test.ts`
  - Unit tests for normalization, blockers, redaction, document generation, and overwrite guard.
- Create `tests/fixtures/windows-evidence/*.json`
  - Minimal fixture set for passed package/update evidence and blocked signing evidence.
- Modify `docs/TESTING.md`
  - Document the new command and output locations.
- Optionally modify `docs/FOLLOW-UP.md`
  - Only after implementation is verified, add one source-doc line explaining the generator exists. Runtime-generated evidence links are written by the CLI, not by this manual edit.

Do not edit existing Windows smoke scripts in the first implementation slice unless a test proves wrapper evidence is impossible. Keep existing stdout JSON behavior unchanged.

---

### Task 1: Fixture And Failing Library Tests

**Files:**
- Create: `tests/fixtures/windows-evidence/update-metadata.json`
- Create: `tests/fixtures/windows-evidence/signing-evidence.json`
- Create: `tests/fixtures/windows-evidence/updater-local-feed.json`
- Create: `tests/fixtures/windows-evidence/package-gate.json`
- Create: `tests/unit/scripts/windows-evidence-pack-lib.test.ts`

- [ ] **Step 1: Create fixture evidence files**

Create `tests/fixtures/windows-evidence/update-metadata.json`:

```json
{
  "schemaVersion": 1,
  "smokeName": "windows-update-metadata",
  "status": "passed",
  "startedAt": "2026-05-09T01:00:00.000Z",
  "endedAt": "2026-05-09T01:00:01.000Z",
  "durationMs": 1000,
  "payload": {
    "ok": true,
    "version": "0.4.13",
    "checks": ["latest-yml", "installer-blockmap", "zip-blockmap"],
    "artifacts": {
      "installer": "codexmux-Setup-0.4.13.exe",
      "latest": "latest.yml",
      "blockmap": "codexmux-Setup-0.4.13.exe.blockmap"
    }
  }
}
```

Create `tests/fixtures/windows-evidence/signing-evidence.json`:

```json
{
  "schemaVersion": 1,
  "smokeName": "windows-signing-evidence",
  "status": "failed",
  "startedAt": "2026-05-09T01:01:00.000Z",
  "endedAt": "2026-05-09T01:01:01.000Z",
  "durationMs": 1000,
  "payload": {
    "ok": false,
    "code": "windows-signing-evidence-failed",
    "version": "0.4.13",
    "checks": [
      { "name": "installer-authenticode", "status": "blocked", "message": "NotSigned" },
      { "name": "exe-authenticode", "status": "blocked", "message": "NotSigned" }
    ],
    "blockers": ["installer and executable are unsigned"],
    "paths": [
      "C:\\Users\\yohan\\AppData\\Local\\Temp\\codexmux-secret\\codexmux-Setup-0.4.13.exe"
    ],
    "stdout": "raw output must not appear"
  }
}
```

Create `tests/fixtures/windows-evidence/updater-local-feed.json`:

```json
{
  "schemaVersion": 1,
  "smokeName": "windows-updater-local-feed",
  "status": "passed",
  "startedAt": "2026-05-09T01:02:00.000Z",
  "endedAt": "2026-05-09T01:04:00.000Z",
  "durationMs": 120000,
  "payload": {
    "ok": true,
    "version": "0.4.13",
    "targetVersion": "0.4.14",
    "checks": ["download", "update-downloaded", "quitAndInstall", "post-update-launch"]
  }
}
```

Create `tests/fixtures/windows-evidence/package-gate.json`:

```json
{
  "schemaVersion": 1,
  "smokeName": "windows-package-gate",
  "status": "passed",
  "startedAt": "2026-05-09T01:05:00.000Z",
  "endedAt": "2026-05-09T01:06:00.000Z",
  "durationMs": 60000,
  "payload": {
    "ok": true,
    "version": "0.4.13",
    "checks": ["zip-artifact", "update-metadata", "packaged-launch", "installer-runtime-v2"]
  }
}
```

- [ ] **Step 2: Write failing tests for library behavior**

Create `tests/unit/scripts/windows-evidence-pack-lib.test.ts`:

```typescript
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/windows-evidence-pack-lib.mjs')).href);

let tempDir: string;

const fixtureDir = path.join(process.cwd(), 'tests/fixtures/windows-evidence');

describe('windows evidence pack library', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmux-windows-evidence-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('loads fixture evidence and classifies unsigned signing as external blocker only', async () => {
    const { loadWindowsEvidenceFiles, buildWindowsEvidenceSummary } = await loadLib();

    const evidence = await loadWindowsEvidenceFiles(fixtureDir);
    const summary = buildWindowsEvidenceSummary({
      evidence,
      generatedAt: '2026-05-09T01:10:00.000Z',
    });

    expect(summary).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-05-09T01:10:00.000Z',
      version: '0.4.13',
      overallStatus: 'blocked',
      internalReleaseReady: true,
      externalReleaseReady: false,
      passed: expect.arrayContaining([
        'windows-update-metadata',
        'windows-updater-local-feed',
        'windows-package-gate',
      ]),
      blocked: ['windows-signing-evidence'],
      manualRequired: expect.arrayContaining(['smart-screen-reputation']),
      blockers: expect.arrayContaining(['installer and executable are unsigned']),
      caveats: expect.arrayContaining([
        'internal pilot may proceed only through trusted internal distribution',
      ]),
    });
  });

  it('renders handoff, release note, install guide, and pilot checklist without leaking raw output', async () => {
    const {
      loadWindowsEvidenceFiles,
      buildWindowsEvidenceSummary,
      renderWindowsEvidenceDocuments,
    } = await loadLib();

    const evidence = await loadWindowsEvidenceFiles(fixtureDir);
    const summary = buildWindowsEvidenceSummary({
      evidence,
      generatedAt: '2026-05-09T01:10:00.000Z',
    });
    const docs = renderWindowsEvidenceDocuments({
      evidence,
      summary,
      date: '2026-05-09',
      evidenceDir: fixtureDir,
    });
    const combined = Object.values(docs).join('\n');

    expect(Object.keys(docs).sort()).toEqual([
      'handoff',
      'installUpdateGuide',
      'internalPilotChecklist',
      'internalReleaseNote',
    ]);
    expect(docs.handoff).toContain('# 2026-05-09 Windows Release Evidence');
    expect(docs.internalReleaseNote).toContain('내부 파일럿');
    expect(docs.installUpdateGuide).toContain('/api/health');
    expect(docs.internalPilotChecklist).toContain('3~5명');
    expect(combined).not.toContain('raw output must not appear');
    expect(combined).not.toContain('C:\\Users\\yohan');
    expect(combined).not.toContain('codexmux-secret');
  });

  it('writes summary and documents and refuses to overwrite without force', async () => {
    const {
      loadWindowsEvidenceFiles,
      buildWindowsEvidenceSummary,
      renderWindowsEvidenceDocuments,
      writeWindowsEvidencePack,
    } = await loadLib();

    const evidence = await loadWindowsEvidenceFiles(fixtureDir);
    const summary = buildWindowsEvidenceSummary({
      evidence,
      generatedAt: '2026-05-09T01:10:00.000Z',
    });
    const docs = renderWindowsEvidenceDocuments({
      evidence,
      summary,
      date: '2026-05-09',
      evidenceDir: fixtureDir,
    });

    const first = await writeWindowsEvidencePack({
      evidenceDir: tempDir,
      docsRoot: tempDir,
      date: '2026-05-09',
      summary,
      documents: docs,
      force: false,
    });

    await expect(fs.readFile(path.join(tempDir, 'summary.json'), 'utf-8'))
      .resolves.toContain('"overallStatus": "blocked"');
    await expect(fs.readFile(first.documents.handoff, 'utf-8'))
      .resolves.toContain('Windows Release Evidence');

    await expect(writeWindowsEvidencePack({
      evidenceDir: tempDir,
      docsRoot: tempDir,
      date: '2026-05-09',
      summary,
      documents: docs,
      force: false,
    })).rejects.toThrow('evidence-document-exists');

    await expect(writeWindowsEvidencePack({
      evidenceDir: tempDir,
      docsRoot: tempDir,
      date: '2026-05-09',
      summary,
      documents: docs,
      force: true,
    })).resolves.toMatchObject({
      summaryPath: path.join(tempDir, 'summary.json'),
    });
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
corepack pnpm vitest run tests/unit/scripts/windows-evidence-pack-lib.test.ts
```

Expected:

- FAIL because `scripts/windows-evidence-pack-lib.mjs` does not exist.

Do not implement until this failure is observed.

---

### Task 2: Evidence Pack Library

**Files:**
- Create: `scripts/windows-evidence-pack-lib.mjs`
- Test: `tests/unit/scripts/windows-evidence-pack-lib.test.ts`

- [ ] **Step 1: Implement the minimal library**

Create `scripts/windows-evidence-pack-lib.mjs`:

```javascript
import fs from 'fs/promises';
import path from 'path';

const evidenceFileRe = /\.json$/i;
const blockedStatuses = new Set(['failed', 'blocked']);
const droppedKeyPattern = /^(stdout|stderr|raw|output|log|logs|token|cookie|password|sessionName|sessionId|workspaceId|tabId|terminalOutput|prompt|assistantText)$/i;
const windowsTempPathPattern = /[A-Za-z]:\\Users\\[^\\\s]+\\AppData\\Local\\Temp\\codexmux-[^"'\n\r\t ]+/gi;
const absoluteWindowsPathPattern = /[A-Za-z]:\\Users\\[^"'\n\r\t ]+/g;
const defaultManualRequired = ['smart-screen-reputation'];

const statusRank = {
  passed: 0,
  'manual-required': 1,
  blocked: 2,
  failed: 3,
};

const sanitizeString = (value) =>
  value
    .replace(windowsTempPathPattern, '[tmp]')
    .replace(absoluteWindowsPathPattern, '[path]');

export const sanitizeWindowsEvidenceValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => sanitizeWindowsEvidenceValue(item));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? sanitizeString(value) : value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !droppedKeyPattern.test(key))
      .map(([key, item]) => [key, sanitizeWindowsEvidenceValue(item)]),
  );
};

const asArray = (value) => Array.isArray(value) ? value : [];

const stringArray = (value) =>
  asArray(value).filter((item) => typeof item === 'string');

const readJsonFile = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
};

const normalizeStatus = (status, payload) => {
  if (status === 'passed' || status === 'failed' || status === 'blocked' || status === 'manual-required') {
    return status;
  }
  if (payload?.ok === true) return 'passed';
  if (payload?.ok === false) return 'failed';
  return 'manual-required';
};

const collectCheckNames = (payload) =>
  asArray(payload?.checks).map((check) => {
    if (typeof check === 'string') return { name: check, status: 'passed' };
    if (check && typeof check === 'object') {
      return {
        name: typeof check.name === 'string' ? check.name : 'unnamed-check',
        status: typeof check.status === 'string' ? check.status : 'manual-required',
        message: typeof check.message === 'string' ? sanitizeString(check.message) : undefined,
      };
    }
    return { name: 'unnamed-check', status: 'manual-required' };
  });

export const normalizeWindowsEvidence = (raw, sourcePath = null) => {
  const payload = sanitizeWindowsEvidenceValue(raw.payload ?? raw);
  const smokeName = typeof raw.smokeName === 'string'
    ? raw.smokeName
    : typeof payload.smokeName === 'string'
      ? payload.smokeName
      : sourcePath
        ? path.basename(sourcePath, '.json')
        : 'unknown-smoke';
  const status = normalizeStatus(raw.status, payload);

  return {
    schemaVersion: 1,
    smokeName,
    command: typeof raw.command === 'string' ? raw.command : `corepack pnpm smoke:${smokeName.replace(/^windows-/, 'windows:')}`,
    status,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    endedAt: typeof raw.endedAt === 'string' ? raw.endedAt : null,
    durationMs: Number.isFinite(raw.durationMs) ? raw.durationMs : null,
    version: typeof raw.version === 'string'
      ? raw.version
      : typeof payload.version === 'string'
        ? payload.version
        : null,
    checks: collectCheckNames(payload),
    blockers: stringArray(raw.blockers).concat(stringArray(payload.blockers)),
    caveats: stringArray(raw.caveats).concat(stringArray(payload.caveats)),
    payload,
    sourcePath,
  };
};

export const loadWindowsEvidenceFiles = async (evidenceDir) => {
  const entries = await fs.readdir(evidenceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && evidenceFileRe.test(entry.name) && entry.name !== 'summary.json')
    .map((entry) => path.join(evidenceDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const evidence = [];
  for (const file of files) {
    evidence.push(normalizeWindowsEvidence(await readJsonFile(file), file));
  }
  return evidence;
};

const unique = (items) => [...new Set(items.filter(Boolean))];

const detectUnsigned = (evidence) =>
  evidence.some((item) =>
    item.smokeName.includes('signing')
    && (
      item.status !== 'passed'
      || JSON.stringify(item.payload).includes('NotSigned')
      || item.blockers.some((blocker) => blocker.toLowerCase().includes('unsigned'))
    ));

export const buildWindowsEvidenceSummary = ({
  evidence,
  generatedAt = new Date().toISOString(),
} = {}) => {
  const normalized = [...evidence].sort((left, right) => left.smokeName.localeCompare(right.smokeName));
  const unsigned = detectUnsigned(normalized);
  const blockers = unique(normalized.flatMap((item) => item.blockers));
  const caveats = unique(normalized.flatMap((item) => item.caveats));
  const passed = normalized.filter((item) => item.status === 'passed').map((item) => item.smokeName);
  const blocked = normalized.filter((item) => blockedStatuses.has(item.status)).map((item) => item.smokeName);
  const manualRequired = normalized.filter((item) => item.status === 'manual-required').map((item) => item.smokeName);

  if (unsigned && !blockers.includes('installer and executable are unsigned')) {
    blockers.push('installer and executable are unsigned');
  }
  if (unsigned && !manualRequired.includes('smart-screen-reputation')) {
    manualRequired.push(...defaultManualRequired);
  }
  if (unsigned && !caveats.includes('internal pilot may proceed only through trusted internal distribution')) {
    caveats.push('internal pilot may proceed only through trusted internal distribution');
  }

  const worstStatus = normalized.reduce(
    (worst, item) => statusRank[item.status] > statusRank[worst] ? item.status : worst,
    'passed',
  );

  return {
    schemaVersion: 1,
    generatedAt,
    version: normalized.find((item) => item.version)?.version ?? null,
    overallStatus: unsigned || blocked.length > 0 ? 'blocked' : worstStatus,
    internalReleaseReady: blocked.every((name) => name.includes('signing')) || blocked.length === 0,
    externalReleaseReady: !unsigned && blocked.length === 0 && manualRequired.length === 0,
    passed,
    blocked,
    manualRequired: unique(manualRequired),
    blockers,
    caveats,
    evidenceCount: normalized.length,
    documents: [],
  };
};

const resultLabel = (status) => {
  switch (status) {
    case 'passed':
      return '통과';
    case 'blocked':
      return '차단';
    case 'failed':
      return '실패';
    case 'manual-required':
      return '수동 확인 필요';
    default:
      return '알 수 없음';
  }
};

const renderEvidenceRows = (evidence) =>
  [
    '| Smoke | 결과 | 시간 | 주요 확인 |',
    '| --- | --- | --- | --- |',
    ...evidence.map((item) => [
      `| \`${item.smokeName}\``,
      resultLabel(item.status),
      item.durationMs == null ? '-' : `${item.durationMs}ms`,
      item.checks.map((check) => check.name).join(', ') || '-',
      '|',
    ].join(' | ')),
  ].join('\n');

export const renderWindowsEvidenceDocuments = ({
  evidence,
  summary,
  date,
  evidenceDir,
}) => {
  const version = summary.version ?? 'unknown';
  const blockerList = summary.blockers.length > 0
    ? summary.blockers.map((item) => `- ${item}`).join('\n')
    : '- 없음';
  const caveatList = summary.caveats.length > 0
    ? summary.caveats.map((item) => `- ${item}`).join('\n')
    : '- 없음';

  return {
    handoff: [
      `# ${date} Windows Release Evidence`,
      '',
      '## 요약',
      '',
      `- 버전: \`${version}\``,
      `- Evidence directory: \`${sanitizeString(evidenceDir)}\``,
      `- 전체 상태: \`${summary.overallStatus}\``,
      `- 내부 배포 가능: ${summary.internalReleaseReady ? '예' : '아니오'}`,
      `- 외부 공개 가능: ${summary.externalReleaseReady ? '예' : '아니오'}`,
      '',
      '## Smoke 결과',
      '',
      renderEvidenceRows(evidence),
      '',
      '## Blockers',
      '',
      blockerList,
      '',
      '## Caveats',
      '',
      caveatList,
      '',
      '## 다음 운영 Action',
      '',
      '- blocker가 signing/SmartScreen뿐이면 내부 파일럿을 trusted internal distribution으로 제한한다.',
      '- 외부 공개 전에는 signed installer와 SmartScreen reputation evidence를 다시 수집한다.',
      '',
    ].join('\n'),
    internalReleaseNote: [
      `# ${date} Windows 내부 Release Note`,
      '',
      `Windows 내부 릴리스 \`${version}\`은 내부 파일럿 후보입니다.`,
      '',
      '## 확인된 항목',
      '',
      ...summary.passed.map((item) => `- \`${item}\` 통과`),
      '',
      '## 알려진 제한',
      '',
      caveatList,
      '',
      '## 배포 판정',
      '',
      `- 내부 파일럿: ${summary.internalReleaseReady ? '가능' : '차단'}`,
      `- 외부 공개: ${summary.externalReleaseReady ? '가능' : '차단'}`,
      '',
    ].join('\n'),
    installUpdateGuide: [
      `# ${date} Windows 설치/업데이트 안내`,
      '',
      '## 설치 전 확인',
      '',
      '- 내부 배포 채널에서 받은 installer인지 확인한다.',
      '- unsigned caveat가 있으면 unknown publisher 또는 SmartScreen 경고가 표시될 수 있다.',
      '',
      '## 설치',
      '',
      '1. `codexmux-Setup-<version>.exe`를 실행한다.',
      '2. 설치 과정에서 오류가 없는지 확인한다.',
      '3. 앱 실행 후 PowerShell에서 `/api/health`를 확인한다.',
      '',
      '```powershell',
      'Invoke-RestMethod http://127.0.0.1:8121/api/health',
      '```',
      '',
      '## 업데이트',
      '',
      '1. 기존 설치 앱을 실행한다.',
      '2. updater가 update를 다운로드할 때까지 기다린다.',
      '3. `quitAndInstall` 이후 앱을 다시 실행한다.',
      '4. `/api/health`의 version이 기대 버전인지 확인한다.',
      '',
      '## 문제 보고 항목',
      '',
      '- Windows version',
      '- fresh install 또는 update 여부',
      '- `/api/health` 응답',
      '- workspace 생성/열기 여부',
      '- terminal 생성/input/output 여부',
      '',
    ].join('\n'),
    internalPilotChecklist: [
      `# ${date} Windows 내부 Pilot Checklist`,
      '',
      '3~5명 내부 사용자가 최소 4시간 실제 workspace를 사용한다.',
      '',
      '| 항목 | 기록 |',
      '| --- | --- |',
      '| 설치 방식 | fresh install / update |',
      '| Windows 버전 | 예: Windows 11 24H2 |',
      '| SmartScreen 또는 unknown publisher 경고 | 표시됨 / 표시 안 됨 / 문구 기록 |',
      '| 앱 launch | 성공 / 실패 |',
      '| `/api/health` | 기대 version 확인 / 실패 |',
      '| workspace 생성/열기 | 성공 / 실패 |',
      '| terminal 생성 | 성공 / 실패 |',
      '| terminal 입력/출력 | 성공 / 실패 |',
      '| Codex CLI 실제 사용 | 성공 / 실패 |',
      '| app close 후 engine 유지 | 성공 / 실패 |',
      '| 30분 이상 열린 session 유지 | 성공 / 실패 |',
      '| crash/update/attach/reconnect 이슈 | 상세 기록 |',
      '',
    ].join('\n'),
  };
};

const assertWritable = async (filePath, force) => {
  if (force) return;
  try {
    await fs.access(filePath);
    throw new Error(`evidence-document-exists: ${filePath}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('evidence-document-exists')) throw err;
  }
};

export const writeWindowsEvidencePack = async ({
  evidenceDir,
  docsRoot = process.cwd(),
  date,
  summary,
  documents,
  force = false,
}) => {
  const summaryPath = path.join(evidenceDir, 'summary.json');
  const operationsDir = path.join(docsRoot, 'docs', 'operations');
  const releasesDir = path.join(docsRoot, 'docs', 'releases');
  const documentPaths = {
    handoff: path.join(operationsDir, `${date}-windows-release-evidence.md`),
    internalReleaseNote: path.join(releasesDir, `${date}-internal-release-note.md`),
    installUpdateGuide: path.join(releasesDir, `${date}-install-update-guide.md`),
    internalPilotChecklist: path.join(releasesDir, `${date}-internal-pilot-checklist.md`),
  };

  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.mkdir(operationsDir, { recursive: true });
  await fs.mkdir(releasesDir, { recursive: true });

  for (const filePath of Object.values(documentPaths)) {
    await assertWritable(filePath, force);
  }

  const nextSummary = {
    ...summary,
    documents: Object.values(documentPaths),
  };
  await fs.writeFile(summaryPath, `${JSON.stringify(nextSummary, null, 2)}\n`, 'utf-8');
  await fs.writeFile(documentPaths.handoff, documents.handoff, 'utf-8');
  await fs.writeFile(documentPaths.internalReleaseNote, documents.internalReleaseNote, 'utf-8');
  await fs.writeFile(documentPaths.installUpdateGuide, documents.installUpdateGuide, 'utf-8');
  await fs.writeFile(documentPaths.internalPilotChecklist, documents.internalPilotChecklist, 'utf-8');

  return {
    summaryPath,
    documents: documentPaths,
  };
};
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
corepack pnpm vitest run tests/unit/scripts/windows-evidence-pack-lib.test.ts
```

Expected:

- PASS.

- [ ] **Step 3: Refactor only if needed**

Allowed refactor:

- Extract tiny helper functions inside `scripts/windows-evidence-pack-lib.mjs` if lint complains.
- Do not introduce dependencies.
- Do not change fixture expectations unless the implementation reveals a test typo.

- [ ] **Step 4: Checkpoint**

Do not commit unless the user explicitly asks. If commit is requested later, use:

```bash
git add scripts/windows-evidence-pack-lib.mjs tests/fixtures/windows-evidence tests/unit/scripts/windows-evidence-pack-lib.test.ts
git commit -m "feat: add windows evidence pack library"
```

---

### Task 3: Evidence Pack CLI

**Files:**
- Create: `scripts/smoke-windows-evidence-pack.mjs`
- Modify: `package.json`
- Test: `tests/unit/scripts/windows-evidence-pack-lib.test.ts`

- [ ] **Step 1: Add CLI script**

Create `scripts/smoke-windows-evidence-pack.mjs`:

```javascript
#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import {
  buildWindowsEvidenceSummary,
  loadWindowsEvidenceFiles,
  normalizeWindowsEvidence,
  renderWindowsEvidenceDocuments,
  writeWindowsEvidencePack,
} from './windows-evidence-pack-lib.mjs';
import fs from 'fs/promises';

const timestampForDir = (date = new Date()) =>
  date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const defaultEvidenceDir = () =>
  path.join(process.cwd(), 'artifacts', 'smoke', 'windows', timestampForDir());

const runSteps = [
  ['windows-update-metadata', 'smoke:windows:update-metadata'],
  ['windows-signing-evidence', 'smoke:windows:signing-evidence'],
  ['windows-updater-local-feed', 'smoke:windows:updater-local-feed'],
  ['windows-updater-published-channel', 'smoke:windows:updater-published-channel'],
  ['windows-updater-github-feed', 'smoke:windows:updater-github-feed'],
  ['windows-packaged-launch', 'smoke:windows:packaged-launch'],
  ['windows-engine-lifecycle', 'smoke:windows:engine-lifecycle'],
  ['windows-packaged-runtime-v2', 'smoke:windows:packaged-runtime-v2'],
  ['windows-installer-install', 'smoke:windows:installer-install'],
  ['windows-installer-runtime-v2', 'smoke:windows:installer-runtime-v2'],
  ['windows-package-gate', 'smoke:windows:package-gate'],
  ['windows-release-gate', 'smoke:windows:release-gate'],
];

const parseArgs = (argv) => {
  const result = {
    mode: 'from',
    from: null,
    out: null,
    force: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--run') {
      result.mode = 'run';
    } else if (arg === '--from') {
      result.mode = 'from';
      result.from = argv[++i];
    } else if (arg === '--out') {
      result.out = argv[++i];
    } else if (arg === '--force') {
      result.force = true;
    } else {
      throw new Error(`unknown-argument: ${arg}`);
    }
  }

  if (result.mode === 'from' && !result.from) {
    throw new Error('missing-required-argument: --from');
  }

  return result;
};

const runPackageScript = (script, { env }) => new Promise((resolve) => {
  const startedAt = new Date().toISOString();
  const child = spawn(process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'corepack', process.platform === 'win32'
    ? ['/d', '/s', '/c', `corepack pnpm ${script}`]
    : ['pnpm', script], {
    cwd: process.cwd(),
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', (err) => {
    resolve({
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode: null,
      ok: false,
      payload: { ok: false, code: 'spawn-failed', message: err.message },
    });
  });
  child.on('close', (code) => {
    let payload = { ok: code === 0 };
    const trimmed = stdout.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        payload = JSON.parse(trimmed);
      } catch {
        payload = { ok: code === 0, code: code === 0 ? undefined : 'stdout-json-parse-failed' };
      }
    }
    resolve({
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode: code,
      ok: code === 0,
      payload: {
        ...payload,
        stderr: code === 0 ? undefined : stderr,
      },
    });
  });
});

const writeRunEvidence = async ({ evidenceDir, smokeName, script, result }) => {
  const evidence = normalizeWindowsEvidence({
    schemaVersion: 1,
    smokeName,
    command: `corepack pnpm ${script}`,
    status: result.ok ? 'passed' : 'failed',
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: Date.parse(result.endedAt) - Date.parse(result.startedAt),
    payload: result.payload,
  });
  const filePath = path.join(evidenceDir, `${smokeName}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf-8');
};

const runSmokeEvidence = async (evidenceDir) => {
  await fs.mkdir(evidenceDir, { recursive: true });
  const env = {
    ...process.env,
    CODEXMUX_SMOKE_ARTIFACT_DIR: evidenceDir,
  };

  for (const [smokeName, script] of runSteps) {
    const result = await runPackageScript(script, { env });
    await writeRunEvidence({ evidenceDir, smokeName, script, result });
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const evidenceDir = path.resolve(args.out ?? args.from ?? defaultEvidenceDir());

  if (args.mode === 'run') {
    await runSmokeEvidence(evidenceDir);
  }

  const evidence = await loadWindowsEvidenceFiles(evidenceDir);
  const date = new Date().toISOString().slice(0, 10);
  const summary = buildWindowsEvidenceSummary({ evidence });
  const documents = renderWindowsEvidenceDocuments({
    evidence,
    summary,
    date,
    evidenceDir,
  });
  const written = await writeWindowsEvidencePack({
    evidenceDir,
    docsRoot: process.cwd(),
    date,
    summary,
    documents,
    force: args.force,
  });

  const output = {
    ok: summary.internalReleaseReady,
    evidenceDir,
    summaryPath: written.summaryPath,
    documents: written.documents,
    summary,
  };
  console.log(JSON.stringify(output, null, 2));

  if (!summary.internalReleaseReady) process.exitCode = 1;
};

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: 'windows-evidence-pack-failed',
    message: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
```

- [ ] **Step 2: Add package script**

Modify `package.json` scripts section:

```json
"smoke:windows:evidence-pack": "node scripts/smoke-windows-evidence-pack.mjs"
```

Place it near the other `smoke:windows:*` scripts.

- [ ] **Step 3: Run syntax check**

Run:

```bash
node --check scripts/smoke-windows-evidence-pack.mjs
```

Expected:

- No output and exit code 0.

- [ ] **Step 4: Run fixture mode**

Run:

```bash
corepack pnpm smoke:windows:evidence-pack --from tests/fixtures/windows-evidence --out artifacts/smoke/windows/test-evidence-pack --force
```

Expected:

- JSON output with `ok: true`.
- `artifacts/smoke/windows/test-evidence-pack/summary.json` exists.
- `docs/operations/<today>-windows-release-evidence.md` exists unless `docsRoot` behavior is adjusted for test mode.

If this command writes real docs during local verification, keep the generated docs only if they are intended source artifacts. Otherwise remove them with a non-destructive explicit path cleanup after inspecting them:

```powershell
Remove-Item -LiteralPath docs\operations\<today>-windows-release-evidence.md
Remove-Item -LiteralPath docs\releases\<today>-internal-release-note.md
Remove-Item -LiteralPath docs\releases\<today>-install-update-guide.md
Remove-Item -LiteralPath docs\releases\<today>-internal-pilot-checklist.md
```

- [ ] **Step 5: Checkpoint**

Do not commit unless the user explicitly asks. If commit is requested later, use:

```bash
git add package.json scripts/smoke-windows-evidence-pack.mjs scripts/windows-evidence-pack-lib.mjs tests/fixtures/windows-evidence tests/unit/scripts/windows-evidence-pack-lib.test.ts
git commit -m "feat: add windows evidence pack cli"
```

---

### Task 4: Docs

**Files:**
- Modify: `docs/TESTING.md`
- Modify: `docs/FOLLOW-UP.md`

- [ ] **Step 1: Update `docs/TESTING.md`**

Add a section near Windows smoke documentation:

```markdown
## Windows Evidence Pack

Windows 패키징/업데이트 smoke 결과 정리는 evidence pack generator를 사용한다.

이미 생성된 evidence JSON을 문서로 묶을 때:

```bash
corepack pnpm smoke:windows:evidence-pack --from artifacts/smoke/windows/<timestamp>
```

smoke 실행과 문서 생성을 함께 수행할 때:

```bash
corepack pnpm smoke:windows:evidence-pack --run
```

생성물:

- `artifacts/smoke/windows/<timestamp>/summary.json`
- `docs/operations/YYYY-MM-DD-windows-release-evidence.md`
- `docs/releases/YYYY-MM-DD-internal-release-note.md`
- `docs/releases/YYYY-MM-DD-install-update-guide.md`
- `docs/releases/YYYY-MM-DD-internal-pilot-checklist.md`

Evidence pack은 raw stdout/stderr, token, temp path, terminal output을 저장하지 않는다.
Unsigned installer/exe는 내부 파일럿 caveat와 외부 공개 blocker로 자동 분류한다.
```

- [ ] **Step 2: Update `docs/FOLLOW-UP.md`**

In the completed scope list, add one concise line:

```markdown
- Windows evidence pack generator: Windows smoke JSON evidence를 `summary.json`, 운영 handoff, 내부 release note, 설치/업데이트 안내, 내부 pilot checklist로 자동 집계하는 `smoke:windows:evidence-pack` 명령을 추가했다.
```

In the remaining Windows package/update smoke item, replace manual document wording with:

```markdown
Windows package/update smoke 결과는 `corepack pnpm smoke:windows:evidence-pack --run` 또는 `--from <evidence-dir>`로 운영 문서와 내부 배포 안내를 생성한다.
```

- [ ] **Step 3: Run doc-adjacent checks**

Run:

```bash
corepack pnpm vitest run tests/unit/scripts/windows-evidence-pack-lib.test.ts
```

Expected:

- PASS.

- [ ] **Step 4: Checkpoint**

Do not commit unless the user explicitly asks. If commit is requested later, use:

```bash
git add docs/TESTING.md docs/FOLLOW-UP.md
git commit -m "docs: document windows evidence pack workflow"
```

---

### Task 5: Final Verification

**Files:**
- No new source files unless previous tasks reveal a specific defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
corepack pnpm vitest run tests/unit/scripts/windows-evidence-pack-lib.test.ts
```

Expected:

- PASS.

- [ ] **Step 2: Run syntax checks for new `.mjs` scripts**

Run:

```bash
node --check scripts/windows-evidence-pack-lib.mjs
node --check scripts/smoke-windows-evidence-pack.mjs
```

Expected:

- Both commands exit 0.

- [ ] **Step 3: Run typecheck**

Run:

```bash
corepack pnpm tsc --noEmit
```

Expected:

- PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
corepack pnpm lint
```

Expected:

- PASS.

- [ ] **Step 5: Run full unit suite**

Run:

```bash
corepack pnpm test
```

Expected:

- PASS.

- [ ] **Step 6: Run fixture CLI smoke**

Run:

```bash
corepack pnpm smoke:windows:evidence-pack --from tests/fixtures/windows-evidence --out artifacts/smoke/windows/test-evidence-pack --force
```

Expected:

- JSON output includes `"ok": true`.
- `artifacts/smoke/windows/test-evidence-pack/summary.json` exists.
- The generated summary does not contain `raw output must not appear`, `C:\Users\yohan`, `codexmux-secret`, `stdout`, or `stderr`.

- [ ] **Step 7: Inspect git status**

Run:

```bash
git status -sb
```

Expected:

- Only intended evidence pack files plus pre-existing unrelated dirty files are shown.
- Do not revert existing unrelated changes.

---

## Self-Review

- Spec coverage:
  - Evidence schema: Task 1 and Task 2.
  - `--from` mode: Task 3 and Task 5.
  - `--run` mode: Task 3.
  - Summary and document generation: Task 2.
  - Redaction: Task 1 and Task 2.
  - Docs: Task 4.
  - Existing smoke stdout compatibility: Task 3 keeps wrapper mode and does not edit existing smoke scripts.
- Placeholder scan:
  - No `TBD`, `TODO`, or unspecified implementation steps.
- Type/name consistency:
  - Library exports used by tests and CLI: `loadWindowsEvidenceFiles`, `buildWindowsEvidenceSummary`, `renderWindowsEvidenceDocuments`, `writeWindowsEvidencePack`, `normalizeWindowsEvidence`.
  - CLI script name and package script are consistent: `scripts/smoke-windows-evidence-pack.mjs`, `smoke:windows:evidence-pack`.

