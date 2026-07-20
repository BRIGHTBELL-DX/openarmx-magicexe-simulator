# OpenArmX MAGIC.EXE 전용 드럼 타임라인 시뮬레이터

OpenArmX 양팔 로봇으로 "MAGIC.EXE" 한 곡을 연주하기 위한, 이 곡 전용 타임라인 수동 편집 도구입니다.
기존 [openarmx-drum-simulator](https://github.com/BRIGHTBELL-DX/openarmx-drum-simulator)에서 파생됐으며,
자동 생성 없이 오프라인 실측 영상을 보면서 직접 비트를 찍는 워크플로에 맞춰 기능을 정리했습니다.

## 실행 방법

```bash
python serve.py
```
브라우저에서 `http://localhost:8084/magicexe_drum_simulator/` 접속

또는 `run.bat` 더블클릭

## 이 버전에서 달라진 점

- 곡(MAGIC.EXE Mastering)이 페이지 로드 시 자동으로 재생 트랙에 로드됨, BPM 기본값 136
- 자동 생성·드럼 오디오 분석·MIDI 채보 기능 제거 — 순수 드래그 기반 수동 비트 편집만 남김
- 참고 영상 업로드 + 오프셋(초) 입력으로 영상 재생 위치를 음악 타임라인과 맞춰볼 수 있음(영상 자체 소리는 음소거하지 않음)
- 타임라인의 각 비트마다 타격 팔(L/R)을 개별 지정 가능 — 기본값은 드럼의 소속 팔이며 드롭다운으로 덮어쓸 수 있음
- 드럼 키트 위치 편집·YAML 내보내기·L/R 팔 독립 IK 애니메이션 등 나머지 기능은 기존과 동일
