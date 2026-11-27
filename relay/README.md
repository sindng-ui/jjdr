# jjdr-relay — Windows 공용 PC 초경량 팀 Relay 서버

`jjdr` 팀원 간 온라인 PR 자동 리뷰 요청·실시간 미니 상태바 중계를 담당하는 단일 실행 파일(`jjdr-relay.exe`) + SQLite 1파일 서버입니다.

- **Zero-Git / Zero-AI**: 공용 PC에 GitHub 토큰이나 AI 키를 절대 저장하지 않습니다.
- **Zero-DLL**: SQLite(`rusqlite bundled`)가 실행 파일 안에 내장되어 있어 별도 런타임 설치가 필요 없습니다.
- **Online-Only 안전 정책**: 오프라인·일시정지(Paused) 상태의 팀원에게는 리뷰 요청이 즉시 차단(`reviewer_offline` / `reviewer_paused`)되어, 퇴근·휴가 뒤 복귀 시 오래된 PR이 한꺼번에 실행되는 사고를 방지합니다.

---

## 1. 빌드

```powershell
cargo build --release --manifest-path relay/Cargo.toml
# 출력: relay\target\release\jjdr-relay.exe
```

## 2. 설정 파일 예시 (`jjdr-relay.toml`)

`jjdr-relay.exe`와 같은 폴더에 `jjdr-relay.toml`을 두거나 환경변수로 실행합니다.

```toml
bind_addr = "0.0.0.0:8787"
db_path = "jjdr-relay.db"
team_key = "replace-with-your-team-shared-secret"
ttl_hours = 2
rate_limit_per_min = 30
max_reviewers_per_request = 5
```

또는 환경변수로 바로 실행:

```powershell
$env:JJDR_RELAY_TEAM_KEY = "my-team-secret"
$env:JJDR_RELAY_BIND = "0.0.0.0:8787"
.\jjdr-relay.exe
```

## 3. Windows 방화벽 인바운드 포트 1개 오픈 (관리자 PowerShell)

```powershell
New-NetFirewallRule -DisplayName "jjdr-relay (TCP 8787)" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow
```

## 4. Windows 공용 PC 부팅 시 자동 실행 등록 (작업 스케줄러)

```powershell
$action = New-ScheduledTaskAction -Execute "C:\jjdr-relay\jjdr-relay.exe" -WorkingDirectory "C:\jjdr-relay"
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName "jjdr-relay" -Action $action -Trigger $trigger -RunLevel Highest -Force
```

## 5. 사내 실전 스모크 테스트 (내 PC → 공용 PC 연결 검증)

회사 공용 PC에서 `jjdr-relay.exe`를 띄운 뒤, 개발자 PC에서 아래 스크립트로 **헬스체크 + 인증 차단 + 2명 리뷰어 실시간 중계 + 오프라인 배달 + Layer-1 거절**까지 5초 만에 검증할 수 있습니다:

```powershell
node relay/scripts/smoke_test_relay.mjs --url http://<공용PC_IP>:8787 --key <TEAM_KEY>
```
