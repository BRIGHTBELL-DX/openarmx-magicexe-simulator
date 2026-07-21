import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const PI = Math.PI;

// ═══════════════════════════════════════════════════════════════
//  드럼 타입 DB
// ═══════════════════════════════════════════════════════════════
// tilt: 헤드 기울기 기본값(°) — 로봇(연주자) 방향으로 기울어짐. drum.tiltDeg로 개별 오버라이드 가능
const DRUM_TYPES = {
  hihat:  { name:'하이 햇',      color:'#00ddff', preDur:0.06, rebDur:0.08, style:'wrist', tilt: 4 }, // 시안
  snare:  { name:'스네어',       color:'#ffffff', preDur:0.08, rebDur:0.10, style:'full',  tilt:15 }, // 흰색
  tom_h:  { name:'스몰 탐',      color:'#ff3366', preDur:0.09, rebDur:0.11, style:'full',  tilt:15 }, // 핑크레드
  tom_m:  { name:'미들 탐',      color:'#ff8800', preDur:0.09, rebDur:0.11, style:'full',  tilt:15 }, // 주황
  tom_f:  { name:'플로어 탐',    color:'#bb44ff', preDur:0.10, rebDur:0.13, style:'full',  tilt:15 }, // 보라
  crash:  { name:'크래쉬 심벌',  color:'#ffdd00', preDur:0.10, rebDur:0.16, style:'big',   tilt:12 }, // 골드
  ride:   { name:'라이드 심벌',  color:'#44ff99', preDur:0.09, rebDur:0.13, style:'full',  tilt:10 }, // 민트
  kick:   { name:'킥 (베이스 드럼)', color:'#884422', preDur:0, rebDur:0,   style:'none',  tilt: 0 }, // 브라운
};

// ═══════════════════════════════════════════════════════════════
//  타격 강도 (velocity) 배율 테이블
// ═══════════════════════════════════════════════════════════════
const VEL_SCALE = {
  //          raiseZ  j7Strike  rebZ   j4(strike 보정)
  soft:   { raiseZ: 0.35, j7Strike: 0.40, rebZ: 0.30, j4: -0.10 },
  medium: { raiseZ: 1.00, j7Strike: 1.00, rebZ: 1.00, j4:  0.00 },
  hard:   { raiseZ: 1.80, j7Strike: 1.55, rebZ: 1.75, j4: +0.14 },
};
const VEL_GLOW = {
  soft:   c => `0 0 3px ${c}44`,
  medium: c => `0 0 6px ${c}66`,
  hard:   c => `0 0 11px ${c}bb`,
};

// ═══════════════════════════════════════════════════════════════
//  드럼 키트 상태
// ═══════════════════════════════════════════════════════════════
// 어깨(암 루트) 높이 0.698m 기준 — 실제 7피스 드럼 키트 배치 (드럼채 대응).
// 아래 좌표·팔 배정은 사용자가 확정한 현장 세팅 값(킥 미사용). 드럼 id는
// 템플릿(프리셋)이 참조하므로 유지한다 — 킥이 쓰던 d4는 비우고 나머지는
// 기존 id 그대로 둔다.
let drumKit = [
  // ─ L팔 ─────────────────────────────────────────────────────────
  { id:'d0', name:'하이 햇',     type:'hihat', arm:'L', pos:{x:0.62, y: 0.41,  z:0.25} },
  { id:'d1', name:'크래쉬 심벌', type:'crash', arm:'L', pos:{x:0.78, y: 0.27,  z:0.35} },
  { id:'d2', name:'스네어',      type:'snare', arm:'L', pos:{x:0.59, y: 0.00,  z:0.20} },
  { id:'d3', name:'스몰 탐',     type:'tom_h', arm:'L', pos:{x:0.80, y: 0.10,  z:0.35} },
  // ─ R팔 ─────────────────────────────────────────────────────────
  { id:'d5', name:'미들 탐',     type:'tom_m', arm:'R', pos:{x:0.80, y:-0.10,  z:0.35} },
  { id:'d6', name:'플로어 탐',   type:'tom_f', arm:'R', pos:{x:0.56, y:-0.44,  z:0.20} },
  { id:'d7', name:'라이드 심벌', type:'ride',  arm:'R', pos:{x:0.72, y:-0.33,  z:0.35} },
];
// id는 비연속(d4 없음)일 수 있으므로 개수가 아니라 최대 id+1로 다음 id를 잡는다.
let nextDrumId = Math.max(8, ...drumKit.map(d => parseInt(d.id.replace(/\D/g, '')) + 1));

// 기본값 스냅샷 (초기화 버튼용)
const DEFAULT_DRUM_KIT = drumKit.map(d => ({...d, pos: {...d.pos}}));
const _DK_STORE = 'openarmx_drum_kit_v18';

function saveDrumKit() {
  try { localStorage.setItem(_DK_STORE, JSON.stringify(drumKit)); } catch(e) {}
}
function loadDrumKit() {
  try {
    const raw = localStorage.getItem(_DK_STORE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length || !parsed[0]?.pos) return;
    drumKit = parsed;
    nextDrumId = Math.max(DEFAULT_DRUM_KIT.length,
      ...drumKit.map(d => parseInt(d.id.replace(/\D/g,'')) + 1));
  } catch(e) {}
}
window.resetDrumKit = function () {
  // 템플릿 선택 드롭다운과 정렬 — 선택된 템플릿이 있으면 그 템플릿 위치로
  // 초기화하고, 선택된 게 없을 때만 진짜 기본값(템플릿 1)으로 되돌린다.
  const sel = document.getElementById('preset-sel');
  const selectedName = sel ? sel.value : '';
  if (selectedName && drumPresets.some(p => p.name === selectedName)) {
    applyDrumPreset(selectedName);
    setStatus(`"${selectedName}" 템플릿 위치로 초기화됨`);
    return;
  }
  drumKit = DEFAULT_DRUM_KIT.map(d => ({...d, pos: {...d.pos}}));
  // id가 d4 없이 비연속(d0~d3, d5~d7)이라 배열 길이(7)를 그대로 쓰면
  // 다음 새 드럼이 이미 존재하는 d7과 충돌한다 — 실제 최대 id+1로 잡는다.
  nextDrumId = Math.max(8, ...drumKit.map(d => parseInt(d.id.replace(/\D/g, '')) + 1));
  saveDrumKit();
  rebuildDrumSpheres(); renderDrumList(); renderTimeline();
  _playKFs = buildFinalKeyframes(); _playDur = _playKFs.totalTime;
  setStatus('드럼 키트 기본값으로 초기화됨');
};

// ═══════════════════════════════════════════════════════════════
//  드럼 위치 프리셋(템플릿) — 실물 로봇 좌표 세팅을 이름으로 저장·전환
// ═══════════════════════════════════════════════════════════════
const _PRESET_STORE = 'openarmx_drum_presets_v1';

function _snapshotPositions() {
  const out = {};
  drumKit.forEach(d => { out[d.id] = { x: d.pos.x, y: d.pos.y, z: d.pos.z }; });
  return out;
}

function _loadDrumPresets() {
  // 배포 기본 시드 — 템플릿 1은 배포 기본값, 템플릿 2·3은 사용자가
  // 실물 테스트용으로 확정한 좌표
  const t1 = {};
  DEFAULT_DRUM_KIT.forEach(d => { t1[d.id] = { ...d.pos }; });
  const seeds = [
    { name: '템플릿 1', positions: t1 },
    { name: '템플릿 2', positions: {
        d0:{x:0.64, y:0.41,  z:0.40}, d1:{x:0.77, y:0.31,  z:0.50},
        d2:{x:0.66, y:0.19,  z:0.28}, d3:{x:0.76, y:0.11,  z:0.50},
        d4:{x:0.63, y:0.00,  z:0.12},
        d5:{x:0.77, y:-0.11, z:0.50}, d6:{x:0.66, y:-0.22, z:0.26},
        d7:{x:0.72, y:-0.40, z:0.50},
      } },
    { name: '템플릿 3', positions: {
        d0:{x:0.56, y:0.54,  z:0.40}, d1:{x:0.77, y:0.32,  z:0.50},
        d2:{x:0.59, y:0.42,  z:0.18}, d3:{x:0.76, y:0.11,  z:0.45},
        d4:{x:0.63, y:0.00,  z:0.12},
        d5:{x:0.76, y:-0.11, z:0.45}, d6:{x:0.55, y:-0.46, z:0.18},
        d7:{x:0.72, y:-0.40, z:0.50},
      } },
    { name: '템플릿 4', positions: {
        d0:{x:0.61, y:0.60,  z:0.40}, d1:{x:0.76, y:0.37,  z:0.50},
        d2:{x:0.51, y:0.41,  z:0.18}, d3:{x:0.76, y:0.16,  z:0.45},
        d4:{x:0.63, y:0.00,  z:0.12},
        d5:{x:0.76, y:-0.15, z:0.45}, d6:{x:0.51, y:-0.41, z:0.18},
        d7:{x:0.80, y:-0.41, z:0.50},
      } },
    { name: '템플릿 5', positions: {
        d0:{x:0.57, y:0.63,  z:0.35}, d1:{x:0.71, y:0.51,  z:0.45},
        d2:{x:0.63, y:0.36,  z:0.25}, d3:{x:0.76, y:0.16,  z:0.40},
        d4:{x:0.63, y:0.00,  z:0.12},
        d5:{x:0.76, y:-0.15, z:0.40}, d6:{x:0.59, y:-0.40, z:0.25},
        d7:{x:0.79, y:-0.41, z:0.45},
      } },
  ];
  try {
    const raw = localStorage.getItem(_PRESET_STORE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        // "템플릿 N"(코드로 관리하는 공식 시드)은 항상 최신 코드 값으로 동기화하고,
        // 그 외 사용자가 직접 다른 이름으로 저장한 커스텀 프리셋만 그대로 보존.
        // 예전엔 localStorage에 값이 있으면 시드를 무시해서, 코드에서 템플릿 값을
        // 수정해도 이미 그 템플릿을 저장해본 적 있는 브라우저에는 반영되지
        // 않는 문제가 있었음(신규 템플릿 추가는 물론 기존 템플릿 값 변경도 누락됨).
        const seedNames = new Set(seeds.map(s => s.name));
        const customOnly = parsed.filter(p => !seedNames.has(p.name));
        return seeds.concat(customOnly);
      }
    }
  } catch (e) {}
  return seeds;
}
let drumPresets = _loadDrumPresets();
function _saveDrumPresets() {
  try { localStorage.setItem(_PRESET_STORE, JSON.stringify(drumPresets)); } catch (e) {}
}
function renderPresetDropdown() {
  const sel = document.getElementById('preset-sel');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— 템플릿 선택 —</option>' +
    drumPresets.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  if (drumPresets.some(p => p.name === cur)) sel.value = cur;
}
window.applyDrumPreset = function (name) {
  if (!name) return;
  const preset = drumPresets.find(p => p.name === name);
  if (!preset) return;
  drumKit.forEach(d => {
    const p = preset.positions[d.id];
    if (p) Object.assign(d.pos, p);
  });
  saveDrumKit();
  rebuildDrumSpheres(); renderDrumList(); renderTimeline();
  _playKFs = buildFinalKeyframes(); _playDur = _playKFs.totalTime;
  setStatus(`"${name}" 템플릿 적용됨`);
};
window.saveDrumPreset = function () {
  const sel = document.getElementById('preset-sel');
  const name = prompt('저장할 템플릿 이름(기존 이름을 입력하면 덮어씁니다):', sel.value || '');
  if (!name) return;
  const positions = _snapshotPositions();
  const idx = drumPresets.findIndex(p => p.name === name);
  if (idx >= 0) drumPresets[idx] = { name, positions };
  else drumPresets.push({ name, positions });
  _saveDrumPresets();
  renderPresetDropdown();
  sel.value = name;
  setStatus(`"${name}" 템플릿으로 저장됨`);
};
window.deleteDrumPreset = function () {
  const sel = document.getElementById('preset-sel');
  const name = sel.value;
  if (!name) { setStatus('삭제할 템플릿을 먼저 선택하세요'); return; }
  if (!confirm(`"${name}" 템플릿을 삭제할까요?`)) return;
  drumPresets = drumPresets.filter(p => p.name !== name);
  _saveDrumPresets();
  renderPresetDropdown();
  setStatus(`"${name}" 템플릿 삭제됨`);
};

// 템플릿이 선택된 상태에서 드럼 위치를 손으로 바꾸면, 더 이상 그 템플릿과
// 일치하지 않으므로 드롭다운을 "선택 안 됨"으로 되돌려 저장을 유도한다
// (선택된 템플릿 이름이 그대로 남아있으면 실제로는 다른 위치인데도 마치
// 그 템플릿 그대로인 것처럼 보이는 문제가 있었음).
function _checkTemplateDirty() {
  const sel = document.getElementById('preset-sel');
  if (!sel || !sel.value) return;
  const preset = drumPresets.find(p => p.name === sel.value);
  if (!preset) return;
  const EPS = 0.005;
  const matches = drumKit.every(d => {
    const p = preset.positions[d.id];
    if (!p) return true;
    return Math.abs(d.pos.x - p.x) < EPS && Math.abs(d.pos.y - p.y) < EPS && Math.abs(d.pos.z - p.z) < EPS;
  });
  if (!matches) {
    const prevName = sel.value;
    sel.value = '';
    setStatus(`위치가 "${prevName}"에서 변경됨 — 이 위치를 저장하려면 💾 저장을 눌러주세요`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  설정·타임라인 영속 (localStorage) — 강력 새로고침에도 유지
// ═══════════════════════════════════════════════════════════════
const _SETTINGS_STORE = 'openarmx_settings_v1';
const _TIMELINE_STORE = 'openarmx_timeline_v1';

function saveSettings() {
  try {
    localStorage.setItem(_SETTINGS_STORE, JSON.stringify({
      bpm:          parseInt(document.getElementById('bpm-inp')?.value)   || bpm,
      beatsPerBar:  parseInt(document.getElementById('meter-sel')?.value) || beatsPerBar,
      totalBars:    parseInt(document.getElementById('bars-inp')?.value)  || totalBars,
      introChecked: document.getElementById('chk-intro')?.checked ?? true,
      outroChecked: document.getElementById('chk-outro')?.checked ?? true,
      introStyleId: document.getElementById('intro-style-sel')?.value || 'spread',
      stickJ7Offset,
      contactBoostMax,
    }));
  } catch(e) {}
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(_SETTINGS_STORE);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.bpm         != null) { bpm         = s.bpm;         const el = document.getElementById('bpm-inp');    if (el) el.value = bpm; }
    if (s.beatsPerBar != null) { beatsPerBar = s.beatsPerBar;  const el = document.getElementById('meter-sel'); if (el) el.value = beatsPerBar; }
    if (s.totalBars   != null) { totalBars   = s.totalBars;    const el = document.getElementById('bars-inp');  if (el) el.value = totalBars; }
    if (s.introChecked != null) { const el = document.getElementById('chk-intro'); if (el) el.checked = s.introChecked; }
    if (s.outroChecked != null) { const el = document.getElementById('chk-outro'); if (el) el.checked = s.outroChecked; }
    if (s.introStyleId != null) { const el = document.getElementById('intro-style-sel'); if (el) el.value = s.introStyleId; }
    if (s.stickJ7Offset   != null) { stickJ7Offset   = s.stickJ7Offset;   _setSliderPair('stick-j7-slider',   'stick-j7-val',   stickJ7Offset); }
    if (s.contactBoostMax != null) { contactBoostMax = s.contactBoostMax; _setSliderPair('contact-boost-slider', 'contact-boost-val', contactBoostMax); }
    updateTLInfo();
  } catch(e) {}
}
function _setSliderPair(sliderId, valId, v) {
  const sl = document.getElementById(sliderId); if (sl) sl.value = v;
  const nm = document.getElementById(valId);    if (nm) nm.value = v.toFixed(2);
}
function saveTimeline() {
  try { localStorage.setItem(_TIMELINE_STORE, JSON.stringify(timelineEvents)); } catch(e) {}
}
function loadTimeline() {
  try {
    const raw = localStorage.getItem(_TIMELINE_STORE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) timelineEvents = parsed;
  } catch(e) {}
}
// 타임라인 이벤트 변경 후 공통 처리 (render + 키프레임 재빌드 + 저장)
// ─ 드래그로 연속 채우기 중에는(매 mousemove마다 호출됨) 여기서 전체 레인을
// 다시 그리고 곡 전체 키프레임(IK)을 재계산하면 마디 수가 많을수록(이 곡은
// 118마디) 프레임마다 수백 ms가 걸려 드래그가 심하게 밀린다. 드래그 중엔
// 새로 추가된 비트 점만 가볍게 DOM에 붙이고, 무거운 재계산은 드래그가
// 끝나는 시점(mouseup)에 한 번만 몰아서 한다.
let _tlDragActive = false;
let _tlDragDirty  = false;

// 재생 중 매 프레임 드럼 플래시·사운드를 트리거할 때, 이벤트마다 drumKit.find와
// 문자열 키 생성을 반복하면 이벤트가 1000개 넘어갈 경우 프레임당 수만 번 호출돼
// CPU·GC를 크게 잡아먹는다. 이벤트·키트가 바뀔 때만 한 번 미리 계산해 재사용한다.
let _flashSchedule = [];
let _flashDirty    = true;
function _rebuildFlashSchedule() {
  const byId = {};
  drumKit.forEach(d => { byId[d.id] = d; });
  _flashSchedule = timelineEvents.map(evt => {
    const drum = byId[evt.drumId];
    if (!drum) return null;
    const ti = DRUM_TYPES[drum.type];
    return { beat: evt.beat, rebDur: ti?.rebDur || 0.1,
             key: `${evt.drumId}_${evt.beat}`, type: drum.type, drumId: evt.drumId };
  }).filter(Boolean);
  _flashDirty = false;
}

function _commitTimeline(newEvts) {
  _flashDirty = true;
  if (_tlDragActive) {
    _tlDragDirty = true;
    if (newEvts) _tlAppendHits(newEvts);
    return;
  }
  renderTimeline();
  _playKFs = buildFinalKeyframes();
  _playDur = _playKFs.totalTime;
  saveTimeline();
}

// 드래그 중 추가/변경된 비트만 가볍게 그려 넣는다(전체 레인 재빌드 없이).
// 이미 있던 점이면(반대쪽 절반 드래그로 팔이 바뀐 경우) 지우고 다시 그려
// arm-L/arm-R 스타일이 최신 상태를 반영하게 한다.
function _tlAppendHits(evts) {
  const seen = new Set();   // 같은 드럼+박자를 여러 번 처리하지 않도록(유니즌이면 evts에 2개 들어올 수 있음)
  evts.forEach(evt => {
    const beatKey = `${evt.drumId}_${evt.beat}`;
    if (seen.has(beatKey)) return;
    seen.add(beatKey);
    const lane = document.querySelector(`.tl-lane[data-drum-id="${evt.drumId}"]`);
    const drum = drumKit.find(d => d.id === evt.drumId);
    if (!lane || !drum) return;
    // 이 드럼+박자에 있던 점을 전부 지우고 현재 timelineEvents 기준으로
    // 다시 그린다 — evt.arm이 setEventArm으로 이미 바뀐 뒤라 evt 자체에서
    // "이전 팔" 키를 알 수 없으므로, 팔 없이(drumId+beat만) 찾아 지운다.
    lane.querySelectorAll(`.tl-hit[data-beat="${beatKey}"]`).forEach(el => el.remove());
    timelineEvents
      .filter(e => e.drumId === evt.drumId && Math.abs(e.beat - evt.beat) < 0.01)
      .forEach(e => lane.appendChild(_createHitEl(drum, e, drum.type !== 'kick')));
  });
}

// ═══════════════════════════════════════════════════════════════
//  타임라인 상태
// ═══════════════════════════════════════════════════════════════
let timelineEvents = [];
let bpm = 136; // MAGIC.EXE 고정 BPM
let beatsPerBar = 4;
let totalBars = 8;
let defaultVel     = 'medium'; // 타임라인 클릭 기본 velocity
// 타격점(J1~J7)은 고정 — raise 시 J7이 얼마나 더 젖혀지는지(들어올리는 높이)만 조절.
// 양수 = 더 높이 들어 강하게, 음수 = 낮게 들어 약하게. 팔별 부호(L:-/R:+)는
// computeStrikePose에서 자동 처리되므로 여기선 하나의 magnitude만 관리한다.
let stickJ7Offset  = 0;
// 타격 접촉각 보정 탐색 상한 — _solveStickStrike()가 이 값까지(0.3 간격)
// J7 후보를 시도해 드럼별로 접촉각이 가장 좋아지는 값을 자동 선택한다.
// 값을 올려도 이미 접촉각이 좋은 드럼은 그대로 두고, 필요한 드럼만 더 크게
// 보정된다 — 타격점(위치)은 IK가 계속 드럼 중심으로 재수렴하므로 안 변한다.
let contactBoostMax = 0.6;
let PX_PER_BEAT = 60; // renderTimeline()에서 동적으로 재계산

function updatePxPerBeat() {
  const el = document.getElementById('tl-scroll');
  const w  = (el?.clientWidth) || 900;
  PX_PER_BEAT = Math.max(28, Math.floor(w / (totalBars * beatsPerBar)));
}

// ═══════════════════════════════════════════════════════════════
//  오디오 상태 (Web Audio API)
// ═══════════════════════════════════════════════════════════════
let _audioCtx  = null;
let _audioBuf  = null;
let _audioSrc  = null;
let _audioStartCtxT = 0;
let _audioPlayOff   = 0;

// ═══════════════════════════════════════════════════════════════
//  중립 포즈
// ═══════════════════════════════════════════════════════════════
// 참조 프로젝트(openarmx-simulator-v2) 기준 대기 포즈
// L3=+0.1, R3=-0.1 (J3 대칭), L4=R4=0.26 (팔꿈치 자연 굴곡)
const NEUTRAL = {
  L1:0, L2:0, L3: 0.10, L4:0.26, L5:0, L6:0, L7:0,
  R1:0, R2:0, R3:-0.10, R4:0.26, R5:0, R6:0, R7:0,
  L_grip:0, R_grip:0,
};

// ═══════════════════════════════════════════════════════════════
//  역기구학 (수치 IK — TCP가 드럼 위치에 실제 도달)
// ═══════════════════════════════════════════════════════════════
const ARM_ROOT = {
  L: { x:0, y: 0.031, z:0.698 },
  R: { x:0, y:-0.031, z:0.698 },
};
const MAX_REACH = 0.82;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// 정중앙류 드럼(예: 스네어)을 왼팔·오른팔이 번갈아 칠 때 스틱이 서로
// 부딪히지 않도록, 실제 타격 목표점을 팔 쪽으로 살짝(Y축) 옮겨서 푼다.
// 드럼의 "위치"(패널 X/Y/Z, 저장·YAML 내보내기)는 이 오프셋과 무관하게
// 항상 실제 물리적 드럼 중심 그대로 유지된다 — IK가 겨냥하는 목표점만
// 내부적으로 팔마다 다르게 계산될 뿐이다.
const ARM_STRIKE_OFFSET_Y = 0.05;
function _armStrikeTargetY(drum) {
  if (drum.arm !== 'L' && drum.arm !== 'R') return drum.pos.y;   // 킥 등 팔 미배정
  return drum.pos.y + ARM_STRIKE_OFFSET_Y * (drum.arm === 'L' ? 1 : -1);
}

function reachDist(drum) {
  // kick 등 팔 미배정 드럼은 가까운 쪽 루트 기준 (표시용)
  const root = ARM_ROOT[drum.arm] ?? ARM_ROOT[drum.pos.y >= 0 ? 'L' : 'R'];
  return Math.sqrt(
    (drum.pos.x - root.x) ** 2 +
    (_armStrikeTargetY(drum) - root.y) ** 2 +
    (drum.pos.z - root.z) ** 2
  );
}

// ── 순수 수학 FK: 씬을 건드리지 않고 TCP 위치(URDF 좌표) 반환 ──
function _pureFK(jointAngles, arm) {
  const path = [
    'body', `${arm}0`,
    ...[1,2,3,4,5,6,7].map(i => `${arm}${i}`),
    `${arm}_hand`, `${arm}_tcp`,
  ];
  let mat = new THREE.Matrix4();
  for (const name of path) {
    const lk = CHAIN.find(l => l.name === name);
    if (!lk) continue;
    const [tx,ty,tz] = lk.xyz;
    const [r,p,y]    = lk.rpy;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, y, 'XYZ'));
    if (lk.type === 'revolute' && lk.joint && jointAngles[lk.joint] !== undefined) {
      const ax = new THREE.Vector3(...lk.axis).normalize();
      q.multiply(new THREE.Quaternion().setFromAxisAngle(ax, jointAngles[lk.joint]));
    }
    mat.multiply(
      new THREE.Matrix4().compose(new THREE.Vector3(tx,ty,tz), q, new THREE.Vector3(1,1,1))
    );
  }
  return new THREE.Vector3().setFromMatrixPosition(mat);
}

// ── 수치 IK: J1~J6 최적화, J7 고정 ────────────────────────────
// L·R 팔 관절 한계 (물리적 충돌 방지)
// L1 상한(구 0.2)·R1 하한(구 -0.2)은 스틱 이전 시스템에서 정한 값이라
// "팔이 몸 뒤로 젖혀지며 뻗는" 자세를 원천 차단하고 있었다 — 실제로 하이햇
// 등에서 그레이디언트가 이 벽에 눌려붙어(J1=0.19≈0.2) J2가 대신 한계까지
// 밀리는 부자연스러운 해로 이어짐. 양쪽으로 넓혀 자유탐색이 자체적으로
// "J1·J2가 함께 크게 움직이는" 더 자연스러운 분기를 찾도록 한다.
// L2>0(왼팔)·R2<0(오른팔)는 어깨가 몸통 쪽으로 접히는 방향 — 팔꿈치가
// 중앙 기둥(body)에 바짝 붙는 충돌 위험 자세로 이어진다. 부호를 팔별로
// 강제해 항상 몸통 반대쪽으로만 접히도록 한다.
//
// J2(어깨 좌우 벌림/사이드레터럴)는 위 안전 부호 안에서도 좁은 구간으로
// 고정한다 — 기존엔 드럼마다 J2가 크게(왼팔 ~53°·오른팔 ~37°) 움직여
// "날개를 폈다 접는" 관성이 큰 동작으로 보였다. 고정 구간은 사용자가
// 참고한 실제 관절값(왼팔 J2≈-0.13~-0.20)에 맞췄다 — 처음엔 -0.75~-1.05
// (하이햇 등 넓게 벌어진 값 기준)로 고정해봤으나, 사용자 참고값과 달라
// -0.13~-0.20으로 다시 좁혔다. 이 값은 원래(고정 전) 스네어의 자연스러운
// J2와 거의 같아, 스네어는 위치 변경 없이 그대로 통과하지만 하이햇·
// 크래쉬·스몰 탐·미들 탐·라이드는 이 좁은 구간에서 팁 오차·수직성·호
// 직진성이 나오도록 위치를 재조정해야 했다(드럼 키트 배열 주석 참고).
// J6은 한계(±1.57)까지 못 미쳐(최대 ~1.26) 여유가 있어 J2를 넓게 풀어줄
// 필요가 없었다(과거엔 이 여유 없이 J6이 국소해에 몰리는 문제가 있어
// 측면 드럼에 한해 J2를 넓히는 별도 분기가 있었으나, 그 분기가 오히려
// 이 좁은 구간을 덮어써 무력화시켜 제거함 — 아래 lateralY 관련 분기 삭제).
//
// J1(어깨 요)도 한쪽 방향으로 막는다 — 왼팔 J1>0("후인", 팔이 몸 뒤로
// 젖혀짐)·오른팔 J1<0은 드럼이 전부 로봇 앞쪽에 있는 배치와 맞지 않는
// 부자연스러운 자세다(사용자 실측 스크린샷으로 확인). 예전엔 이 후인
// 분기를 일부러 시드로 탐색해 수직성 점수를 높였는데, 점수만 좋을 뿐
// 시각적으로 틀린 자세였다 — 아래 J1_SEEDS를 반대(전방) 방향으로 바꿈.
// 상한만 막는 것으론 부족했다 — 반대쪽(하한 -2.0)이 너무 넓어 극단적인
// 전방 회전(-1.6 이상)에 빠져 J6이 국소해로 몰리는 별개의 문제가 있었다
// (스몰 탐·미들 탐 실측으로 확인). 하한도 -0.6 정도로 좁혀 "0 근처의
// 적당한 전방 회전"만 허용한다.
// J5(전완 롤)도 같은 이유로 한쪽만 허용한다 — 왼팔 J5<0이면 전완이
// 돌아가며 팔이 몸 안쪽으로 말려 들어온다(크래쉬 타격에서 실측 확인).
const _IK_LIMITS = {
  L1:[-0.6, 0.05], L2:[-0.20, -0.13], L3:[-0.6, 0.6],
  L4:[0.05, 1.70], L5:[-0.05, 2.9], L6:[-0.6, 0.6],
  R1:[-0.05, 0.6], R2:[0.13, 0.20], R3:[-0.6, 0.6],
  R4:[0.05, 1.70], R5:[-2.9, 0.05], R6:[-0.6, 0.6],
};

// extraLimits: { 'L1':[-2,-0.25], 'L4':[0.28,1.70] } 등 관절별 한계 오버라이드
function _solveIK(arm, targetUrdf, initAngles, j7, extraLimits) {
  const LIMITS = { ..._IK_LIMITS };
  if (extraLimits) Object.assign(LIMITS, extraLimits);

  const JK  = [1,2,3,4,5,6].map(i => `${arm}${i}`);
  const a   = { [`${arm}7`]: j7 };
  JK.forEach(k => {
    const [lo, hi] = LIMITS[k] ?? [-PI, PI];
    a[k] = clamp(initAngles[k] ?? 0, lo, hi);
  });

  const tgt = new THREE.Vector3(targetUrdf.x, targetUrdf.y, targetUrdf.z);
  const dt  = 0.004;

  for (let it = 0; it < 80; it++) {
    const cur = _pureFK(a, arm);
    const err = new THREE.Vector3().subVectors(tgt, cur);
    if (err.length() < 0.006) break;

    // 전체 그래디언트 계산 후 정규화 (스텝 안정성 확보)
    const grads = [];
    let gSq = 0;
    for (let i = 0; i < JK.length; i++) {
      const ap = { ...a }; ap[JK[i]] += dt;
      const dp = new THREE.Vector3().subVectors(_pureFK(ap, arm), cur).divideScalar(dt);
      const g  = dp.dot(err);
      grads.push(g);
      gSq += g * g;
    }
    const gNorm   = Math.sqrt(gSq) + 1e-8;
    const stepMag = Math.min(0.06, err.length() * 0.30) / gNorm;

    for (let i = 0; i < JK.length; i++) {
      const [lo, hi] = LIMITS[JK[i]] ?? [-PI, PI];
      a[JK[i]] = clamp(a[JK[i]] + grads[i] * stepMag, lo, hi);
    }
  }
  a[`${arm}7`] = j7;
  return a;
}

// ═══════════════════════════════════════════════════════════════
//  드럼채(스틱) — 그리퍼에 45° 고정, 그립점 앞 30cm 돌출
// ═══════════════════════════════════════════════════════════════
// hand 로컬 프레임: 그립점 (0,0,gripZ), 스틱 방향 = 로컬 +X·+Z 합성 45°
// dirSign=+1 → NEUTRAL(전관절 0)에서 스틱이 이미 전방-하향 45°를 향함
// (idle·인트로·아웃트로 자세를 건드릴 필요 없이 "기본자세"가 곧 정답)
const STICK = { fwd: 0.30, back: 0.10, tilt: PI / 4, gripZ: 0.08, dirSign: +1 };
const STICK_REACH = MAX_REACH + 0.16;

/** hand 링크까지의 FK 행렬 */
function _pureFKHand(jointAngles, arm) {
  const path = [
    'body', `${arm}0`,
    ...[1,2,3,4,5,6,7].map(i => `${arm}${i}`),
    `${arm}_hand`,
  ];
  let mat = new THREE.Matrix4();
  for (const name of path) {
    const lk = CHAIN.find(l => l.name === name);
    if (!lk) continue;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...lk.rpy, 'XYZ'));
    if (lk.type === 'revolute' && lk.joint && jointAngles[lk.joint] !== undefined) {
      const ax = new THREE.Vector3(...lk.axis).normalize();
      q.multiply(new THREE.Quaternion().setFromAxisAngle(ax, jointAngles[lk.joint]));
    }
    mat.multiply(
      new THREE.Matrix4().compose(new THREE.Vector3(...lk.xyz), q, new THREE.Vector3(1,1,1))
    );
  }
  return mat;
}

/** 스틱 팁·버트 월드 좌표 (URDF 프레임) */
function _pureFKStick(jointAngles, arm) {
  const handMat = _pureFKHand(jointAngles, arm);
  const sin = Math.sin(STICK.tilt), cos = Math.cos(STICK.tilt);
  const dirW = new THREE.Vector3(STICK.dirSign * sin, 0, cos).transformDirection(handMat);
  const grip = new THREE.Vector3(0, 0, STICK.gripZ).applyMatrix4(handMat);
  return {
    tip:  grip.clone().addScaledVector(dirW, STICK.fwd),
    butt: grip.clone().addScaledVector(dirW, -STICK.back),
    dir:  dirW,
  };
}

// ── 해석적 초기 추정치 (J2~J6 베이스라인 — 부드러운 함수, 후보 탐색 없음) ──
function _analyticGuess(drum, phase) {
  const s    = drum.arm;
  const root = ARM_ROOT[s];
  const rx   = drum.pos.x - root.x;
  const ry   = drum.pos.y - root.y;
  const rz_raw = drum.pos.z - root.z;
  const dist   = Math.sqrt(rx*rx + ry*ry + rz_raw*rz_raw);
  const style  = DRUM_TYPES[drum.type]?.style || 'full';

  const lateralRaw = s === 'L' ? ry : -ry;
  const fwdDist    = Math.max(rx, 0.05);
  let j1 = -(0.38 + lateralRaw * 1.85 + Math.atan2(lateralRaw, fwdDist) * 0.15);
  j1 = s === 'L' ? clamp(j1, -2.0, 0.2) : clamp(-j1, -0.2, 2.0);

  const dzSmall = { raise: +0.16, strike: 0, rebound: +0.10 };
  const rz      = rz_raw + (dzSmall[phase] || 0);
  let j2_l = -(0.14 + rz * 1.52);
  j2_l = clamp(j2_l, -1.65, 0.30);
  const j2 = s === 'L' ? j2_l : clamp(-j2_l, -0.30, 1.65);

  const j3 = s === 'L' ? 0.20 : -0.20;
  const distNorm = clamp(dist / MAX_REACH, 0, 1);
  const j4Hold   = clamp((1 - distNorm) * 2.95, 0.20, 1.40);
  const j4Delta  = { raise: +0.20, strike: -0.50, rebound: 0 }[phase] || 0;
  const j4Scale  = { big:1.15, wrist:1.00, full:1.00, none:0 }[style] ?? 1.0;
  // 심벌(big·wrist)은 팔꿈치를 더 굽혀 위에서 내려치는 자세 유도
  const j4CymbalBoost = (style === 'big' || style === 'wrist') ? 0.28 : 0;
  const j4 = clamp(j4Hold + j4Delta * j4Scale + j4CymbalBoost, 0.10, 1.65);
  const j5 = 0;
  const j6Raw = ({ wrist:{raise:.10,strike:-.08,rebound:.05},
                  big:  {raise:.12,strike:-.12,rebound:.06},
                  full: {raise:.08,strike:-.08,rebound:.04},
                  none: {raise:0,  strike:0,   rebound:0  } }[style] || {})[phase] || 0;
  // J6: 참조 프로젝트 규칙 — L ≈ -R
  const j6 = s === 'L' ? j6Raw : -j6Raw;
  const j7Raw = ({ raise:-0.86, strike:+0.18, rebound:-0.54 }[phase] || 0) *
                ({ big:1.05, wrist:1.00, full:0.88, none:0 }[style] ?? 1.0);
  const j7 = s === 'L' ? j7Raw : -j7Raw;

  const base = { L1:0,L2:0,L3:0,L4:0,L5:0,L6:0,L7:0, R1:0,R2:0,R3:0,R4:0,R5:0,R6:0,R7:0, L_grip:0,R_grip:0 };
  if (s === 'L') Object.assign(base, {L1:j1,L2:j2,L3:j3,L4:j4,L5:j5,L6:j6,L7:j7});
  else           Object.assign(base, {R1:j1,R2:j2,R3:j3,R4:j4,R5:j5,R6:j6,R7:j7});
  return base;
}

// ── 드럼 위치 → 타격 포즈 (검증된 6DOF IK + 스틱 오프셋 보정) ──
// J1~J6은 기존에 잘 동작하던 _solveIK(전체 수치 IK, 부드럽고 절제된 결과)를
// 그대로 사용하고, "손목이 아니라 스틱 팁이 드럼에 닿아야 한다"는 조건만
// 외곽 반복(tool-offset iteration)으로 보정한다:
//   1) 목표점(proxy)으로 J1~J6을 풀어 손목을 위치시킨다
//   2) 그 손목 자세에서 스틱 팁이 실제로 어디 있는지 계산한다
//   3) 팁과 드럼의 오차만큼 proxy를 이동시켜 다시 푼다 (2~3회면 수렴)
// → J7은 타격 위상(raise/strike/rebound)의 손목 스냅 값으로 고정.
//   즉 "팔은 스틱 없이 치던 자세 그대로, 스틱 길이만큼만 손목을 당겨서
//   보정"하는 모델이라 기존 시스템처럼 부드럽고 절제된 자세가 유지된다.

// 스트라이크 솔브 캐시 — 드럼 위치·강도가 같으면 재계산 없음 (빠른 박자 대응)
const _strikeSolveCache = new Map();

function _solveStickStrike(drum, vel) {
  const s     = drum.arm;
  const vs    = VEL_SCALE[vel] ?? VEL_SCALE.medium;
  const style = DRUM_TYPES[drum.type]?.style || 'full';
  const styleScale = { big:1.05, wrist:1.00, full:0.88, none:0 }[style] ?? 1.0;
  // strike 위상의 J7은 고정 타격점 — 스트로크 튜닝(stickJ7Offset)의 영향을 받지
  // 않는다(사용자 요구: 타격점은 유지, raise 높이만 조절). 캐시 키에도 넣지 않음.
  const j7Raw = 0.18 * vs.j7Strike * styleScale;
  const j7    = s === 'L' ? j7Raw : -j7Raw;

  // 캐시 키에는 IK 해에 영향을 주는 모든 입력을 포함해야 한다. id·pos 외에도
  // arm(어느 팔 조인트를 푸는지)·type(style/styleScale/isCymbal/한계)·tilt(헤드
  // 법선→접촉각 보정)가 결과를 바꾸므로 함께 넣는다. 이렇게 하면 드럼 종류·팔을
  // 바꿔도 키가 달라져 자동으로 새로 풀리므로 별도 무효화가 필요 없다.
  const effTilt = drum.tiltDeg ?? DRUM_TYPES[drum.type]?.tilt ?? 0;
  const key = [drum.id, drum.arm, drum.type, vel, effTilt, contactBoostMax,
               drum.pos.x.toFixed(3), drum.pos.y.toFixed(3), drum.pos.z.toFixed(3)].join('|');
  const hit = _strikeSolveCache.get(key);
  if (hit) return hit;

  const isCymbal = ['crash', 'ride', 'hihat'].includes(drum.type);

  // 드럼 헤드 표면 법선(스틱이 파고들어야 하는 방향의 반대) — 렌더링 코드의
  // drumHead.rotation.y = -(tiltDeg*PI/180)와 동일한 프레임/부호로 계산.
  // 탐처럼 tilt가 큰(15°) 드럼은 헤드가 로봇 쪽으로 기울어 있어, 법선을
  // 무시하고 순수 수직으로만 내려치면 스틱이 헤드에 스치듯 비스듬히 닿는다.
  // 심벌은 원래 옆면을 스치듯 치는 게 자연스러워 이 보정에서 제외한다.
  const tiltDeg    = drum.tiltDeg ?? DRUM_TYPES[drum.type]?.tilt ?? 0;
  const tiltRad    = tiltDeg * PI / 180;
  const headNormal = new THREE.Vector3(-Math.sin(tiltRad), 0, Math.cos(tiltRad));

  // 관절 한계 — J4 최소 굽힘 정도만 강제하고, J1·J2·J6은 자유롭게 둔다.
  // (J1을 특정 방향으로 강제하면 "1번은 작게, 필요한 만큼만" 요구와 충돌한다)
  const targetY = _armStrikeTargetY(drum);   // 팔별 좌우 오프셋이 반영된 실제 타격 목표 Y

  const extraLimits = {};
  if (isCymbal) {
    extraLimits[`${s}4`] = [0.28, 1.70];
  } else {
    const ar = ARM_ROOT[s];
    const dn = clamp(
      Math.sqrt((drum.pos.x-ar.x)**2 + (targetY-ar.y)**2 + (drum.pos.z-ar.z)**2) / MAX_REACH,
      0, 1);
    extraLimits[`${s}4`] = [clamp((1 - dn) * 2.5, 0.22, 1.20), 1.70];
  }
  // (구) 측면 드럼에 한해 J2를 넓게 유도하던 분기는 J2 고정 정책과
  // 충돌해 제거했다 — _IK_LIMITS.L2/R2 고정 구간 안에서도 J1·J3·J6이
  // 측면 드럼(하이햇·크래쉬·플로어탐·라이드)을 문제없이 커버한다.

  // 도구-오프셋 보정: 손목이 아니라 "손목 + 0.30m 스틱 팁"이 드럼에 닿도록
  // 목표점을 반복 이동시키며 기존 검증된 _solveIK를 재사용.
  // proxy를 오차만큼 그대로 옮기면 팔 전체 배치가 크게 바뀌어(특히 J1 방위각)
  // 스틱 방향도 같이 흔들려 발산하므로, 감쇠(0.5)를 걸고 최선의 결과를 추적한다.
  //
  // J5(전완 롤)는 스틱 팁 위치에 거의 영향을 주지 않아 위치기반 그레이디언트가
  // 0에 가깝다 → 초기값에서 거의 안 움직인다. 여러 J5 시드로 각각 풀어
  // "raise↔strike 스윙이 얼마나 수직(하늘→바닥)에 가까운가"로 채점해
  // 최선의 해를 고른다. (J1 절대값을 강제로 넓게 스윕하는 방식도 시도했으나
  // 계산이 느리고(7드럼 14초+) 관절 한계에 바짝 붙는 부자연스러운 해로
  // 이어져 폐기 — J5 시드만으로도 대부분 수직성 0.95+ 확보됨)
  const target = new THREE.Vector3(drum.pos.x, targetY, drum.pos.z);
  // J5(전완 롤) 시드는 이제 "팔이 안쪽으로 말리지 않는" 방향(왼팔 양수·
  // 오른팔 음수)만 탐색한다 — _IK_LIMITS.L5/R5가 반대 부호를 이미 막고
  // 있으므로 그 반대쪽 시드는 클램프되어 낭비였다.
  const j5Sign = s === 'L' ? 1 : -1;
  const J5_SEEDS = [0, 0.7, 1.1, 1.4, -0.3].map(v => v * j5Sign);

  // J1(어깨 요) 시드도 "전방으로 뻗는" 방향(왼팔 음수·오른팔 양수)만
  // 탐색한다 — _IK_LIMITS.L1/R1이 반대(후인) 방향을 막고 있어 그쪽 시드는
  // 이제 클램프될 뿐이다. 전방 시드로 시작해야 그 방향의 자연스러운
  // 해(팔꿈치를 굽혀 앞으로 뻗는 자세)가 탐색된다.
  // 우선 시도하고, 수직성이 이미 충분히 좋으면(>0.95) 바로 채택해 비용을 아낀다.
  const j1FwdSign = s === 'L' ? -1 : 1;
  const J1_SEEDS = [j1FwdSign * 0.4, j1FwdSign * 0.15, null];   // null = 해석적 추정치 그대로

  // raise 위상의 J7 (computeStrikePose와 동일 공식, medium velocity 기준)
  // — 후보 평가용. 관절 크기 자체엔 목표가 없다(가까운/먼 드럼 모두 필요한
  // 만큼 J1~J6을 움직여도 됨). 유일한 기준은 "J7 스윙이 하늘→바닥으로
  // 얼마나 수직에 가까운가" — 몸 안쪽으로 스치지 않는 자연스러운 타격.
  const raiseJ7Phase = (s === 'L' ? -0.86 : 0.86) * styleScale;
  const raiseJ7 = j7 + (raiseJ7Phase - j7) * 0.8;

  // raise↔strike는 J1~J6이 고정된 채 J7만 도는 단일 힌지 운동이라 스틱 끝은
  // 필연적으로 원호를 그린다. 양 끝점(raise·strike)만 수직으로 이어져 있어도
  // 그 "사이" 호가 옆으로 부풀 수 있고, 실측 결과 그 부푼 지점이 인접한
  // 심벌을 스치는 원인이었다(양 끝점만 보는 검사로는 못 잡음). 스윙 도중
  // 여러 지점을 샘플링해 strike 지점을 지나는 수직선에서 얼마나 벗어나는지
  // (수평 편차)를 측정해 채점에 반영한다 — 사후 키프레임 삽입이 아니라
  // 애초에 호 전체가 곧은 자세를 고르는 방식.
  function arcMaxHorizDev(pose, raiseJ7v, strikeJ7v, strikeTip) {
    let maxDev = 0;
    for (let i = 1; i < 8; i++) {
      const j7v = raiseJ7v + (strikeJ7v - raiseJ7v) * (i / 8);
      const tip = _pureFKStick({ ...pose, [`${s}7`]: j7v }, s).tip;
      const dev = Math.hypot(tip.x - strikeTip.x, tip.y - strikeTip.y);
      if (dev > maxDev) maxDev = dev;
    }
    return maxDev;
  }
  function poseScore(pose, raiseJ7v, strikeJ7v, withContact) {
    const strikeTip = _pureFKStick(pose, s).tip;
    const raiseTip  = _pureFKStick({ ...pose, [`${s}7`]: raiseJ7v }, s).tip;
    const swing = strikeTip.clone().sub(raiseTip);
    const swingLen = swing.length();
    const verticality = swingLen > 1e-4 ? (-swing.z / swingLen) : -1;
    const maxDev = arcMaxHorizDev(pose, raiseJ7v, strikeJ7v, strikeTip);
    const straightness = clamp(1 - maxDev / 0.08, -1, 1);
    if (!withContact) return verticality * 0.5 + straightness * 0.5;
    const contact = -_pureFKStick(pose, s).dir.dot(headNormal);
    return contact * 0.6 + verticality * 0.1 + straightness * 0.3;
  }

  let overallBest = null, overallScore = -Infinity;
  outer_seed:
  for (const j1Seed of J1_SEEDS) {
    for (const j5Seed of J5_SEEDS) {
      let proxy = { x: drum.pos.x, y: targetY, z: drum.pos.z };
      let best = null, bestErr = Infinity, init = null;
      const DAMPING = 0.5;
      // 14회로는 팔별 타격점 오프셋(ARM_STRIKE_OFFSET_Y)이 더해진 목표까지
      // 종종 0.015 문턱 바로 위에서 그치는 경우가 있어(실측 확인) 22회로
      // 늘렸다 — 각 outer 반복은 저렴하고(그레이디언트 IK 1회) 결과는
      // 드럼 위치별로 캐시되므로 비용 부담은 작다.
      for (let outer = 0; outer < 22; outer++) {
        if (!init) {
          const guess = _analyticGuess({ ...drum, pos: proxy }, 'strike');
          init = {};
          [2,3,4,6].forEach(i => { init[`${s}${i}`] = guess[`${s}${i}`]; });
          init[`${s}1`] = j1Seed ?? guess[`${s}1`];
          init[`${s}5`] = j5Seed;
        }
        const sol = _solveIK(s, proxy, init, j7,
                              Object.keys(extraLimits).length ? extraLimits : undefined);
        [1,2,3,4,5,6].forEach(i => { init[`${s}${i}`] = sol[`${s}${i}`]; });   // 다음 반복 웜스타트
        const tip = _pureFKStick(sol, s).tip;
        const err = target.clone().sub(tip);
        const errLen = err.length();
        if (errLen < bestErr) { bestErr = errLen; best = sol; }
        if (errLen < 0.004) break;
        proxy = { x: proxy.x + err.x * DAMPING, y: proxy.y + err.y * DAMPING, z: proxy.z + err.z * DAMPING };
      }
      // 0.03(3cm)까지 허용 — 팔별 타격점 오프셋(ARM_STRIKE_OFFSET_Y)을 더한
      // 목표가, 손목 과다굴곡 방지용 L6/R6 한계(±0.6, 이전 실측으로 좁혀둠)에
      // 막혀 0.015 문턱을 살짝 못 넘는 경우가 실측 확인됨(그 한계를 다시
      // 풀면 예전에 고친 "손목 과도하게 꺾임" 문제가 재발한다) — 3cm는
      // 드럼 헤드 크기 대비 시각적으로 무시할 만한 오차라 이 쪽을 완화.
      if (bestErr >= 0.03) continue;   // 이 시드는 수렴 실패 → 제외

      const score = poseScore(best, raiseJ7, j7, false);
      if (score > overallScore) { overallScore = score; overallBest = best; overallBest._err = bestErr; }
      if (overallScore > 0.9) break outer_seed;   // 충분히 좋음 — 더 찾을 필요 없음(속도)
    }
  }
  // ── 접촉각 보정 ────────────────────────────────────────────────
  // 위에서 찾은 자세(overallBest)는 위치·수직성·직진성만 기준으로 골랐기
  // 때문에, 헤드가 기울어진 드럼(탐류 15° 등)에서는 스틱이 헤드에 거의
  // 평행하게(스치듯) 닿을 수 있다. 이미 찾은 자연스러운 자세에서 "웜스타트"로
  // J7을 소폭(최대 ±0.6)만 바꿔 다시 수렴시켜, 접촉각이 실제로 개선될 때만
  // 채택한다 — 큰 배율로 J7을 바꾸면 raise/rebound 스윙이 함께 커져
  // "손목이 과하게 꺾이는" 부작용이 생기므로 이번엔 작은 폭만 시도한다.
  // (raise/rebound에도 이 델타를 그대로 더해서 스윙 폭 자체는 안 변한다 —
  // computeStrikePose 참고)
  let contactDelta = 0;
  let finalPose = overallBest;
  if (!isCymbal && overallBest) {
    const baseContact = -_pureFKStick(overallBest, s).dir.dot(headNormal);
    let bestDeltaScore = poseScore(overallBest, raiseJ7, j7, true);
    if (baseContact < 0.5) {   // 이미 충분히 수직으로 닿으면 손대지 않음
      // contactBoostMax(스트로크 튜닝 슬라이더)까지 0.3 간격으로 후보를
      // 늘려가며 시도 — 드럼마다 실제로 점수가 좋아지는 값만 채택되므로,
      // 상한을 올려도 이미 괜찮은 드럼은 그대로고 필요한 드럼만 더 커진다.
      const steps = [];
      for (let m = 0.3; m <= contactBoostMax + 1e-6; m += 0.3) steps.push(parseFloat(m.toFixed(2)));
      const DELTA_CANDIDATES = [...steps.map(m => -m), ...steps];
      for (const d of DELTA_CANDIDATES) {
        const j7Try = j7 + d;
        let proxy = { x: drum.pos.x, y: targetY, z: drum.pos.z };
        let init  = { ...overallBest };
        let cand  = overallBest, candErr = Infinity;
        for (let outer = 0; outer < 22; outer++) {
          const sol = _solveIK(s, proxy, init, j7Try,
                                Object.keys(extraLimits).length ? extraLimits : undefined);
          [1,2,3,4,5,6].forEach(i => { init[`${s}${i}`] = sol[`${s}${i}`]; });
          const tip = _pureFKStick(sol, s).tip;
          const err = target.clone().sub(tip);
          const errLen = err.length();
          if (errLen < candErr) { candErr = errLen; cand = sol; }
          if (errLen < 0.004) break;
          proxy = { x: proxy.x + err.x * 0.5, y: proxy.y + err.y * 0.5, z: proxy.z + err.z * 0.5 };
        }
        if (candErr >= 0.03) continue;   // 웜스타트로도 수렴 실패 → 제외

        const candScore = poseScore(cand, raiseJ7 + d, j7Try, true);
        if (candScore > bestDeltaScore) {
          bestDeltaScore = candScore; contactDelta = d; finalPose = cand;
        }
      }
    }
  }

  // 모든 시드가 수렴 실패한 극단적 경우에만 폴백(첫 시드 결과라도 사용)
  const solved  = finalPose ?? _analyticGuess(drum, 'strike');
  const errTip  = overallBest ? overallBest._err : 0.999;
  const result = { pose: solved, ok: errTip < 0.03, j7Strike: j7 + contactDelta, nominalJ7: j7, contactDelta };
  if (_strikeSolveCache.size > 300) _strikeSolveCache.clear();
  _strikeSolveCache.set(key, result);
  return result;
}

function computeStrikePose(drum, phase, vel = 'medium') {
  const s     = drum.arm;
  const style = DRUM_TYPES[drum.type]?.style || 'full';
  const vs    = VEL_SCALE[vel] ?? VEL_SCALE.medium;
  const styleScale = { big:1.05, wrist:1.00, full:0.88, none:0 }[style] ?? 1.0;

  const { pose: solved, j7Strike, nominalJ7, contactDelta } = _solveStickStrike(drum, vel);

  // 포즈 조립 (해당 팔만 — buildKeyframes에서 L/R 트랙 분리)
  const pose = { ...NEUTRAL };
  [1,2,3,4,5,6,7].forEach(i => { pose[`${s}${i}`] = solved[`${s}${i}`]; });

  // raise/rebound = 손목(J7) 코킹 — 팔 관절(J1~J6)은 strike와 완전히 동일
  // (타격점 고정). 코킹 폭은 velocity(vs.raiseZ/rebZ)와 스트로크 튜닝
  // (stickJ7Offset)이 함께 결정 — 둘 다 "raise 위상의 J7 기울기"에만 영향을
  // 주고 strike의 타격점(j7Strike 포함 전체 포즈)은 절대 건드리지 않는다.
  // stickJ7Offset은 baseRaw(부호 반영 전, 왼팔 기준 음수)에 직접 더해지므로
  // 왼팔은 자동으로 음수 방향, 오른팔은 부호가 뒤집혀 양수 방향으로 적용된다.
  // cockScale 0.8: 과도한 손목 스윙(팁이 1m 가까이 치솟는 현상) 억제
  // → 전환 시 스틱이 인접 드럼을 스치는 문제 해소 (실측 검증)
  //
  // 스윙 계산은 j7Strike(접촉각 보정으로 이동했을 수 있음)가 아니라
  // nominalJ7(속도·스타일로만 정해지는 원래 값)을 기준으로 한다 — 그래야
  // 접촉각 보정 폭(contactDelta)이 얼마든 raise↔strike 스윙 크기는 항상
  // 그대로다. contactDelta는 strike·raise·rebound 전부에 똑같이 더해서
  // "타격점 자체가 이동"한 효과만 내고 스윙에는 영향을 주지 않는다.
  if (phase === 'raise' || phase === 'rebound') {
    const baseRaw  = ({ raise: -0.86, rebound: -0.54 })[phase] * styleScale - stickJ7Offset;
    const j7Phase  = s === 'L' ? baseRaw : -baseRaw;
    const velScale = phase === 'raise'
      ? clamp(vs.raiseZ, 0.55, 1.35)
      : clamp(vs.rebZ,   0.50, 1.30);
    const cockScale = 0.8 * velScale;
    const nominal  = nominalJ7 ?? j7Strike;
    const delta    = contactDelta ?? 0;
    pose[`${s}7`] = nominal + (j7Phase - nominal) * cockScale + delta;
  }

  return pose;
}

// ═══════════════════════════════════════════════════════════════
//  타임라인 → 키프레임 빌드 (L·R 팔 완전 분리 트랙)
// ═══════════════════════════════════════════════════════════════
/** 프리셋 frontReadyPose → L/R 각도 객체로 분리
 *  이 포즈를 시작·끝 기준으로 사용해 팔이 드럼 앞에서 대기하도록 보장 */
function _getReadyPoses() {
  const p = (typeof INTRO_OUTRO_PRESETS !== 'undefined'
    ? (INTRO_OUTRO_PRESETS.default?.frontReadyPose) : null)
    ?? [-0.79, -0.04, 0.01, 1.54, 0, 0, -0.58, 0.79, 0.04, -0.01, 1.54, 0, 0, 0.58];
  return {
    L: { L1:p[0], L2:p[1], L3:p[2], L4:p[3], L5:p[4], L6:p[5], L7:p[6] },
    R: { R1:p[7], R2:p[8], R3:p[9], R4:p[10], R5:p[11], R6:p[12], R7:p[13] },
  };
}

const _SIDE_KEYS = { L: ['L1','L2','L3','L4','L5','L6','L7'], R: ['R1','R2','R3','R4','R5','R6','R7'] };
function _sidePick(pose, side) {
  const out = {};
  _SIDE_KEYS[side].forEach(k => { out[k] = pose[k]; });
  return out;
}

/** 해당 팔의 가장 이른 타격 이벤트(드럼·세기·beat) — 킥 제외. 이벤트 없으면 null */
function _firstArmHit(arm) {
  let best = null;
  timelineEvents.forEach(evt => {
    const rawDrum = drumKit.find(d => d.id === evt.drumId);
    if (!rawDrum || rawDrum.type === 'kick') return;
    const effArm = evt.arm ?? rawDrum.arm;
    if (effArm !== arm) return;
    const drum = effArm === rawDrum.arm ? rawDrum : { ...rawDrum, arm: effArm };
    if (!best || evt.beat < best.evt.beat) best = { evt, drum };
  });
  return best ? { drum: best.drum, vel: best.evt.vel ?? 'medium', beat: best.evt.beat } : null;
}

function buildKeyframes() {
  const beatDur    = 60 / bpm;
  const totalBeats = totalBars * beatsPerBar;
  const totalTime  = parseFloat((totalBeats * beatDur).toFixed(3));
  const preDur     = parseFloat(Math.max(0.12, Math.min(0.32, beatDur * 0.38)).toFixed(3));

  const L_KEYS = ['L1','L2','L3','L4','L5','L6','L7'];
  const R_KEYS = ['R1','R2','R3','R4','R5','R6','R7'];

  const { L: READY_L, R: READY_R } = _getReadyPoses();

  // 대기(휴식) 자세 — 예전엔 여기서 preLift(READY + J4 +0.58, 최대 1.70까지
  // 팔꿈치를 더 들어올린 자세)를 썼는데, 그러면 타격이 한동안 없는 구간(곡
  // 시작부 대기·긴 공백)에서 팔꿈치가 거의 한계까지 굽어 있어 몸통(바디)에
  // 부딪히고 움직임 폭도 커 보인다는 피드백 — 인트로가 끝난 자세(frontReady,
  // READY_L/READY_R)를 그대로 대기 자세로 쓴다.
  const preLift = { L: READY_L, R: READY_R };

  // 첫 타격 전 대기 시간이 길면 대기 자세를 계속 유지하다가, 타격 사이
  // 회수와 같은 자연스러운 속도(preDur)로만 드럼 쪽으로 움직이기 시작
  // — 그 전엔 preLift로 홀드하는 키프레임을 하나 추가한다(안 넣으면
  // 대기 시작 시점부터 raise 시점까지 단 2개 점 사이를 계속 서서히
  // 움직이는 것처럼 보간되어, 빈 시간 내내 팔이 조금씩 계속 움직이는
  // 것처럼 보이는 문제가 있었음). 예전엔 1초로 더 길게 잡았었는데, 이미
  // 타격해야 할 동작이라 회수 때처럼 짧고 결단력 있게 움직이는 편이
  // 자연스러워 preDur로 통일했다.
  const APPROACH_DUR = preDur;

  // 왼팔·오른팔 키프레임 트랙 완전 분리
  const L_poseMap = new Map();
  const R_poseMap = new Map();

  // 시작 포즈를 대기 자세로 설정 (인트로 종료 포즈와 연속성 유지)
  L_poseMap.set('0.000', { ...preLift.L });
  R_poseMap.set('0.000', { ...preLift.R });

  // 팔별 이벤트를 시간순 정렬 — rebound/raise 겹침 감지에 필요
  // evt.arm이 있으면(팔 오버라이드) 드럼의 원래 팔 대신 그 팔로 그룹핑한다.
  const armEvts = { L: [], R: [] };
  timelineEvents.forEach(evt => {
    const rawDrum = drumKit.find(d => d.id === evt.drumId);
    if (!rawDrum || rawDrum.type === 'kick') return;
    const effArm = evt.arm ?? rawDrum.arm;
    const drum   = effArm === rawDrum.arm ? rawDrum : { ...rawDrum, arm: effArm };
    const t = parseFloat(((evt.beat - 1) * beatDur).toFixed(3));
    armEvts[effArm].push({ drum, t, vel: evt.vel ?? 'medium' });
  });
  armEvts.L.sort((a, b) => a.t - b.t);
  armEvts.R.sort((a, b) => a.t - b.t);

  function addPose(poseMap, time, pose, sideKeys, isStrike = false) {
    const key = time.toFixed(3);
    if (!poseMap.has(key)) poseMap.set(key, {});
    const cur = poseMap.get(key);
    sideKeys.forEach(k => { cur[k] = pose[k]; });
    if (isStrike) cur._isStrike = true;
  }

  // 대기 시간이 긴 구간(첫 타격 전·타격 사이 모두)에서 팔이 완전히 멈춰
  // 있는 것처럼 보이지 않도록, startT~endT 구간에 숨쉬듯 완만하게
  // 오르내리는 키프레임을 채워 넣는다(BREATH_AMP·BREATH_HALF은 인트로
  // tail의 숨쉬기 효과보다 느리고 큰 폭 — 이 구간이 훨씬 길기 때문).
  // endT 근처(약 0.7주기)는 다음 접근(raise) 전 자연스러운 정지를 위해
  // 채우지 않는다.
  const BREATH_AMP  = 0.05;
  const BREATH_HALF = 0.9;
  function addBreathingHold(poseMap, basePose, startT, endT, sideKeys) {
    let t = parseFloat((startT + BREATH_HALF).toFixed(3)), up = true;
    while (t < endT - BREATH_HALF * 0.7) {
      addPose(poseMap, t, _breathePose(basePose, up ? BREATH_AMP : -BREATH_AMP), sideKeys);
      up = !up;
      t = parseFloat((t + BREATH_HALF).toFixed(3));
    }
  }

  ['L', 'R'].forEach(arm => {
    const poseMap  = arm === 'L' ? L_poseMap : R_poseMap;
    const sideKeys = arm === 'L' ? L_KEYS    : R_KEYS;

    armEvts[arm].forEach(({ drum, t, vel }, idx) => {
      const typeInfo = DRUM_TYPES[drum.type];
      const hasPrev  = idx > 0;  // 이전 타격이 있으면 raise 생략 → via-point가 대체
      const raiseT   = parseFloat(Math.max(0.001, t - preDur).toFixed(3));
      const reboundT = parseFloat((t + typeInfo.rebDur).toFixed(3));

      const next = armEvts[arm][idx + 1];

      // 다음 타격이 있으면 rebound 생략 — rebound가 현재 드럼 바로 위로 팔을 들어
      // strike → rebound → via-point 순서가 되면 ㄷ자 경로가 됨.
      // via-point가 두 드럼 사이 최고점 역할을 대신하므로 rebound 불필요.
      // 마지막 타격에만 rebound 포함(자연스러운 잔향 표현).
      const includeRebound = !next;

      if (!hasPrev) {
        const holdT = parseFloat(Math.max(0, raiseT - APPROACH_DUR).toFixed(3));
        if (holdT > 0.001) {
          addBreathingHold(poseMap, preLift[arm], 0, holdT, sideKeys);
          addPose(poseMap, holdT, preLift[arm], sideKeys);
        }
        addPose(poseMap, raiseT, computeStrikePose(drum, 'raise', vel), sideKeys);
      }
      addPose(poseMap, t, computeStrikePose(drum, 'strike', vel), sideKeys, true);
      if (includeRebound) {
        addPose(poseMap, reboundT, computeStrikePose(drum, 'rebound', vel), sideKeys);
      }

      // ── via-point: raise(A)와 raise(B) 중간에서 J4 최고점 ──
      // raise(A)를 기준으로 삼아야 히햇 등 심벌을 스치지 않고 충분히 들어올린 뒤 넘어감
      // (strike_A 기준 시 via-point Z가 너무 낮아 심벌 표면을 비비는 경로가 생김)
      if (next) {
        // 타격 직후 회수(peak까지 올라가는 구간)를 항상 두 타격의 정중앙
        // 시점에 맞추면, 간격이 넓을 때(느긋한 타격) 회수 자체가 통째로
        // 느려져 "붕 뜬" 느낌이 난다 — 원래는 간격이 좁을 때(빠른 연타)만
        // 자연스러웠던 속도. preDur(raise 구간과 동일한 자연스러운 회수
        // 속도)를 상한으로 써서, 간격이 넉넉하면 회수는 항상 비슷한
        // 속도로 빠르게 끝내고 나머지 시간은 peak 자세로 대기(숨쉬기)한다.
        // 간격이 좁으면(빠르게 다음 타격까지 가야 함) 기존처럼 정중앙에서
        // 만나는 것으로 자동 축소된다.
        const gap   = next.t - t;
        const peakT = parseFloat((t + Math.min(preDur, gap / 2)).toFixed(3));
        const posA  = computeStrikePose(drum,      'raise', vel);
        const posB  = computeStrikePose(next.drum, 'raise', next.vel ?? 'medium');
        const peak  = {};
        sideKeys.forEach(k => {
          const a = posA[k] ?? 0;
          const b = posB[k] ?? 0;
          let v = (a + b) / 2;
          if (k.endsWith('4')) v = clamp(v + 0.45, 0.10, 1.70);
          peak[k] = v;
        });

        // 중심선 안전 여유: 피크(팔꿈치를 굽혀 드럼 사이를 넘어가는 구간)에서
        // 팁이 몸 중심선(Y=0)에 너무 가까워지면 반대팔과 부딪힐 수 있다
        // (실측: 양팔이 동시에 피크를 지나며 5~6cm까지 근접). 정밀 타격점이
        // 아니라 통과 지점이므로 위치 오차는 문제없어, J3(가장 큰 레버리지)를
        // 살짝 움직여 자기 팔 쪽으로 밀어낸다. 방향은 하드코딩하지 않고
        // 매번 작게 찔러봐서(probe) 실제로 안전 방향인 쪽으로만 이동한다.
        const MIN_PEAK_Y = 0.12;
        const wantSign   = arm === 'L' ? 1 : -1;
        const j3Key      = `${arm}3`;
        const [j3Lo, j3Hi] = _IK_LIMITS[j3Key] ?? [-PI, PI];
        let peakFK = _pureFKStick(peak, arm);
        if (peakFK.tip.y * wantSign < MIN_PEAK_Y) {
          const probeStep = 0.02;
          const probeV = clamp(peak[j3Key] + probeStep, j3Lo, j3Hi);
          const probeFK = _pureFKStick({ ...peak, [j3Key]: probeV }, arm);
          const dir = Math.sign((probeFK.tip.y - peakFK.tip.y) * wantSign) || 1;
          for (let iter = 0; iter < 40; iter++) {
            const nextV = clamp(peak[j3Key] + dir * probeStep, j3Lo, j3Hi);
            if (nextV === peak[j3Key]) break;   // 관절 한계 도달
            peak[j3Key] = nextV;
            peakFK = _pureFKStick(peak, arm);
            if (peakFK.tip.y * wantSign >= MIN_PEAK_Y) break;
          }
        }

        // 간격이 넉넉하면(빠른 연타가 아니면) 대부분을 "중립/준비 자세"로 대기
        // 하다가 타격 직전에만 다음 드럼 쪽으로 스냅해 들어가고, 간격이 좁으면
        // (빠른 연타) 기존처럼 peak(평균 경유 자세)로 쭉 이어서 자연스러운
        // 흐름을 유지한다 — 사용자 피드백: 간격이 넉넉할 때 peak로 대기하면
        // 쉬는 동안 계속 다음 타격 쪽으로 팔이 넘어가는 것처럼 보여 어색했음
        // (빠르게 스냅하는 하이햇 연타와 대비돼 유독 느릿해 보임).
        const IDLE_GAP_THRESHOLD = preDur * 3;
        const useNeutralHold = gap > IDLE_GAP_THRESHOLD;

        addPose(poseMap, peakT, useNeutralHold ? preLift[arm] : peak, sideKeys);

        // 피크 이후 다음 타격 직전까지 남는 시간 안에서 raise(B)를 한 번 더 찍는다.
        // 이렇게 하면 다른 드럼으로 넘어갈 때도 마지막 진입 구간만큼은 J1~J6 고정 +
        // J7만 움직이는 손목 스냅이 되어 수직으로 내려친다(연타 시의 raise→strike와 동일 원리).
        // 이게 없으면 피크(중간 평균 자세)에서 곧장 strike(B)로 가며 여러 조인트가
        // 동시에 움직여 "비스듬히 빗겨치는" 느낌이 난다.
        const availGap  = next.t - peakT;
        const raiseLead = Math.min(preDur, availGap * 0.7);
        const raiseBT   = parseFloat((next.t - raiseLead).toFixed(3));

        if (useNeutralHold) {
          // 중립 자세로 대기하다가, 타격 직전 짧게 peak(팔꿈치 리프트 +
          // 중심선 안전 여유가 적용된 경유 자세)를 거쳐 raise(B)로 스냅한다.
          // 스냅 구간을 preDur의 절반 정도로 짧게 잡아야 catmull-rom 보간이
          // (다음 키프레임의 큰 변화를 미리 반영해) 중립 홀드 구간까지 앞당겨
          // 서서히 움직이기 시작하는 것을 최소화한다 — 너무 넓게 잡으면
          // 스냅 시작 훨씬 전부터 이미 다음 타격 쪽으로 미세하게 새기 시작한다.
          const snapT = parseFloat(Math.max(peakT, raiseBT - preDur * 0.4).toFixed(3));
          // addBreathingHold는 홀드 구간이 BREATH_HALF(0.9초)보다 짧으면 점을
          // 하나도 안 찍는다 — 그러면 홀드 구간에 점이 peakT 하나뿐이라
          // catmull-rom이 앞뒤(타격 자세·peak 자세)의 큰 변화를 반영해 접선을
          // 기울여서, 홀드 구간 내내 서서히 움직이는 것처럼 보인다(실측 확인).
          // 홀드 구간 중간에 같은 자세를 한 번 더 찍어 접선을 평평하게 고정한다.
          if (snapT > peakT) {
            const midT = parseFloat(((peakT + snapT) / 2).toFixed(3));
            if (midT > peakT && midT < snapT) addPose(poseMap, midT, preLift[arm], sideKeys);
            addBreathingHold(poseMap, preLift[arm], peakT, snapT, sideKeys);
            addPose(poseMap, snapT, peak, sideKeys);
          }
        } else {
          // peak 도달 후 다음 접근(raiseBT) 전까지 여유가 남으면 그 사이는
          // peak 자세로 숨쉬듯 대기 — 안 넣으면 peak와 raiseB 두 점만으로
          // 보간되어 그 구간 내내 서서히 움직이는 것처럼 보인다.
          if (raiseBT > peakT) addBreathingHold(poseMap, peak, peakT, raiseBT, sideKeys);
        }

        if (raiseLead > 0.03 && raiseBT > peakT) {
          addPose(poseMap, raiseBT, posB, sideKeys);
        }
      }
    });
  });

  L_poseMap.set(totalTime.toFixed(3), { ...READY_L });
  R_poseMap.set(totalTime.toFixed(3), { ...READY_R });

  const toArray = (map) =>
    Array.from(map.entries())
      .map(([t, v]) => {
        const { _isStrike, ...angles } = v;
        return { time: parseFloat(t), angles, isStrike: !!_isStrike };
      })
      .sort((a, b) => a.time - b.time);

  return { L: toArray(L_poseMap), R: toArray(R_poseMap), totalTime };
}

// ═══════════════════════════════════════════════════════════════
//  YAML 내보내기
// ═══════════════════════════════════════════════════════════════
// ── 관절 최대 속도·가속도 (OpenArmX 안전 기준값) ─────────────
const _JOINT_MAX_VEL = {
  L1:1.5, L2:1.5, L3:2.0, L4:2.0, L5:2.5, L6:2.5, L7:2.5,
  R1:1.5, R2:1.5, R3:2.0, R4:2.0, R5:2.5, R6:2.5, R7:2.5,
};
const _JOINT_MAX_ACC = {
  L1:3.0, L2:3.0, L3:4.0, L4:4.0, L5:5.0, L6:5.0, L7:5.0,
  R1:3.0, R2:3.0, R3:4.0, R4:4.0, R5:5.0, R6:5.0, R7:5.0,
};

function computeVelAccel(kfs) {
  const n    = kfs.length;
  const keys = ['L1','L2','L3','L4','L5','L6','L7','R1','R2','R3','R4','R5','R6','R7'];
  const vel  = Array.from({ length: n }, () => ({}));
  const acc  = Array.from({ length: n }, () => ({}));

  keys.forEach(k => {
    const maxV = _JOINT_MAX_VEL[k] ?? 2.0;
    const maxA = _JOINT_MAX_ACC[k] ?? 4.0;

    // 시작·끝: 정지 상태 (velocity = 0)
    vel[0][k] = 0; vel[n-1][k] = 0;
    acc[0][k] = 0; acc[n-1][k] = 0;

    // 중간: 중앙 차분 (central difference)
    for (let i = 1; i < n - 1; i++) {
      const dt = kfs[i+1].time - kfs[i-1].time;
      vel[i][k] = dt > 0
        ? clamp((kfs[i+1].angles[k] - kfs[i-1].angles[k]) / dt, -maxV, maxV)
        : 0;
    }
    // 가속도: velocity의 중앙 차분
    for (let i = 1; i < n - 1; i++) {
      const dt = kfs[i+1].time - kfs[i-1].time;
      acc[i][k] = dt > 0
        ? clamp((vel[i+1][k] - vel[i-1][k]) / dt, -maxA, maxA)
        : 0;
    }
  });
  return { vel, acc };
}

window.exportYAML = function () {
  const kfs = buildFinalFlatTimeline();   // 인트로/아웃트로 포함 최종 타임라인
  if (kfs.length <= 1) { alert('타임라인에 드럼 이벤트를 추가하세요.'); return; }

  const { vel, acc } = computeVelAccel(kfs);

  const jointNames = [
    'openarmx_left_joint1','openarmx_left_joint2','openarmx_left_joint3','openarmx_left_joint4',
    'openarmx_left_joint5','openarmx_left_joint6','openarmx_left_joint7',
    'openarmx_right_joint1','openarmx_right_joint2','openarmx_right_joint3','openarmx_right_joint4',
    'openarmx_right_joint5','openarmx_right_joint6','openarmx_right_joint7',
  ];
  const shortKeys = ['L1','L2','L3','L4','L5','L6','L7','R1','R2','R3','R4','R5','R6','R7'];

  // 드럼 이벤트 (velocity 포함)
  let yaml = 'drum_events:\n';
  [...timelineEvents]
    .sort((a, b) => a.beat - b.beat)
    .forEach(e => {
      const d = drumKit.find(d => d.id === e.drumId);
      if (!d) return;
      yaml += `- {drum: ${d.type}, name: "${d.name}", beat: ${e.beat.toFixed(3)}, vel: ${e.vel ?? 'medium'}}\n`;
    });
  yaml += '\njoint_names:\n';
  jointNames.forEach(n => { yaml += `- ${n}\n`; });
  yaml += 'points:\n';

  kfs.forEach((kf, i) => {
    yaml += '- positions:\n';
    shortKeys.forEach(k => {
      yaml += `  - ${parseFloat((kf.angles[k] ?? 0).toFixed(4))}\n`;
    });
    yaml += '  velocities:\n';
    shortKeys.forEach(k => {
      yaml += `  - ${parseFloat((vel[i][k] ?? 0).toFixed(4))}\n`;
    });
    yaml += '  accelerations:\n';
    shortKeys.forEach(k => {
      yaml += `  - ${parseFloat((acc[i][k] ?? 0).toFixed(4))}\n`;
    });
    yaml += `  time_from_start: ${kf.time.toFixed(3)}\n`;
  });

  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
  const a  = document.createElement('a');
  a.href     = 'data:text/yaml;charset=utf-8,' + encodeURIComponent(yaml);
  a.download = `drum_${ts}.yaml`;
  a.click();
  setStatus(`YAML 저장 완료 — ${kfs.length}개 포인트 (positions·velocities·accelerations)`);
};

// ═══════════════════════════════════════════════════════════════
//  프로젝트 저장/불러오기 (JSON) — 드럼 키트 위치·타격 팔·타임라인 비트를
//  그대로 파일로 내보냈다가 나중에(또는 다른 브라우저에서) 복원한다.
//  "YAML 내보내기"는 ROS2용 최종 관절 궤적이라 드럼 위치 정보가 없어서
//  별도로 둔다 — 이쪽이 실제 "프로젝트 소스"에 가깝다.
// ═══════════════════════════════════════════════════════════════
window.exportProject = function () {
  const data = {
    version: 1,
    savedAt: new Date().toISOString(),
    drumKit: drumKit.map(d => ({ id: d.id, name: d.name, type: d.type, arm: d.arm, pos: { x: d.pos.x, y: d.pos.y, z: d.pos.z } })),
    timelineEvents: timelineEvents.map(e => ({ drumId: e.drumId, beat: e.beat, vel: e.vel ?? 'medium', arm: e.arm })),
    settings: {
      bpm, beatsPerBar, totalBars,
      introChecked: document.getElementById('chk-intro')?.checked ?? true,
      outroChecked: document.getElementById('chk-outro')?.checked ?? true,
      introStyleId: document.getElementById('intro-style-sel')?.value || 'spread',
      stickJ7Offset, contactBoostMax,
    },
  };
  const json = JSON.stringify(data, null, 2);
  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
  const a  = document.createElement('a');
  a.href     = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
  a.download = `magicexe_project_${ts}.json`;
  a.click();
  setStatus(`프로젝트 저장 완료 — 드럼 ${drumKit.length}개 · 비트 ${timelineEvents.length}개`);
};

window.importProject = function (input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.drumKit) || !data.drumKit.length) {
        throw new Error('drumKit 데이터가 없습니다');
      }

      drumKit = data.drumKit.map(d => ({
        id: d.id, name: d.name, type: d.type, arm: d.arm,
        pos: { x: +d.pos.x, y: +d.pos.y, z: +d.pos.z },
      }));
      nextDrumId = Math.max(
        DEFAULT_DRUM_KIT.length,
        ...drumKit.map(d => (parseInt(String(d.id).replace(/\D/g, ''), 10) || 0) + 1)
      );

      if (Array.isArray(data.timelineEvents)) {
        timelineEvents = data.timelineEvents.map(ev => ({
          drumId: ev.drumId,
          beat: +ev.beat,
          vel: ev.vel ?? 'medium',
          ...((ev.arm === 'L' || ev.arm === 'R') ? { arm: ev.arm } : {}),
        }));
      }

      const s = data.settings;
      if (s) {
        if (s.bpm != null) { bpm = s.bpm; const el = document.getElementById('bpm-inp'); if (el) el.value = bpm; }
        if (s.beatsPerBar != null) { beatsPerBar = s.beatsPerBar; const el = document.getElementById('meter-sel'); if (el) el.value = beatsPerBar; }
        if (s.totalBars != null) { totalBars = s.totalBars; const el = document.getElementById('bars-inp'); if (el) el.value = totalBars; }
        if (s.introChecked != null) { const el = document.getElementById('chk-intro'); if (el) el.checked = s.introChecked; }
        if (s.outroChecked != null) { const el = document.getElementById('chk-outro'); if (el) el.checked = s.outroChecked; }
        if (s.introStyleId != null) { const el = document.getElementById('intro-style-sel'); if (el) el.value = s.introStyleId; }
        if (s.stickJ7Offset != null) { stickJ7Offset = s.stickJ7Offset; _setSliderPair('stick-j7-slider', 'stick-j7-val', stickJ7Offset); }
        if (s.contactBoostMax != null) { contactBoostMax = s.contactBoostMax; _setSliderPair('contact-boost-slider', 'contact-boost-val', contactBoostMax); }
      }

      saveDrumKit();
      saveTimeline();
      saveSettings();
      rebuildDrumSpheres();
      renderDrumList();
      renderPresetDropdown();
      renderTimeline();
      updateTLInfo();
      _playKFs = buildFinalKeyframes();
      _playDur = _playKFs.totalTime;
      const scrubEl = document.getElementById('scrubber');
      if (scrubEl) scrubEl.max = _playDur;

      setStatus(`프로젝트 불러오기 완료 — 드럼 ${drumKit.length}개 · 비트 ${timelineEvents.length}개`);
    } catch (err) {
      setStatus('프로젝트 불러오기 실패: ' + err.message);
    }
  };
  reader.readAsText(file);
  input.value = '';
};

// ═══════════════════════════════════════════════════════════════
//  비트 오디오 내보내기 (WAV — OfflineAudioContext 렌더링)
// ═══════════════════════════════════════════════════════════════

/** AudioBuffer → 16-bit PCM WAV Blob */
function _audioBufferToWav(buffer) {
  const numCh   = buffer.numberOfChannels;
  const sr      = buffer.sampleRate;
  const len     = buffer.length;
  const bps     = 2; // 16-bit
  const dataLen = len * numCh * bps;
  const ab      = new ArrayBuffer(44 + dataLen);
  const v       = new DataView(ab);
  const s       = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  s(0,'RIFF'); v.setUint32(4, 36 + dataLen, true); s(8,'WAVE');
  s(12,'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * numCh * bps, true); v.setUint16(32, numCh * bps, true);
  v.setUint16(34, 16, true); s(36,'data'); v.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s16 = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i])) * 0x7FFF;
      v.setInt16(off, s16, true); off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

window.exportAudio = async function () {
  if (!timelineEvents.length) { alert('타임라인에 드럼 이벤트를 추가하세요.'); return; }

  // 체크박스 상태에 따라 항상 최신 길이 계산 (재생 없이도 동작)
  const latestKFs = buildFinalKeyframes();
  const totalDur  = latestKFs.totalTime || 0;
  if (totalDur <= 0) { alert('타임라인에 드럼 이벤트를 추가하세요.'); return; }

  setStatus('🎵 오디오 렌더링 중... (잠시 대기)');
  await new Promise(r => setTimeout(r, 30)); // UI 업데이트 대기

  try {
    const SR   = 44100;
    const ctx  = new OfflineAudioContext(2, Math.ceil(totalDur * SR), SR);
    const bus  = _makeDrumBus(ctx);
    const bd   = 60 / bpm;
    const iOff = _getAudioTimeOffset(); // 인트로 오프셋

    // ── 드럼 합성음 스케줄 ─────────────────────────────────────
    timelineEvents.forEach(evt => {
      const drum = drumKit.find(d => d.id === evt.drumId);
      if (!drum) return;
      const hitT = (evt.beat - 1) * bd + iOff;
      if (hitT < 0 || hitT >= totalDur) return;
      const fn = _drumSounds[drum.type] || _drumSounds.tom_m;
      fn(hitT, ctx, undefined, bus);
    });

    // ── 배경 음악 믹스 (로드된 경우) ──────────────────────────
    if (_audioBuf) {
      const src = ctx.createBufferSource();
      src.buffer = _audioBuf;
      // 볼륨 살짝 낮춰서 드럼과 밸런스
      const gain = ctx.createGain(); gain.gain.value = 0.80;
      src.connect(gain); gain.connect(ctx.destination);
      const startAt  = Math.max(0, iOff);
      const audioPos = Math.max(0, 0); // 음악 파일 시작 위치
      src.start(startAt, audioPos);
    }

    const rendered = await ctx.startRendering();
    const wav      = _audioBufferToWav(rendered);
    const ts       = new Date().toISOString().replace(/[-:T.]/g,'').slice(0,15);
    const a        = document.createElement('a');
    a.href         = URL.createObjectURL(wav);
    a.download     = `drum_beat_${ts}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);

    setStatus(`🎵 오디오 내보내기 완료 — ${totalDur.toFixed(1)}s WAV`);
  } catch (e) {
    setStatus('오디오 렌더링 실패: ' + e.message);
  }
};

// ═══════════════════════════════════════════════════════════════
//  검증
// ═══════════════════════════════════════════════════════════════
window.validatePattern = function () {
  const results  = [];
  const beatDur  = 60 / bpm;

  results.push({ lv:'info', msg:`BPM ${bpm} · ${totalBars}마디 · ${beatsPerBar}/4박자` });
  results.push({ lv:'info', msg:`타임라인 이벤트 ${timelineEvents.length}개` });

  drumKit.forEach(d => {
    if (d.type === 'kick') { results.push({ lv:'info', msg:`[${d.name}] 킥 — 확장 이벤트 (팔 동작 없음)` }); return; }
    const dist = reachDist(d);
    if      (dist > STICK_REACH)      results.push({ lv:'err',  msg:`[${d.name}] 도달 불가 (${dist.toFixed(2)}m > ${STICK_REACH}m)` });
    else if (dist > STICK_REACH * 0.88) results.push({ lv:'warn', msg:`[${d.name}] 한계 근접 (${dist.toFixed(2)}m)` });
    else                              results.push({ lv:'ok',   msg:`[${d.name}] 도달 가능 (${dist.toFixed(2)}m)` });
  });

  if (!drumKit.some(d => d.arm === 'L' && d.type !== 'kick'))
    results.push({ lv:'warn', msg:'왼팔에 드럼이 없습니다.' });
  if (!drumKit.some(d => d.arm === 'R' && d.type !== 'kick'))
    results.push({ lv:'warn', msg:'오른팔에 드럼이 없습니다.' });

  // 팔별 이벤트 목록 (시간순) — evt.arm 오버라이드 반영
  const armEvts = { L:[], R:[] };
  timelineEvents.forEach(evt => {
    const rawDrum = drumKit.find(d => d.id === evt.drumId);
    if (!rawDrum || rawDrum.type === 'kick') return;
    const effArm = evt.arm ?? rawDrum.arm;
    const drum   = effArm === rawDrum.arm ? rawDrum : { ...rawDrum, arm: effArm };
    armEvts[effArm].push({ t: (evt.beat - 1) * beatDur, drum });
  });
  ['L','R'].forEach(arm => {
    const evts     = armEvts[arm].sort((a, b) => a.t - b.t);
    const otherArm = arm === 'L' ? 'R' : 'L';
    const armKr    = arm === 'L' ? '왼팔' : '오른팔';
    const otherKr  = arm === 'L' ? '오른팔' : '왼팔';

    for (let i = 1; i < evts.length; i++) {
      const gap = evts[i].t - evts[i - 1].t;
      if (gap < 0.055) {
        // 반대팔로 두 번째 드럼을 칠 수 있는지 체크
        const d2       = evts[i].drum;
        const distAlt  = reachDist({ ...d2, arm: otherArm });
        const canAlt   = distAlt <= STICK_REACH;
        // 해당 타이밍에 반대팔이 이미 쓰이는지
        const beatSec  = evts[i].t;
        const otherBusy = armEvts[otherArm].some(e => Math.abs(e.t - beatSec) < 0.01);
        const altHint  = canAlt && !otherBusy
          ? ` → [${d2.name}]을 ${otherKr}으로 변경하면 해결 가능 (${distAlt.toFixed(2)}m)`
          : canAlt && otherBusy
            ? ` (${otherKr}도 해당 타이밍에 사용 중)`
            : ` (${otherKr}도 도달 불가 ${distAlt.toFixed(2)}m)`;
        results.push({ lv:'err',
          msg:`${armKr} 연속 타격 간격 너무 짧음 (${(gap*1000).toFixed(0)}ms)${altHint}` });
      } else if (gap < 0.12) {
        results.push({ lv:'warn',
          msg:`${armKr} 고속 타격 (${(gap*1000).toFixed(0)}ms) — 확인 필요` });
      }
    }
  });

  if (bpm > 180) results.push({ lv:'warn', msg:`BPM ${bpm}: 고속 연주 — 로봇 구동 한계를 확인하세요.` });

  const kfs       = buildFinalFlatTimeline();   // 인트로/아웃트로 포함
  const shortKeys = ['L1','L2','L3','L4','L5','L6','L7','R1','R2','R3','R4','R5','R6','R7'];
  let yamlOk = true;
  kfs.forEach(kf => { shortKeys.forEach(k => { if (!isFinite(kf.angles[k])) yamlOk = false; }); });
  results.push(yamlOk
    ? { lv:'ok',  msg:`최종 YAML: ${kfs.length}개 포인트 (positions + velocities + accelerations) ✓` }
    : { lv:'err', msg:'YAML에 유효하지 않은 값이 있습니다.' }
  );

  // ── 키프레임 밀도 체크 ──────────────────────────────────────
  // ROS2 컨트롤러 처리 가능 최소 간격 기준
  let densityErrCnt = 0, densityWarnCnt = 0;
  for (let i = 1; i < kfs.length; i++) {
    const gap = kfs[i].time - kfs[i-1].time;
    const ms  = (gap * 1000).toFixed(0);
    if (gap < 0.025) {
      densityErrCnt++;
      results.push({ lv:'err',  msg:`키프레임 간격 ${ms}ms (t=${kfs[i].time.toFixed(3)}s) — 컨트롤러 처리 불가 (최소 25ms)` });
    } else if (gap < 0.055) {
      densityWarnCnt++;
      if (densityWarnCnt <= 3)  // 경고 최대 3개만 표시
        results.push({ lv:'warn', msg:`키프레임 간격 ${ms}ms (t=${kfs[i].time.toFixed(3)}s) — 고속 구간, 확인 권장` });
    }
  }
  if (densityWarnCnt > 3)
    results.push({ lv:'warn', msg:`외 ${densityWarnCnt - 3}개 고속 구간 더 있음` });
  if (densityErrCnt === 0 && densityWarnCnt === 0)
    results.push({ lv:'ok', msg:'모든 키프레임 간격 정상 (≥ 55ms)' });

  const iconMap = { ok:'✓', warn:'⚠', err:'✗', info:'ℹ' };
  document.getElementById('validation-content').innerHTML =
    results.map(r => `<div class="val-${r.lv}">${iconMap[r.lv]} ${r.msg}</div>`).join('');
  document.getElementById('validation-modal').style.display = 'flex';
};

window.closeValidation = function () {
  document.getElementById('validation-modal').style.display = 'none';
};

// ═══════════════════════════════════════════════════════════════
//  Three.js — 로봇 키네마틱 체인
// ═══════════════════════════════════════════════════════════════
const CHAIN = [
  { name:'body', parent:null, type:'fixed', xyz:[0,0,0], rpy:[0,0,0], axis:null, joint:null,
    mesh:{file:'body/v10/collision/body_link0_symp.stl', scale:[0.001,0.001,0.001], offset:[0,0,0]} },
  { name:'L0', parent:'body', type:'fixed',    xyz:[0,0.031,0.698],    rpy:[-PI/2,0,0], axis:null,    joint:null,
    mesh:{file:'arm/v10/visual/link0.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L1', parent:'L0',   type:'revolute', xyz:[0,0,0.058],        rpy:[0,0,0],     axis:[0,0,1],  joint:'L1',
    mesh:{file:'arm/v10/visual/link1.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L2', parent:'L1',   type:'revolute', xyz:[-0.0205,0,0.081],  rpy:[-PI/2,0,0], axis:[-1,0,0], joint:'L2',
    mesh:{file:'arm/v10/visual/link2.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L3', parent:'L2',   type:'revolute', xyz:[0.02,0,0.099],     rpy:[0,0,0],     axis:[0,0,1],  joint:'L3',
    mesh:{file:'arm/v10/visual/link3.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L4', parent:'L3',   type:'revolute', xyz:[0,0.031002,0.14181],rpy:[0,0,0],    axis:[0,1,0],  joint:'L4',
    mesh:{file:'arm/v10/visual/link4.stl', scale:[1,1,1],  offset:[0,0,0]} },
  { name:'L5', parent:'L4',   type:'revolute', xyz:[0,-0.0309,0.126],  rpy:[0,0,0],     axis:[0,0,1],  joint:'L5',
    mesh:{file:'arm/v10/visual/link5.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L6', parent:'L5',   type:'revolute', xyz:[0.037426,0,0.131], rpy:[0,0,0],     axis:[1,0,0],  joint:'L6',
    mesh:{file:'arm/v10/visual/link6.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L7', parent:'L6',   type:'revolute', xyz:[-0.0375,0,0],      rpy:[0,0,0],     axis:[0,-1,0], joint:'L7',
    mesh:{file:'arm/v10/visual/link7.stl', scale:[1,-1,1], offset:[0,0,0]} },
  { name:'L_hand', parent:'L7', type:'fixed', xyz:[0,0,0.1001], rpy:[0,0,0], axis:null, joint:null,
    mesh:{file:'ee/openarmx_hand/collision/hand.stl', scale:[0.001,0.001,0.001], offset:[0,0,-0.6585]} },
  { name:'L_fR', parent:'L_hand', type:'prismatic', xyz:[0,-0.006,0.015], rpy:[0,0,0], axis:[0,-1,0], joint:'L_grip',
    mesh:{file:'ee/openarmx_hand/collision/finger.stl', scale:[0.001,0.001,0.001], offset:[0,-0.05,-0.673]} },
  { name:'L_fL', parent:'L_hand', type:'prismatic', xyz:[0,0.006,0.015],  rpy:[0,0,0], axis:[0,1,0],  joint:'L_grip',
    mesh:{file:'ee/openarmx_hand/collision/finger.stl', scale:[0.001,-0.001,0.001], offset:[0,0.05,-0.673]} },
  { name:'L_tcp', parent:'L_hand', type:'fixed', xyz:[0,0,0.08], rpy:[0,0,0], axis:null, joint:null, mesh:null },
  // 스틱 팁 (그립점 + 45° 방향 0.30m, dirSign=+1) — HUD·트레일·타격 기준점
  { name:'L_tip', parent:'L_hand', type:'fixed', xyz:[0.21213,0,0.29213], rpy:[0,0,0], axis:null, joint:null, mesh:null },
  { name:'R0', parent:'body', type:'fixed',    xyz:[0,-0.031,0.698],   rpy:[PI/2,0,0],  axis:null,    joint:null,
    mesh:{file:'arm/v10/visual/link0.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R1', parent:'R0',   type:'revolute', xyz:[0,0,0.058],        rpy:[0,0,0],     axis:[0,0,1],  joint:'R1',
    mesh:{file:'arm/v10/visual/link1.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R2', parent:'R1',   type:'revolute', xyz:[-0.0205,0,0.081],  rpy:[PI/2,0,0],  axis:[-1,0,0], joint:'R2',
    mesh:{file:'arm/v10/visual/link2.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R3', parent:'R2',   type:'revolute', xyz:[0.02,0,0.099],     rpy:[0,0,0],     axis:[0,0,1],  joint:'R3',
    mesh:{file:'arm/v10/visual/link3.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R4', parent:'R3',   type:'revolute', xyz:[0,0.031002,0.14181],rpy:[0,0,0],    axis:[0,1,0],  joint:'R4',
    mesh:{file:'arm/v10/visual/link4.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R5', parent:'R4',   type:'revolute', xyz:[0,-0.0309,0.126],  rpy:[0,0,0],     axis:[0,0,1],  joint:'R5',
    mesh:{file:'arm/v10/visual/link5.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R6', parent:'R5',   type:'revolute', xyz:[0.037426,0,0.131], rpy:[0,0,0],     axis:[1,0,0],  joint:'R6',
    mesh:{file:'arm/v10/visual/link6.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R7', parent:'R6',   type:'revolute', xyz:[-0.0375,0,0],      rpy:[0,0,0],     axis:[0,1,0],  joint:'R7',
    mesh:{file:'arm/v10/visual/link7.stl', scale:[1,1,1], offset:[0,0,0]} },
  { name:'R_hand', parent:'R7', type:'fixed', xyz:[0,0,0.1001], rpy:[0,0,0], axis:null, joint:null,
    mesh:{file:'ee/openarmx_hand/collision/hand.stl', scale:[0.001,0.001,0.001], offset:[0,0,-0.6585]} },
  { name:'R_fR', parent:'R_hand', type:'prismatic', xyz:[0,-0.006,0.015], rpy:[0,0,0], axis:[0,-1,0], joint:'R_grip',
    mesh:{file:'ee/openarmx_hand/collision/finger.stl', scale:[0.001,0.001,0.001], offset:[0,-0.05,-0.673]} },
  { name:'R_fL', parent:'R_hand', type:'prismatic', xyz:[0,0.006,0.015],  rpy:[0,0,0], axis:[0,1,0],  joint:'R_grip',
    mesh:{file:'ee/openarmx_hand/collision/finger.stl', scale:[0.001,-0.001,0.001], offset:[0,0.05,-0.673]} },
  { name:'R_tcp', parent:'R_hand', type:'fixed', xyz:[0,0,0.08], rpy:[0,0,0], axis:null, joint:null, mesh:null },
  { name:'R_tip', parent:'R_hand', type:'fixed', xyz:[0.21213,0,0.29213], rpy:[0,0,0], axis:null, joint:null, mesh:null },
];

// ── Three.js 초기화 ───────────────────────────────────────────
const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// 그림자는 로봇 포즈가 바뀔 때만 다시 계산한다(정지 상태·카메라 궤도 회전만
// 할 때 2048² 섀도맵을 매 프레임 다시 굽던 비용 제거). _shadowDirty가 켜진
// 프레임에만 needsUpdate를 세운다.
renderer.shadowMap.autoUpdate = false;
let _shadowDirty = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
viewport.insertBefore(renderer.domElement, document.getElementById('playbar'));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f2f5);
scene.fog = new THREE.FogExp2(0xf0f2f5, 0.04);

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 30);
camera.position.set(1.6, 1.1, 2.0);
camera.lookAt(0, 0.5, 0);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.5, 0);
orbit.enableDamping = true; orbit.dampingFactor = 0.06;
orbit.zoomSpeed = 0.4;
orbit.minDistance = 0.3; orbit.maxDistance = 8;
orbit.update();

scene.add(new THREE.AmbientLight(0x304060, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(3, 5, 3); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { near:0.1, far:15, left:-2, right:2, top:3, bottom:-1 });
scene.add(sun);
const fill = new THREE.DirectionalLight(0x4488ff, 0.4);
fill.position.set(-2, 2, -2);
scene.add(fill);
scene.add(new THREE.GridHelper(4, 24, 0xbbbbcc, 0xddddee));

// URDF Z-up → Three.js Y-up
const sceneRoot = new THREE.Group();
sceneRoot.rotation.x = -PI / 2;
scene.add(sceneRoot);

const MAT = {
  body:  new THREE.MeshStandardMaterial({ color:0x4a6080, roughness:.55, metalness:.25 }),
  left:  new THREE.MeshStandardMaterial({ color:0x3a7ae0, roughness:.35, metalness:.25 }),
  right: new THREE.MeshStandardMaterial({ color:0xe04030, roughness:.35, metalness:.25 }),
  hand:  new THREE.MeshStandardMaterial({ color:0x7a8898, roughness:.45, metalness:.20 }),
  tcp:   new THREE.MeshStandardMaterial({ color:0x00ff88, emissive:0x00aa44, emissiveIntensity:.9, roughness:.1 }),
};
function getMat(name) {
  if (name.includes('hand') || name.includes('_f')) return MAT.hand.clone();
  if (name === 'body') return MAT.body.clone();
  if (name.startsWith('L')) return MAT.left.clone();
  if (name.startsWith('R')) return MAT.right.clone();
  return MAT.body.clone();
}

const groups = {};
CHAIN.forEach(lk => { groups[lk.name] = new THREE.Group(); groups[lk.name].name = lk.name; });
CHAIN.forEach(lk => { (lk.parent ? groups[lk.parent] : sceneRoot).add(groups[lk.name]); });

const tcpGeo = new THREE.SphereGeometry(0.013, 8, 8);
['L_tcp','R_tcp'].forEach(n => groups[n].add(new THREE.Mesh(tcpGeo, MAT.tcp.clone())));

// ── 드럼채 (그리퍼 45° 고정, 팁쪽 테이퍼) ──────────────────────
['L','R'].forEach(s => {
  const grp = groups[`${s}_hand`];
  const sin = Math.sin(STICK.tilt), cos = Math.cos(STICK.tilt);
  const dir = new THREE.Vector3(STICK.dirSign * sin, 0, cos);
  const len = STICK.fwd + STICK.back;

  const stickGeo = new THREE.CylinderGeometry(0.0045, 0.0075, len, 10); // 위(팁) 가늘게
  const stickMat = new THREE.MeshStandardMaterial({ color: 0xc9a063, roughness: 0.6, metalness: 0.05 });
  const stick = new THREE.Mesh(stickGeo, stickMat);
  stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  stick.position.set(0, 0, STICK.gripZ).addScaledVector(dir, (STICK.fwd - STICK.back) / 2);
  stick.castShadow = true;
  grp.add(stick);

  // 팁 비드 (타격점 표시)
  const bead = new THREE.Mesh(
    new THREE.SphereGeometry(0.009, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xf0e0c0, roughness: 0.45 }));
  bead.position.set(0, 0, STICK.gripZ).addScaledVector(dir, STICK.fwd);
  bead.castShadow = true;
  grp.add(bead);
});

const MESH_BASE = './meshes/';
const stlLoader = new STLLoader();
let loaded = 0, meshTotal = 0;

CHAIN.forEach(lk => {
  if (!lk.mesh) return;
  meshTotal++;
  stlLoader.load(`${MESH_BASE}${lk.mesh.file}`, geo => {
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, getMat(lk.name));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.scale.set(...lk.mesh.scale);
    mesh.position.set(...lk.mesh.offset);
    groups[lk.name].add(mesh);
    if (++loaded === meshTotal) setStatus('준비 완료 ✓');
    else setStatus(`메시 로딩 ${loaded}/${meshTotal}`);
  }, undefined, () => { loaded++; });
});

// ── 순방향 기구학 (FK) ───────────────────────────────────────
// 링크의 고정 회전(qO)·축 벡터(axisV)는 매 프레임 동일하므로 링크당 한 번만
// 계산해 캐시한다(프레임마다 THREE 객체 수십 개를 새로 만들던 GC 부담 제거).
const _fkScratchQ = new THREE.Quaternion();
function updateFK(angles) {
  CHAIN.forEach(lk => {
    const g = groups[lk.name];
    if (!lk._qO) {
      lk._qO = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(lk.rpy[0], lk.rpy[1], lk.rpy[2], 'XYZ'));
      lk._axisV = lk.axis ? new THREE.Vector3(...lk.axis).normalize() : null;
    }
    const [x, y, z] = lk.xyz;
    if (lk.type === 'revolute' && lk.joint && angles[lk.joint] !== undefined) {
      g.quaternion.copy(lk._qO).multiply(_fkScratchQ.setFromAxisAngle(lk._axisV, angles[lk.joint]));
      g.position.set(x, y, z);
    } else if (lk.type === 'prismatic' && lk.joint) {
      const d = angles[lk.joint] || 0;
      g.position.set(x + lk.axis[0]*d, y + lk.axis[1]*d, z + lk.axis[2]*d);
      g.quaternion.copy(lk._qO);
    } else {
      g.position.set(x, y, z); g.quaternion.copy(lk._qO);
    }
  });
  updateJointHud(angles);
  _shadowDirty = true;   // 포즈가 바뀌었으니 그림자 1회 갱신 필요
}

function updateJointHud(angles) {
  ['L','R'].forEach(s => {
    const el = document.getElementById(`joint-${s.toLowerCase()}`);
    if (!el) return;
    const txt = [1,2,3,4,5,6,7].map(i => {
      const v = angles[`${s}${i}`] ?? 0;
      return `J${i}${v>=0?'+':''}${v.toFixed(2)}`;
    }).join(' ');
    el.textContent = txt;
  });
}

// ═══════════════════════════════════════════════════════════════
//  드럼 사운드 합성 (Web Audio — 외부 파일 없이 합성음 사용)
// ═══════════════════════════════════════════════════════════════
let _drumAudioCtx  = null;
let _drumMasterBus = null;
let _drumSoundOn   = true;

function _getDrumCtx() {
  if (!_drumAudioCtx) {
    _drumAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    _drumMasterBus = _makeDrumBus(_drumAudioCtx);
  }
  if (_drumAudioCtx.state === 'suspended') _drumAudioCtx.resume();
  return _drumAudioCtx;
}
// 여러 파셜/노이즈 레이어가 겹쳐도 뭉개지지 않도록 컴프레서를 하나 거쳐
// destination으로 보낸다. 오프라인(WAV 내보내기) 컨텍스트는 매번 새로
// 만들어지므로 그때그때 별도로 하나 만들어 쓴다(_drumSounds 쪽은 dest를
// 인자로 받아 양쪽 다 대응).
function _makeDrumBus(c) {
  const comp = c.createDynamicsCompressor();
  // 임계값을 높이고(덜 자주 눌림) release를 짧게 해서, 라이드처럼 길게
  // 우는 소리 직후에 오는 스네어 등이 눌려서 작게 들리는 문제를 줄인다.
  comp.threshold.value = -10; comp.knee.value = 6;
  comp.ratio.value = 3; comp.attack.value = 0.002; comp.release.value = 0.06;
  comp.connect(c.destination);
  return comp;
}

// ── 저수준 합성 유틸 ──────────────────────────────────────────
// 실제 어쿠스틱 드럼은 (1) 스틱이 헤드에 부딪히는 순간의 짧은 클릭
// 트랜지언트, (2) 헤드/셸이 진동하는 여러 개의 비조화(inharmonic) 파셜,
// (3) 스네어 와이어 등의 노이즈 성분이 겹쳐서 소리를 만든다. 기존엔
// 오실레이터 1개(피치 스윕)나 필터 노이즈 1개만 써서 "전자음" 느낌이
// 강했다 — 아래 유틸로 이 세 요소를 조합해 좀 더 어쿠스틱하게 만든다.

// 스틱 임팩트 클릭 — 아주 짧은 광대역 노이즈
function _synthClick(c, dest, t, gain, dur = 0.006) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), hp = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; src.connect(hp); hp.connect(g); g.connect(dest);
  hp.type = 'highpass'; hp.frequency.value = 2500;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  src.start(t); src.stop(t + dur + 0.005);
}
// 드럼 헤드/셸의 진동 — 여러 사인 파셜을 서로 다른 배음비·감쇠로 겹친다.
// partials: [{ratio, decay, level, drop}] — ratio는 f0 대비 배수(비조화),
// drop이 있으면 그 파셜도 짧게 피치가 떨어진다(때림 직후의 "보잉" 느낌).
function _synthPartials(c, dest, t, f0, dur, gain, partials) {
  partials.forEach(p => {
    const osc = c.createOscillator(), g = c.createGain();
    osc.connect(g); g.connect(dest);
    osc.type = 'sine';
    const freq = f0 * p.ratio;
    if (p.drop) {
      osc.frequency.setValueAtTime(freq * p.drop, t);
      osc.frequency.exponentialRampToValueAtTime(freq, t + dur * 0.6);
    } else {
      osc.frequency.setValueAtTime(freq, t);
    }
    const pd = dur * (p.decay ?? 1);
    g.gain.setValueAtTime(gain * p.level, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + pd);
    osc.start(t); osc.stop(t + pd + 0.01);
  });
}
// 필터링된 노이즈 레이어(심벌/스네어 노이즈 성분) — dest를 받아 라이브/
// 오프라인 컨텍스트 양쪽에서 재사용 가능
function _synthNoiseLayer(c, dest, t, filterType, freq, Q, dur, gain) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; src.connect(f); f.connect(g); g.connect(dest);
  f.type = filterType; f.frequency.value = freq; f.Q.value = Q;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  src.start(t); src.stop(t + dur + 0.01);
}

const _drumSounds = {
  // 킥: 임팩트 클릭 + 서브 피치 스윕(빠른 초반 하강으로 펀치감) + 배음 2개
  // (저역 서브 + 셸이 울리는 중역 바디감 추가)
  kick(t, c, g = 0.9, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.35, 0.004);
    _synthPartials(c, d, t, 62, 0.30, g, [
      { ratio: 1,    level: 1.0,  decay: 1.0,  drop: 2.4 },
      { ratio: 2.4,  level: 0.18, decay: 0.35 },
      { ratio: 3.6,  level: 0.08, decay: 0.2 },
    ]);
  },
  // 플로어 탐: 킥보다 높은 톤 + 배음 3개(비조화 비율)로 "통 울림" 표현
  tom_f(t, c, g = 0.8, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.25, 0.005);
    _synthPartials(c, d, t, 95, 0.32, g, [
      { ratio: 1,    level: 1.0,  decay: 1.0,  drop: 1.7 },
      { ratio: 1.63, level: 0.35, decay: 0.55 },
      { ratio: 2.31, level: 0.16, decay: 0.35 },
      { ratio: 3.12, level: 0.07, decay: 0.22 },
    ]);
  },
  // 스네어: 배음 3개 + 긴 피치 글라이드 조합이 꽹과리/종처럼 들렸다 —
  // 실제 스네어는 셸 톤이 아주 짧게 "툭"하고 끝나고 와이어 노이즈가
  // 주도해야 한다. 배음을 기본음 하나로 줄이고 아주 짧게(45ms), 피치
  // 글라이드도 살짝만 남기고, 노이즈 쪽 비중과 밝기를 더 키웠다.
  snare(t, c, g = 1.0, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.6, 0.005);
    _synthPartials(c, d, t, 180, 0.045, g * 0.3, [
      { ratio: 1, level: 1.0, decay: 1.0, drop: 1.15 },
    ]);
    _synthNoiseLayer(c, d, t, 'bandpass', 2600, 0.7, 0.11, g);
    _synthNoiseLayer(c, d, t, 'bandpass', 1200, 1.0, 0.16, g * 0.55);
    _synthNoiseLayer(c, d, t, 'highpass', 6000, 0.6, 0.06, g * 0.45);
  },
  // 스몰/미들 탐: 배음 3~4개로 통 울림, 스몰이 미들보다 배음 비율이 촘촘
  tom_h(t, c, g = 0.7, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.22, 0.004);
    _synthPartials(c, d, t, 200, 0.24, g, [
      { ratio: 1,    level: 1.0,  decay: 1.0,  drop: 1.5 },
      { ratio: 1.72, level: 0.3,  decay: 0.5 },
      { ratio: 2.4,  level: 0.14, decay: 0.3 },
      { ratio: 3.24, level: 0.06, decay: 0.18 },
    ]);
  },
  tom_m(t, c, g = 0.7, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.22, 0.005);
    _synthPartials(c, d, t, 135, 0.27, g, [
      { ratio: 1,    level: 1.0,  decay: 1.0,  drop: 1.6 },
      { ratio: 1.66, level: 0.32, decay: 0.5 },
      { ratio: 2.35, level: 0.14, decay: 0.3 },
      { ratio: 3.18, level: 0.06, decay: 0.18 },
    ]);
  },
  // 하이햇(클로즈드): 겹친 고역 노이즈 밴드 여러 개 + 아주 짧은 감쇠로
  // "치익" 하는 타격감. 금속성 느낌을 위해 좁은 대역 몇 개를 겹치고,
  // 아주 짧고 조용한 비조화 파셜 2개를 얹어 순수 노이즈보다 금속감을 더한다.
  hihat(t, c, g = 0.45, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.3, 0.003);
    _synthNoiseLayer(c, d, t, 'highpass', 9000,  0.9, 0.05, g * 0.8);
    _synthNoiseLayer(c, d, t, 'bandpass', 11500, 3.0, 0.045, g * 0.4);
    _synthNoiseLayer(c, d, t, 'bandpass', 7200,  4.0, 0.04, g * 0.3);
    _synthPartials(c, d, t, 3100, 0.045, g * 0.12, [
      { ratio: 1,    level: 1.0, decay: 1.0 },
      { ratio: 2.76, level: 0.6, decay: 0.7 },
    ]);
  },
  // 크래시: 넓게 퍼지는 비조화 노이즈 레이어(저역 바디+고역 쉬머) + 은은한
  // 금속 파셜 몇 개로 "챙~" 하는 잔향 표현
  crash(t, c, g = 0.5, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.3, 0.006);
    _synthNoiseLayer(c, d, t, 'bandpass', 3200, 0.5, 0.75, g * 0.55);
    _synthNoiseLayer(c, d, t, 'bandpass', 6000, 0.4, 0.85, g * 0.5);
    _synthNoiseLayer(c, d, t, 'highpass', 8500, 0.8, 0.65, g * 0.35);
    _synthPartials(c, d, t, 420, 0.6, g * 0.25, [
      { ratio: 1,    level: 1.0, decay: 1.0 },
      { ratio: 1.41, level: 0.6, decay: 0.9 },
      { ratio: 2.03, level: 0.4, decay: 0.7 },
    ]);
  },
  // 라이드: 이전엔 배음이 3개뿐이고 정수비에 가까워 "종/깡통"처럼 들렸다.
  // 실제 심벌은 배음이 훨씬 촘촘하고 비조화적이며, 노이즈(쉼머)가 톤보다
  // 우세해야 "금속판" 느낌이 난다 — 배음을 6개로 늘리고 비조화 비율로,
  // 레벨은 낮춰서 노이즈 워시 위에 살짝 얹히는 "핑"으로만 남긴다.
  ride(t, c, g = 0.2, dest) {
    const d = dest || c.destination;
    _synthClick(c, d, t, g * 0.2, 0.004);
    _synthNoiseLayer(c, d, t, 'highpass', 6500, 0.7, 0.4,  g * 0.55);
    _synthNoiseLayer(c, d, t, 'bandpass', 9200, 0.5, 0.32, g * 0.38);
    _synthNoiseLayer(c, d, t, 'bandpass', 4200, 0.6, 0.22, g * 0.22);
    _synthPartials(c, d, t, 780, 0.4, g * 0.22, [
      { ratio: 1,    level: 1.0,  decay: 1.0 },
      { ratio: 1.83, level: 0.55, decay: 0.85 },
      { ratio: 2.62, level: 0.4,  decay: 0.7 },
      { ratio: 3.44, level: 0.3,  decay: 0.55 },
      { ratio: 4.28, level: 0.2,  decay: 0.4 },
      { ratio: 5.11, level: 0.13, decay: 0.3 },
    ]);
  },
};

window.toggleDrumSound = function () {
  _drumSoundOn = !_drumSoundOn;
  const btn = document.getElementById('btn-sound');
  if (btn) { btn.textContent = _drumSoundOn ? '🔊' : '🔇'; btn.classList.toggle('on', _drumSoundOn); }
};

function playDrumSound(drumType) {
  if (!_drumSoundOn) return;
  try {
    const c  = _getDrumCtx();
    const fn = _drumSounds[drumType] || _drumSounds.tom_m;
    fn(c.currentTime + 0.005, c, undefined, _drumMasterBus);
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
//  TCP 궤적 렌더링
// ═══════════════════════════════════════════════════════════════
const TRAIL_MAX  = 48;   // 최대 저장 포인트 수
const TRAIL_UPD  = 55;   // ms 간격으로 갱신 (약 18fps)
const _trailData = {
  L: { pts: [], lastUpd: 0, color: 0x3a7ae0 },
  R: { pts: [], lastUpd: 0, color: 0xe04030 },
};
const _trailLines = { L: null, R: null };
let   _trailOn   = true;

window.toggleTCPTrail = function () {
  _trailOn = !_trailOn;
  const btn = document.getElementById('btn-trail');
  if (btn) btn.classList.toggle('on', _trailOn);
  if (!_trailOn) ['L','R'].forEach(arm => {
    if (_trailLines[arm]) { scene.remove(_trailLines[arm]); _trailLines[arm] = null; }
    _trailData[arm].pts = [];
  });
};

function updateTCPTrails() {
  if (!_trailOn || !isPlaying) return;
  const now = performance.now();
  ['L','R'].forEach(arm => {
    const td = _trailData[arm];
    if (now - td.lastUpd < TRAIL_UPD) return;
    td.lastUpd = now;

    const tcp = groups[`${arm}_tip`];   // 스틱 팁 궤적
    if (!tcp) return;
    const pos = new THREE.Vector3();
    tcp.getWorldPosition(pos);
    td.pts.push(pos.clone());
    if (td.pts.length > TRAIL_MAX) td.pts.shift();
    if (td.pts.length < 2) return;

    if (_trailLines[arm]) { scene.remove(_trailLines[arm]); _trailLines[arm].geometry.dispose(); }
    const geo = new THREE.BufferGeometry().setFromPoints(td.pts);
    const mat = new THREE.LineBasicMaterial({ color: td.color, transparent: true, opacity: 0.55 });
    _trailLines[arm] = new THREE.Line(geo, mat);
    _trailLines[arm].frustumCulled = false;
    scene.add(_trailLines[arm]);
  });
}

function clearTCPTrails() {
  ['L','R'].forEach(arm => {
    if (_trailLines[arm]) { scene.remove(_trailLines[arm]); _trailLines[arm] = null; }
    _trailData[arm].pts = [];
  });
}

// ── 드럼 구체 ────────────────────────────────────────────────
const drumSphereGroup = new THREE.Group();
sceneRoot.add(drumSphereGroup);
const drumMeshes = {};  // drumId → head mesh (레이캐스트·플래시용)
const drumGroups = {};  // drumId → Group (위치 이동용)

function rebuildDrumSpheres() {
  while (drumSphereGroup.children.length) drumSphereGroup.remove(drumSphereGroup.children[0]);
  Object.keys(drumMeshes).forEach(k => delete drumMeshes[k]);
  Object.keys(drumGroups).forEach(k => delete drumGroups[k]);

  drumKit.forEach(drum => {
    // ── 킥 드럼: 바닥에 눕혀진 베이스 드럼 (표시 전용) ──────
    if (drum.type === 'kick') {
      const grp = new THREE.Group();
      grp.position.set(drum.pos.x, drum.pos.y, drum.pos.z);
      drumSphereGroup.add(grp);
      drumGroups[drum.id] = grp;

      const col    = new THREE.Color(DRUM_TYPES.kick.color);
      // 킥은 낮고 컴팩트하게 — 탐 마운트 높이(0.38)와의 대비 강조, z=0.12 바닥 안착
      const kickR  = 0.12, kickD = 0.24;

      // 드럼 몸통 (축 = X방향)
      const bodyGeo = new THREE.CylinderGeometry(kickR, kickR, kickD, 32);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: col, roughness: 0.60, metalness: 0.10, transparent: true, opacity: 0.70,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.rotation.z = -Math.PI / 2;
      grp.add(body);

      // 앞면 드럼헤드 (robot 방향)
      const faceGeo = new THREE.CylinderGeometry(kickR * 0.97, kickR * 0.97, 0.012, 32);
      const faceMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#cccccc'), roughness: 0.55, metalness: 0.05,
        transparent: true, opacity: 0.80,
      });
      const face = new THREE.Mesh(faceGeo, faceMat);
      face.rotation.z = -Math.PI / 2;
      face.position.x = -(kickD / 2 + 0.005);
      grp.add(face);
      return;
    }

    const typeInfo = DRUM_TYPES[drum.type];
    const col      = new THREE.Color(typeInfo.color);
    const isCymbal = ['crash', 'ride', 'hihat'].includes(drum.type);

    // 드럼별 그룹 (URDF 좌표에 배치)
    const grp = new THREE.Group();
    grp.position.set(drum.pos.x, drum.pos.y, drum.pos.z);
    drumSphereGroup.add(grp);
    drumGroups[drum.id] = grp;

    // 드럼 헤드 크기 — 실제 규격(인치 직경) 비율 반영, 씬 스케일 ≈ ×0.7
    const sizes = {
      //      [반지름, 두께]
      crash: [0.145, 0.008],   // 16" — 크래쉬
      ride:  [0.175, 0.008],   // 20" — 심벌 중 최대
      hihat: [0.100, 0.010],   // 13" — 심벌 중 최소 (크래쉬보다 확실히 작게)
      snare: [0.125, 0.055],   // 14" (얕은 셸)
      tom_h: [0.090, 0.055],   // 10" 스몰 탐 (탐 중 최소)
      tom_m: [0.105, 0.060],   // 12" 미들 탐
      tom_f: [0.140, 0.075],   // 16" 플로어 탐 (탐 중 최대·깊음)
    };
    const [r, h] = sizes[drum.type] || [0.10, 0.050];

    // 헤드 기울임 서브그룹 (스탠드는 수직 유지) — 타입 기본값, drum.tiltDeg로 오버라이드
    const tiltDeg = drum.tiltDeg ?? typeInfo.tilt ?? 0;
    const drumHead = new THREE.Group();
    if (tiltDeg) drumHead.rotation.y = -(tiltDeg * Math.PI / 180);

    // ── 헤드 (납작한 실린더) ─────────────────────────────────
    const headGeo = new THREE.CylinderGeometry(r, r, h, 32);
    const headMat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col.clone().multiplyScalar(0.20),
      emissiveIntensity: 0.20,
      roughness: isCymbal ? 0.22 : 0.60,
      metalness: isCymbal ? 0.78 : 0.12,
      transparent: true,
      opacity: 0.70,
    });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    // URDF Z(위) 방향이 헤드 축이 되도록: 실린더 기본축(Y) → X축 PI/2 회전 → Z
    // 기울기는 drumHead 그룹의 tiltDeg가 담당 (심벌 하드코딩 0.15 제거)
    headMesh.rotation.x = Math.PI / 2;
    headMesh.castShadow = true;
    drumHead.add(headMesh);
    drumMeshes[drum.id] = headMesh;

    // ── 하이 햇: 아래 심벌 추가 (실제 2장 겹침 구조) ─────────
    if (drum.type === 'hihat') {
      const botMesh = new THREE.Mesh(headGeo.clone(), headMat.clone());
      botMesh.rotation.x = Math.PI / 2;
      botMesh.position.z = -0.022;
      botMesh.material.opacity = 0.50;
      drumHead.add(botMesh);
    }

    // ── 헤드 윗면 링 (타격 위치 표시) ────────────────────────
    const ringGeo = new THREE.RingGeometry(r * 0.35, r * 0.92, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.30,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    // RingGeometry는 기본으로 XY 평면(URDF 수평면)에 있어서 회전 불필요
    ring.position.z = h / 2 + 0.001;
    drumHead.add(ring);

    grp.add(drumHead);

    // ── 스탠드 (얇은 폴, 바닥 방향) ──────────────────────────
    const standH   = Math.max(0.05, drum.pos.z - 0.02);
    const standGeo = new THREE.CylinderGeometry(0.005, 0.008, standH, 8);
    const standMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a3a, roughness: 0.9, transparent: true, opacity: 0.55,
    });
    const stand = new THREE.Mesh(standGeo, standMat);
    stand.rotation.x = Math.PI / 2;
    stand.position.z = -(standH / 2);
    grp.add(stand);

    // ── 베이스 플레이트 (스탠드 받침) ────────────────────────
    const baseGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.008, 16);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2a, roughness: 0.9, transparent: true, opacity: 0.50,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.rotation.x = Math.PI / 2;
    base.position.z = -standH;
    grp.add(base);
  });

  drumKit.forEach(drum => _updateDrumReachVisual(drum, true));
}

// 팔이 닿지 않는 위치로 옮겨졌을 때 드럼 헤드 색을 빨간색으로 바꿔 재생 없이도
// 바로 알 수 있게 한다(킥은 팔 미배정이라 대상 아님).
function _updateDrumReachVisual(drum, force) {
  const mesh = drumMeshes[drum.id];
  if (!mesh || drum.type === 'kick') return;
  const unreachable = reachDist(drum) > STICK_REACH;
  const baseColor = unreachable ? 0xe04040 : DRUM_TYPES[drum.type].color;
  mesh.material.color.set(baseColor);
  mesh.material.emissive.set(baseColor).multiplyScalar(0.20);
  _updateArmReachBadges(drum, force);
}

// ── 팔별 실제 도달 가능 여부(단순 거리가 아니라 IK 수렴 기준) ──
// 드럼 위치가 바뀔 때마다 왼팔/오른팔 각각 실제로 자연스럽게 닿는지 확인해
// 드럼 키트 패널의 L/R 배지와 타임라인 레인의 절반 음영으로 즉시 보여준다.
// setEventArm()의 경고 로직과 동일한 기준(거리 + _solveStickStrike().ok)을 쓴다.
function _armReachOk(drum, arm) {
  if (drum.type === 'kick') return true;
  const test = { ...drum, arm };
  if (reachDist(test) > STICK_REACH) return false;
  return _solveStickStrike(test, 'medium').ok;
}

// IK 수렴 확인은 드래그 중 매 mousemove마다 돌리기엔 무겁다 — 배지·레인
// 음영은 150ms에 한 번만 갱신(드럼 헤드 색은 위에서 이미 즉시 갱신됨).
let _reachBadgeTs = 0;
function _updateArmReachBadges(drum, force) {
  if (drum.type === 'kick') return;
  // 뷰포트에서 드럼을 드래그하는 동안은(force 없이 호출되는 매 mousemove)
  // 이 IK 계산을 건너뛴다 — 실측 결과 드래그 중 150ms 스로틀로도 여전히
  // 버벅임이 심했다(_solveStickStrike가 시드 여러 개를 도는 반복 계산이라
  // 드래그처럼 위치가 매 프레임 달라지면 캐시도 못 타 매번 새로 풂).
  // 드래그 중엔 색상만(reachDist 기반, 이미 별도로 즉시 갱신됨) 보여주고,
  // 정확한 L/R 배지·타임라인 음영은 드래그가 끝나는 순간(mouseup, force
  // 호출)이나 숫자 입력 시에만 계산한다.
  if (!force && _isDragging) return;
  const now = performance.now();
  if (!force && now - _reachBadgeTs < 150) return;
  _reachBadgeTs = now;

  const okL = _armReachOk(drum, 'L');
  const okR = _armReachOk(drum, 'R');
  drum._reachL = okL;
  drum._reachR = okR;

  const badge = document.querySelector(`.drum-row[data-id="${drum.id}"] .drum-reach-badge`);
  if (badge) {
    const bl = badge.querySelector('.reach-l');
    const br = badge.querySelector('.reach-r');
    if (bl) { bl.classList.toggle('ok', okL); bl.classList.toggle('bad', !okL); bl.title = `왼팔 — ${okL ? '타격 가능' : '현재 위치에서 도달 불가(자세 부자연)'}`; }
    if (br) { br.classList.toggle('ok', okR); br.classList.toggle('bad', !okR); br.title = `오른팔 — ${okR ? '타격 가능' : '현재 위치에서 도달 불가(자세 부자연)'}`; }
  }

  const lane = document.querySelector(`.tl-lane[data-drum-id="${drum.id}"]`);
  if (lane) {
    lane.classList.toggle('half-l-unreachable', !okL);
    lane.classList.toggle('half-r-unreachable', !okR);
  }
}

// ── 재생 상태 ────────────────────────────────────────────────
let isPlaying   = false;
let startWall   = 0, pauseOffset = 0;
let _playKFs    = { L: [], R: [], totalTime: 0 };
let _playDur    = 0;
let _flashState = {};
let _playbackSpeed = 1;   // 참고 영상과 세밀하게 비교할 때 느리게 재생하기 위한 배속

function smoothStep(t) { return t * t * (3 - 2 * t); }

// Catmull-Rom 스플라인: p1→p2 구간, p0/p3는 접선 계산용
// → 각 키프레임을 정확히 통과하면서 경유점에서 속도 연속성 유지
// → via-point에서 멈추지 않고 자연스럽게 통과 (관성 효과)
function catmullRom(t, p0, p1, p2, p3) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    2*p1 +
    (-p0 + p2) * t +
    (2*p0 - 5*p1 + 4*p2 - p3) * t2 +
    (-p0 + 3*p1 - 3*p2 + p3) * t3
  );
}

// 재생 시 t는 대체로 단조 증가하므로, 직전에 찾은 구간 인덱스에서 이어서
// 탐색한다(매번 0부터 선형 스캔하던 것을 제거 — 키프레임이 수천 개인 긴 곡에서
// 프레임당 절반 스캔 비용을 없앰). seek로 t가 뒤로 점프하면 0부터 다시 찾는다.
function _findSeg(kfs, t) {
  const n = kfs.length;
  let i = kfs._li | 0;
  if (i < 0 || i > n - 2) i = 0;
  if (kfs[i].time > t) i = 0;                    // t가 뒤로 점프 → 처음부터
  while (i < n - 2 && kfs[i + 1].time < t) i++;  // t를 포함하는 구간까지 전진
  kfs._li = i;
  return i;
}

function interpolateArm(t, kfs, keys) {
  const neutral = {};
  keys.forEach(k => { neutral[k] = 0; });
  if (!kfs.length) return neutral;
  if (kfs.length === 1) { const o = {}; keys.forEach(k => { o[k] = kfs[0].angles[k] ?? 0; }); return o; }

  const idx = _findSeg(kfs, t);
  const p1kf = kfs[idx], p2kf = kfs[idx + 1];
  if (p1kf.time === p2kf.time) { const o = {}; keys.forEach(k => { o[k] = p1kf.angles[k] ?? 0; }); return o; }

  // 경계: 첫/끝 키프레임은 같은 값으로 클램핑 → 시작·끝에서 자연스럽게 정지
  const p0kf = kfs[Math.max(0, idx - 1)];
  const p3kf = kfs[Math.min(kfs.length - 1, idx + 2)];
  const s = clamp((t - p1kf.time) / (p2kf.time - p1kf.time), 0, 1);
  const s2 = s*s, s3 = s2*s;
  const out = {};
  keys.forEach(k => {
    const a0 = p0kf.angles[k] ?? 0;
    const a1 = p1kf.angles[k] ?? 0;
    const a2 = p2kf.angles[k] ?? 0;
    const a3 = p3kf.angles[k] ?? 0;
    // strike 키프레임에서 접선=0 → 진입·출발 모두 속도 0 = 명확한 타격감
    // 일반 경유점은 CatmullRom 접선 유지 → 관성 있는 통과
    const m1 = p1kf.isStrike ? 0 : (a2 - a0) * 0.5;
    const m2 = p2kf.isStrike ? 0 : (a3 - a1) * 0.5;
    out[k] = (2*s3 - 3*s2 + 1)*a1 + (s3 - 2*s2 + s)*m1 + (-2*s3 + 3*s2)*a2 + (s3 - s2)*m2;
  });
  return out;
}

function interpolateAngles(t, kfs) {
  if (kfs.flat) return interpolateAnglesFlat(t, kfs.flat);   // intro/outro 통합 포맷
  const L_result = interpolateArm(t, kfs.L, ['L1','L2','L3','L4','L5','L6','L7']);
  const R_result = interpolateArm(t, kfs.R, ['R1','R2','R3','R4','R5','R6','R7']);
  return { ...L_result, ...R_result, L_grip: 0, R_grip: 0 };
}

// 양 팔 트랙을 YAML 내보내기용 단일 타임라인으로 병합
function buildMergedKeyframes() {
  const split = buildKeyframes();
  const timeSet = new Set();
  split.L.forEach(kf => timeSet.add(kf.time.toFixed(3)));
  split.R.forEach(kf => timeSet.add(kf.time.toFixed(3)));
  return Array.from(timeSet)
    .map(t => ({ time: parseFloat(t), angles: interpolateAngles(parseFloat(t), split) }))
    .sort((a, b) => a.time - b.time);
}

// ═══════════════════════════════════════════════════════════════
//  인트로·아웃트로 빌드 (재생·YAML 공통)
// ═══════════════════════════════════════════════════════════════

const _JOINT_KEYS14 = ['L1','L2','L3','L4','L5','L6','L7',
                       'R1','R2','R3','R4','R5','R6','R7'];

/** 배열 14개 → angles 객체 변환 */
function _arrToAngles(arr) {
  const obj = { L_grip: 0, R_grip: 0 };
  _JOINT_KEYS14.forEach((k, i) => { obj[k] = arr[i] ?? 0; });
  return obj;
}

/** 마지막 키프레임이 완전 0값(NEUTRAL)이면 제거 */
function removeHardResetPoint(tl) {
  if (tl.length <= 1) return tl;
  const last = tl[tl.length - 1];
  const isZero = _JOINT_KEYS14.every(k => Math.abs(last.angles[k] ?? 0) < 0.001);
  return isZero ? tl.slice(0, -1) : tl;
}

/** 너무 짧은 구간(< minInterval) 보정 — 컨트롤러 처리 불가 방지 */
function retimeTooShortIntervals(tl, minInterval = 0.030) {
  if (tl.length <= 1) return tl;
  const result = [{ ...tl[0] }];
  for (let i = 1; i < tl.length; i++) {
    const prev = result[result.length - 1];
    const curr = tl[i];
    // 앞 점(보정이 이미 반영된 prev.time)과 minInterval보다 가까우면 그만큼 뒤로
    // 민다. 반드시 "보정된 prev"와 비교해야 한다 — 예전엔 원본 gap만 보고
    // gap>0 && gap<min일 때만 밀어서, 한 점을 앞으로 민 뒤 그 다음 원본 점이
    // 밀린 점보다 앞서 있으면(gap<=0) 그대로 둬 time이 거꾸로 갔다. 그 결과
    // 근접(거의 동시) 타격이 뭉친 구간에서 YAML의 time_from_start가 중간에
    // 뒤섞여 추출되는 버그가 있었다. 이렇게 하면 항상 단조 증가한다.
    const minTime = parseFloat((prev.time + minInterval).toFixed(4));
    result.push(curr.time < minTime ? { ...curr, time: minTime } : { ...curr });
  }
  return result;
}

/** 타임라인 전체 time에 offset 추가 */
function shiftTimeline(tl, offset) {
  return tl.map(kf => ({ ...kf, time: parseFloat((kf.time + offset).toFixed(4)) }));
}

/** 인트로 4초 타임라인 생성 */
/** frontReadyPose에서 J4(팔꿈치) 미세 굽힘 — "숨쉬기" 효과 */
function _breathePose(base, amp) {
  const v = { ...base };
  if (v.L4 !== undefined) v.L4 = parseFloat((v.L4 + amp).toFixed(4));
  if (v.R4 !== undefined) v.R4 = parseFloat((v.R4 + amp).toFixed(4));
  return v;
}

/**
 * 인트로 4초 — armSpreadPose 경유 (스틱 충돌 안전)
 *
 *  0.00s: neutral          — 시작
 *  1.30s: armSpreadPose    — 양팔 옆으로 최대 벌림 (충돌 없는 후퇴)
 *  2.75s: firstRaisePose   — 첫 드럼을 향해 회전 + 코킹(raise, J7)까지 완료
 *  3.00s: firstRaisePose   — 홀드
 *  3.30s: breathe in (+0.04)
 *  3.70s: breathe out      — 정지 (firstRaisePose 그대로)
 *  4.00s: firstStrikePose  — ▶ 손목(J7)만 움직여 내려치기 — 일반 타격과 동일한 수직 스냅
 *
 *  raise→strike 구간은 J1~J6이 firstRaisePose와 완전히 동일하고 J7만 달라지므로,
 *  두 번째 타격부터의 raise→strike와 똑같은 수직 궤적으로 보인다.
 *  팔 방향 전환(J1~J6)이라는 "무거운" 움직임은 1.30~3.70s의 여유 구간에서 끝내고,
 *  마지막 0.3초는 순수 손목 스냅만 남기는 것이 핵심.
 *
 *  smoothstep 보간: 각 구간이 S곡선으로 자연스럽게 연결됨
 */
function createDrumIntroTimeline(firstRaisePose, firstStrikePose, preset, styleId = 'spread') {
  const nu = _arrToAngles(preset.neutralPose);
  const style = (typeof INTRO_STYLES !== 'undefined' && INTRO_STYLES[styleId]) || {};

  // firstRaisePose 도달 이후(3.30~4.00s)는 스타일과 무관하게 항상 동일 —
  // 어떤 스타일을 골라도 실제 첫 타격 시작 위치·타이밍은 그대로 유지된다.
  // 진입 동작(사용자 지정 안무)이 거의 정지 상태였던 tail 구간을 잡아먹고
  // 0~3.3s로 늘어난 만큼, tail은 1.25s(2.75~4.00)→0.70s(3.30~4.00)로
  // 압축 — 첫 타격 시점(4.00s) 자체는 그대로 유지한다.
  const tail = [
    { time: 3.30, angles: firstRaisePose                     },  // 첫 드럼 방향으로 회전 + 코킹
    { time: 3.45, angles: firstRaisePose                     },  // 홀드
    { time: 3.60, angles: _breathePose(firstRaisePose, +0.04)},  // 숨 들이쉬기
    { time: 3.80, angles: firstRaisePose                     },  // 숨 내쉬기 → 정지
    { time: 4.00, angles: firstStrikePose                    },  // ▶ 손목 스냅으로 내려치기
  ];

  if (styleId === 'retreat' && style.poseA && style.poseB) {
    const poseA = _arrToAngles(style.poseA);
    const poseB = _arrToAngles(style.poseB);
    return [
      { time: 0.00, angles: nu    },
      { time: 1.20, angles: poseA },  // J1 후인 + J7 들어올림
      { time: 1.98, angles: poseB },  // J1만 복귀
      ...tail,
    ];
  }

  if (styleId === 'xstrike' && style.crossPose) {
    // 앞에 드럼이 있으므로 진입은 retreat 스타일(poseA/poseB)을 그대로
    // 재사용 — armSpreadPose처럼 neutral→cross 직행이 드럼과 부딪힐 수 있음.
    const retreatStyle = (typeof INTRO_STYLES !== 'undefined' && INTRO_STYLES.retreat) || {};
    const poseA = _arrToAngles(retreatStyle.poseA || style.crossPose);
    const poseB = _arrToAngles(retreatStyle.poseB || style.crossPose);
    const cross = _arrToAngles(style.crossPose);

    // 스틱을 쥔 두 팔이 동시에 교차 자세로 들어가면 궤적이 겹칠 수 있어(서로
    // 통과 불가) 왼팔이 먼저 들어가 고정하고, 오른팔이 그 앞을 가로질러
    // 들어가며 준비 자세로 도착(아직 타격 아님). 왼팔의 손목 스냅(바깥→
    // 안쪽)은 시각적으로 어색해 보여 제거 — 왼팔은 교차 자세로 진입한
    // 뒤로는 완전히 고정하고, 오른팔 손목(J7)만 준비→코킹→스냅을 반복해
    // 타격한다(일반 드럼 타격과 동일한 raise→strike 구조).
    const leftInCross = { ...poseB,
      L1: cross.L1, L2: cross.L2, L3: cross.L3, L4: cross.L4, L7: cross.L7 };
    const rightReady  = { ...leftInCross,
      R1: cross.R1, R2: cross.R2, R3: cross.R3, R4: cross.R4, R7: style.readyR7 };
    const rightRaise  = { ...rightReady, R7: style.raiseR7 };
    const rightStrike = { ...rightReady, R7: style.strikeR7 };

    // 타격 횟수 4회 — 진입(0~1.44s) 이후 남은 시간(1.44~3.12s)에 재코킹
    // (0.30s)+스냅(0.12s) 사이클을 4번 반복해서 채운다. tail 시작(3.30s)
    // 직전에 작게 여유(0.18s)를 남겨 firstRaisePose로의 전환이 급작스럽지
    // 않게 한다.
    const STRIKE_COUNT = 4;
    const READY_TIME = 1.44, RAISE_DUR = 0.30, STRIKE_DUR = 0.12;
    const strikeFrames = [];
    let t = READY_TIME;
    for (let i = 0; i < STRIKE_COUNT; i++) {
      t = parseFloat((t + RAISE_DUR).toFixed(3));
      strikeFrames.push({ time: t, angles: rightRaise });   // 손목 재코킹
      t = parseFloat((t + STRIKE_DUR).toFixed(3));
      strikeFrames.push({ time: t, angles: rightStrike });  // 손목 스냅 — 타격
    }

    return [
      { time: 0.00,        angles: nu          },
      { time: 0.48,        angles: poseA       },  // 후인 + 손목 들기(공통 진입)
      { time: 0.84,        angles: poseB       },  // J1 복귀
      { time: 1.20,        angles: leftInCross },  // 왼팔 먼저 교차 자세로 진입 + 고정(이후 계속 고정)
      { time: READY_TIME,  angles: rightReady  },  // 오른팔이 앞을 가로질러 들어가 준비 자세(아직 타격 아님)
      ...strikeFrames,
      ...tail,
    ];
  }

  // 기본(spread): 팔 양옆 벌림
  const as = _arrToAngles(preset.armSpreadPose ?? preset.rearClearPose); // 하위 호환
  return [
    { time: 0.00, angles: nu },
    { time: 1.56, angles: as },  // 팔 양옆 벌림
    ...tail,
  ];
}

/**
 * 아웃트로 4초 — 인트로의 역순 미러링. 인트로 스타일 선택이 탈출 경로에도
 * 그대로 적용된다(retreat·xstrike는 인트로 때와 같은 이유로 옆이 아니라
 * 뒤로 후인하며 나가야 하므로) — "인트로/아웃트로 포함 여부" 체크박스와는
 * 별개로, 스타일만 인트로와 항상 같이 간다.
 *
 *  +0.00s: lastDrumPose   — 마지막 드럼 자세
 *  +0.50s: frontReadyPose — 준비 자세 복귀
 *  +0.80s: breathe in
 *  +1.25s: frontReadyPose — 정지
 *  spread            : +2.70s armSpreadPose(팔 양옆 벌리며 후퇴)
 *  retreat / xstrike : +2.70s poseB → +3.35s poseA(인트로 poseA→poseB의 역순 —
 *                      뒤로 후인하며 나감)
 *  +4.00s: neutralPose    — 완전 복귀
 */
function createDrumOutroTimeline(lastDrumPose, preset, startTime, styleId = 'spread') {
  const s  = startTime;
  const fp = _arrToAngles(preset.frontReadyPose);
  const nu = _arrToAngles(preset.neutralPose);

  if (styleId === 'retreat' || styleId === 'xstrike') {
    const retreatStyle = (typeof INTRO_STYLES !== 'undefined' && INTRO_STYLES.retreat) || {};
    if (retreatStyle.poseA && retreatStyle.poseB) {
      const poseA = _arrToAngles(retreatStyle.poseA);
      const poseB = _arrToAngles(retreatStyle.poseB);
      return [
        { time: s + 0.00, angles: lastDrumPose            },  // 마지막 드럼 자세
        { time: s + 0.50, angles: fp                       },  // 준비 자세 복귀
        { time: s + 0.80, angles: _breathePose(fp, +0.04) },  // 숨쉬기
        { time: s + 1.25, angles: fp                       },  // 정지
        { time: s + 2.70, angles: poseB                    },  // J1 복귀 위치(진입 poseB)
        { time: s + 3.35, angles: poseA                    },  // 후인 + 손목 들기(진입 poseA)
        { time: s + 4.00, angles: nu                       },  // 중립 복귀
      ];
    }
  }

  // 기본(spread): 팔 양옆 벌리며 후퇴
  const as = _arrToAngles(preset.armSpreadPose ?? preset.rearClearPose); // 하위 호환
  return [
    { time: s + 0.00, angles: lastDrumPose              },
    { time: s + 0.50, angles: fp                         },  // 준비 자세 복귀
    { time: s + 0.80, angles: _breathePose(fp, +0.04)   },  // 숨쉬기
    { time: s + 1.25, angles: fp                         },  // 정지
    { time: s + 2.70, angles: as                         },  // 팔 양옆 벌리며 후퇴
    { time: s + 4.00, angles: nu                         },  // 중립 복귀
  ];
}

/**
 * buildTimelineWithIntroOutro(options)
 * 재생·YAML 내보내기가 공유하는 최종 타임라인 생성
 */
function buildTimelineWithIntroOutro(options = {}) {
  const { includeIntro = true, includeOutro = true,
          introOutroPresetId = 'default', introStyleId = 'spread' } = options;

  const preset = (typeof INTRO_OUTRO_PRESETS !== 'undefined'
    ? INTRO_OUTRO_PRESETS[introOutroPresetId]
    : null) ?? {
    neutralPose:    Array(14).fill(0),
    rearClearPose:  [0.90,0,0.04,1.80,0,0,-1.35,-1.10,0,-0.04,1.80,0,0,1.35],
    frontReadyPose: [-0.79,-0.04,0.01,1.54,0,0,-0.58,0.79,0.04,-0.01,1.54,0,0,0.58],
  };

  // 드럼 본편 (merged flat)
  let drumTL = buildMergedKeyframes();
  drumTL = removeHardResetPoint(drumTL);
  drumTL = retimeTooShortIntervals(drumTL, 0.030);

  let finalTL = [];

  if (includeIntro) {
    // 각 팔의 실제 첫 타격 드럼에 대해 raise/strike 포즈를 직접 계산
    // (해당 팔이 아예 연주하지 않거나, 곡 전체의 최초 박보다 늦게 등장하면
    // frontReadyPose로 대기 — 늦게 들어오는 팔까지 인트로 끝(4.00s)에
    // "이미 친 것처럼" 강제하면 타임라인에 없는 타격이 나오고, 그 직후
    // 본편 트랙과 이어지며 불연속 점프+장시간 스플라인 드리프트까지
    // 겹치는 문제가 있었음.
    //
    // 예전엔 "다른 팔의 첫 박보다 늦지만 않으면" 안무에 반영했는데, 그러면
    // 두 팔의 첫 박이 서로 같더라도 1박(=인트로 끝 t=4.00s와 정확히 맞아
    // 떨어지는 지점)이 아니면 여전히 틀렸다 — 인트로는 항상 정확히 beat=1을
    // 겨냥해 끝나므로, 실제 첫 박이 1박이 아닌 경우(곡 시작에 쉼표가 있는
    // 경우) 거기서 강제로 미리 친 뒤 다시 원위치로 돌아가 실제 박을 기다리는
    // "유령 타격"이 그대로 재현됐다(사용자 실측 확인: 타임라인엔 없는데
    // 인트로 직후 하이햇·스네어가 한 번 치고 올라갔다 다시 시작). 이제는
    // 오직 그 팔의 첫 박이 정확히 1박일 때만 안무에 반영한다.
    // 대기 폴백은 buildKeyframes()의 대기 자세와 같은 frontReadyPose를 쓴다
    // (예전엔 팔꿈치를 더 든 preLift를 썼는데, 첫 박이 늦게 등장하는 팔이
    // 그 동안 팔꿈치를 거의 한계까지 굽힌 채 대기해 몸통에 부딪히고 움직임도
    // 커 보인다는 피드백으로 변경 — 인트로 자체가 끝나는 자세와 동일해짐).
    const { L: READY_L, R: READY_R } = _getReadyPoses();
    let hitL = _firstArmHit('L');
    let hitR = _firstArmHit('R');
    const BEAT_EPS = 0.001;
    if (hitL && hitL.beat > 1 + BEAT_EPS) hitL = null;
    if (hitR && hitR.beat > 1 + BEAT_EPS) hitR = null;
    const raiseL  = hitL ? computeStrikePose(hitL.drum, 'raise',  hitL.vel) : null;
    const strikeL = hitL ? computeStrikePose(hitL.drum, 'strike', hitL.vel) : null;
    const raiseR  = hitR ? computeStrikePose(hitR.drum, 'raise',  hitR.vel) : null;
    const strikeR = hitR ? computeStrikePose(hitR.drum, 'strike', hitR.vel) : null;

    const firstRaisePose = {
      ...READY_L, ...READY_R,
      ...(raiseL ? _sidePick(raiseL, 'L') : {}),
      ...(raiseR ? _sidePick(raiseR, 'R') : {}),
    };
    const firstStrikePose = {
      ...firstRaisePose,
      ...(strikeL ? _sidePick(strikeL, 'L') : {}),
      ...(strikeR ? _sidePick(strikeR, 'R') : {}),
    };

    const intro   = createDrumIntroTimeline(firstRaisePose, firstStrikePose, preset, introStyleId);
    const shifted = shiftTimeline(drumTL, 4.0);
    // shifted[0] = drumTL의 첫 프레임(대개 preLift/strike 혼재) → intro 마지막(firstStrikePose)이
    // 이를 대체하므로 제거(slice(1))
    finalTL = [...intro, ...shifted.slice(1)];
  } else {
    finalTL = [...drumTL];
  }

  if (includeOutro) {
    const lastPose = finalTL.length ? finalTL[finalTL.length - 1].angles
                                    : _arrToAngles(preset.neutralPose);
    const lastTime = finalTL.length ? finalTL[finalTL.length - 1].time : 0;
    const outro    = createDrumOutroTimeline(lastPose, preset, lastTime, introStyleId);
    // outro 첫 번째 == finalTL 마지막 → 중복 제거
    finalTL = [...finalTL, ...outro.slice(1)];
  }

  return finalTL;
}

/** 재생·YAML 모두에 쓰이는 "flat 타임라인" 반환 */
function buildFinalFlatTimeline() {
  const inclIntro = document.getElementById('chk-intro')?.checked ?? true;
  const inclOutro = document.getElementById('chk-outro')?.checked ?? true;
  const introStyleId = document.getElementById('intro-style-sel')?.value || 'spread';
  return (inclIntro || inclOutro)
    ? buildTimelineWithIntroOutro({ includeIntro: inclIntro, includeOutro: inclOutro, introStyleId })
    : buildMergedKeyframes();
}

/** playAnim 등에서 사용하는 _playKFs 포맷 반환
 *  - intro/outro 없음 : { L, R, totalTime }  (기존 분리 트랙)
 *  - intro/outro 있음 : { flat, totalTime }  (통합 flat 트랙)
 */
function buildFinalKeyframes() {
  const inclIntro = document.getElementById('chk-intro')?.checked ?? true;
  const inclOutro = document.getElementById('chk-outro')?.checked ?? true;
  if (!inclIntro && !inclOutro) return buildKeyframes();
  const flat = buildFinalFlatTimeline();
  return { flat, totalTime: flat.length ? flat[flat.length - 1].time : 0 };
}

/** flat 타임라인 보간 (인트로/아웃트로용) */
function interpolateAnglesFlat(t, flatKfs) {
  if (!flatKfs.length) return { ...NEUTRAL };
  if (flatKfs.length === 1) return { ...flatKfs[0].angles, L_grip: 0, R_grip: 0 };

  const idx = _findSeg(flatKfs, t);
  const p1kf = flatKfs[idx], p2kf = flatKfs[idx + 1];
  if (p1kf.time === p2kf.time) return { ...p1kf.angles, L_grip: 0, R_grip: 0 };

  const s = clamp((t - p1kf.time) / (p2kf.time - p1kf.time), 0, 1);
  const ss = smoothStep(s);
  const out = { L_grip: 0, R_grip: 0 };
  _JOINT_KEYS14.forEach(k => {
    const a1 = p1kf.angles[k] ?? 0;
    const a2 = p2kf.angles[k] ?? 0;
    out[k] = a1 + (a2 - a1) * ss;
  });
  return out;
}

window.playAnim = function () {
  _playKFs = buildFinalKeyframes();
  _playDur = _playKFs.totalTime;
  if (!timelineEvents.length) { alert('타임라인에 드럼 이벤트를 추가하세요.'); return; }
  document.getElementById('scrubber').max = _playDur;
  startWall = performance.now() - (pauseOffset / _playbackSpeed) * 1000;
  isPlaying = true;
  _playAudio(pauseOffset);
  _syncRefVideo(pauseOffset);
  if (_refVideoAudioCtx?.state === 'suspended') _refVideoAudioCtx.resume();
  const v = _refVideoEl();
  if (v) { v.playbackRate = _playbackSpeed; v.play().catch(() => {}); }
  _syncPlayBtns();
};

// 참고 영상과 프레임 단위로 세밀하게 비교할 때 실시간 재생은 너무 빨라
// 보이므로(특히 압축 영상은 currentTime을 자주 바꾸면 키프레임 단위로만
// 스킵돼 뚝뚝 끊겨 보인다) 배속을 낮춰 "연속 재생"으로 천천히 보는 편이
// 개별 프레임을 seek하는 것보다 훨씬 자연스럽다.
window.setPlaybackSpeed = function (v) {
  const newSpeed = parseFloat(v) || 1;
  if (isPlaying) startWall = performance.now() - (pauseOffset / newSpeed) * 1000;
  _playbackSpeed = newSpeed;
  if (_audioSrc) _audioSrc.playbackRate.value = _playbackSpeed;
  const video = _refVideoEl();
  if (video) video.playbackRate = _playbackSpeed;
};
window.pauseAnim = function () {
  if (!isPlaying) return;
  pauseOffset = ((performance.now() - startWall) / 1000) % _playDur;
  isPlaying   = false;
  _pauseAudio();
  _refVideoEl()?.pause();
  _syncPlayBtns();
};
window.stopAnim = function () {
  isPlaying   = false;
  pauseOffset = 0;
  _stopAudio();
  _refVideoEl()?.pause();
  _syncRefVideo(0);
  clearTCPTrails();
  // 정지 시점에 "타격 중"이던 드럼이 발광/확대된 채로 굳지 않게 상태를 리셋한다.
  Object.keys(_flashState).forEach(k => { _flashState[k] = false; });
  Object.values(drumMeshes).forEach(m => {
    if (m) { m.material.emissiveIntensity = 0.22; m.scale.setScalar(1.0); }
  });
  document.querySelectorAll('.tl-hit.flash').forEach(h => h.classList.remove('flash'));
  document.getElementById('scrubber').value = 0;
  updateFK({ ...NEUTRAL });
  updateTimeLbl(0);
  _syncPlayBtns();
  _updatePlayhead(0);
};
function _syncPlayBtns() {
  document.getElementById('btn-play') ?.classList.toggle('on', isPlaying);
  document.getElementById('btn-pause')?.classList.toggle('on', !isPlaying && pauseOffset > 0);
}
function updateTimeLbl(t) {
  document.getElementById('time-lbl').textContent = `${t.toFixed(2)} / ${_playDur.toFixed(1)} s`;
}

// 스크러버 드래그·타임라인 눈금 클릭·방향키 이동이 전부 공유하는 seek 로직.
function seekTo(t) {
  if (!(_playKFs.L?.length ?? _playKFs.flat?.length)) {
    _playKFs = buildFinalKeyframes();
    _playDur = _playKFs.totalTime;
    document.getElementById('scrubber').max = _playDur;
  }
  t = clamp(t, 0, _playDur || 0);
  pauseOffset = t;
  document.getElementById('scrubber').value = t;
  // 재생 중 seek: startWall을 새 위치 기준으로 재계산 → 애니메이션 루프가 덮어쓰지 않음
  if (isPlaying) startWall = performance.now() - (t / _playbackSpeed) * 1000;
  updateFK(interpolateAngles(t, _playKFs));
  updateTimeLbl(t);
  _updatePlayhead(t);
  if (isPlaying) _playAudio(t);
  else _audioPlayOff = t;
  _syncRefVideo(t);
  if (isPlaying) _refVideoEl()?.play().catch(() => {});
  else _refVideoEl()?.pause();
}

document.getElementById('scrubber').addEventListener('input', function () {
  seekTo(parseFloat(this.value));
});

// ◀/▶ 버튼과 방향키(←/→) 이동 — dir=-1/1, beatStep=true면 현재 비트 스냅
// 분해능(예: 1/8박) 단위로, false면 1프레임(1/60초) 단위로 움직인다.
// 참고 영상과 비교하며 정확히 어느 프레임에 어떤 타격이 맞는지 확인할 때 씀.
window.stepPlayhead = function (dir, beatStep) {
  const beatDur   = 60 / bpm;
  const div       = parseInt(document.getElementById('grid-sel')?.value || 8);
  const snapUnit  = 4 / div;   // 비트 단위(예: 1/8 분해능 → 0.5박)
  const step      = beatStep ? snapUnit * beatDur : (1 / 60);
  seekTo(pauseOffset + dir * step);
};

// 이 앱에서 오른쪽 클릭은 전부 자체 기능(비트 하나 삭제·드래그 지우개)으로
// 쓰고 있어 브라우저 기본 우클릭 메뉴가 뜰 일이 없다 — 레인마다 개별로
// preventDefault를 걸어도 드래그 종료 직후의 트레일링 contextmenu가 레인
// 바깥(다른 엘리먼트)에서 뜨는 경우까지는 못 막아서, 아예 페이지 전체에서
// 우클릭 메뉴 자체를 막는다.
document.addEventListener('contextmenu', e => e.preventDefault());

// 텍스트 입력·셀렉트에 포커스가 있을 때는 방향키를 가로채지 않는다(타이핑 방해 방지).
// scrubber(input[type=range])에 포커스가 있으면 브라우저 기본 동작(자체 step)에 맡긴다.
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  // 스페이스바 재생/일시정지 — 포커스가 버튼에 있으면 스페이스가 그 버튼을
  // 누르는 기본 동작과 겹쳐 이중 토글이 될 수 있으니 그때만 기본 동작에 맡긴다.
  if (e.code === 'Space' || e.key === ' ') {
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    e.preventDefault();
    if (isPlaying) window.pauseAnim(); else window.playAnim();
    return;
  }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  e.preventDefault();
  stepPlayhead(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey);
});

// 타임라인 눈금(초/마디·박자 행)을 클릭하면 그 위치로 바로 이동 — 지금까지는
// 뷰포트 아래 재생바(스크러버)로만 이동할 수 있어 번거로웠다.
function _seekFromRulerClick(e) {
  const el   = e.currentTarget;
  const rect = el.getBoundingClientRect();   // left에 스크롤이 이미 반영돼 있음(beatFromEvent 참고)
  const x    = clamp(e.clientX - rect.left, 0, totalBars * beatsPerBar * PX_PER_BEAT);
  const totalW    = totalBars * beatsPerBar * PX_PER_BEAT;
  const introDur  = _getAudioTimeOffset();
  const outroDur  = (document.getElementById('chk-outro')?.checked ?? true) ? 4.0 : 0.0;
  const drumDur   = Math.max(0.01, (_playDur || 0) - introDur - outroDur);
  const drumT     = totalW > 0 ? (x / totalW) * drumDur : 0;
  seekTo(introDur + drumT);
}
document.getElementById('tl-ruler-sec').addEventListener('click', _seekFromRulerClick);
document.getElementById('tl-ruler').addEventListener('click', _seekFromRulerClick);

// 정지/일시정지 상태에서 편집(강도 변경·스트로크 튜닝 등) 직후 현재 위치의
// 포즈를 즉시 다시 그린다. 재생 중엔 animate() 루프가 매 프레임 갱신하므로
// 호출되지 않는다. 미리보기 애니메이션 중엔 animate()와 동일하게 덮어쓰기 방지.
function renderFrame(t) {
  if (window._drumPreviewActive) return;
  updateFK(interpolateAngles(t, _playKFs));
}

function _updatePlayhead(t) {
  const ph = document.getElementById('tl-playhead');
  if (!ph || !_playDur) return;
  const totalW = totalBars * beatsPerBar * PX_PER_BEAT;

  // 인트로/아웃트로가 있을 때 재생헤드는 드럼 섹션 기준 시간으로 계산
  // → 인트로 구간(0~introDur): 재생헤드 t=0에 고정
  // → 드럼 구간: 정상 이동
  // → 아웃트로 구간: totalW에 고정
  const introDur = _getAudioTimeOffset();
  const outroDur = (document.getElementById('chk-outro')?.checked ?? true) ? 4.0 : 0.0;
  const drumDur  = Math.max(0.01, _playDur - introDur - outroDur);
  const drumT    = t - introDur;

  const x = drumT <= 0
    ? 0
    : Math.min(totalW, (drumT / drumDur) * totalW);

  ph.style.left = x.toFixed(1) + 'px';

  // 재생 중엔 재생헤드가 항상 보이도록 타임라인을 자동 스크롤(가로 폭이
  // 곡 전체 길이만큼 매우 넓어서 수동 스크롤만으로는 따라가기 어려움) —
  // 뷰포트 좌측에서 30% 지점에 재생헤드가 오도록 유지한다.
  if (isPlaying) {
    const scrollEl = document.getElementById('tl-scroll');
    if (scrollEl) {
      const viewW = scrollEl.clientWidth;
      const target = clamp(x - viewW * 0.3, 0, Math.max(0, totalW - viewW));
      scrollEl.scrollLeft = target;
    }
  }
}

// ── 메인 애니메이션 루프 ─────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  orbit.update();

  let t = pauseOffset;
  if (isPlaying && _playDur > 0) {
    t = ((performance.now() - startWall) / 1000 * _playbackSpeed) % _playDur;
    pauseOffset = t;
    document.getElementById('scrubber').value = t;
    updateTimeLbl(t);
    _updatePlayhead(t);
    _syncRefVideo(t);

    const beatDur   = 60 / bpm;
    const introOff  = _getAudioTimeOffset(); // 인트로 ON → 4.0s, OFF → 0
    if (_flashDirty) _rebuildFlashSchedule();
    for (let i = 0; i < _flashSchedule.length; i++) {
      const ev   = _flashSchedule[i];
      const mesh = drumMeshes[ev.drumId];
      if (!mesh) continue;
      const hitT  = (ev.beat - 1) * beatDur + introOff; // ← 인트로 오프셋 반영
      const inHit = t >= hitT && t < hitT + ev.rebDur;
      const key   = ev.key;
      // DOM 점은 data-beat(드럼+박자, 팔 무관)로 찾는다 — data-key엔 팔 접미사가
      // 붙어 있어 팔 없이 만든 이 key와는 매칭되지 않는다(유니즌 양팔 점 모두 반영).
      if (inHit && !_flashState[key]) {
        _flashState[key] = true;
        mesh.material.emissiveIntensity = 1.8;
        mesh.scale.setScalar(1.25);
        document.querySelectorAll(`.tl-hit[data-beat="${key}"]`).forEach(h => h.classList.add('flash'));
        playDrumSound(ev.type);   // ← 드럼 사운드 트리거
      } else if (!inHit && _flashState[key]) {
        _flashState[key] = false;
        mesh.material.emissiveIntensity = 0.22;
        mesh.scale.setScalar(1.0);
        document.querySelectorAll(`.tl-hit[data-beat="${key}"]`).forEach(h => h.classList.remove('flash'));
      }
    }
  }

  // 미리보기 애니메이션 중엔 메인 루프 FK 업데이트 스킵 (덮어쓰기 방지)
  if (!window._drumPreviewActive) {
    updateFK(interpolateAngles(t, _playKFs));
  }

  updateTCPTrails();   // ← TCP 궤적 갱신

  const cvs = renderer.domElement;
  const w   = viewport.clientWidth;
  const h   = Math.max(1, viewport.clientHeight - 40);
  if (cvs.width !== Math.round(w * renderer.getPixelRatio())) {
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    _shadowDirty = true;   // 뷰포트 크기 변경 시 그림자 1회 갱신
  }

  if (isPlaying || window._drumPreviewActive || _shadowDirty) {
    renderer.shadowMap.needsUpdate = true;
    _shadowDirty = false;
  }
  renderer.render(scene, camera);
}
animate();

// ═══════════════════════════════════════════════════════════════
//  오디오 (Web Audio API)
// ═══════════════════════════════════════════════════════════════
window.loadAudioFile = function (input) {
  const file = input.files[0];
  if (!file) return;
  if (!_audioCtx) _audioCtx = new AudioContext();
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      _audioBuf = await _audioCtx.decodeAudioData(e.target.result.slice(0));
      const nameEl = document.getElementById('audio-name');
      if (nameEl) nameEl.textContent = file.name;
      setStatus(`음악 로드: ${file.name} (${_audioBuf.duration.toFixed(1)}s)`);
    } catch (err) {
      setStatus('오디오 디코드 실패: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
};

// 이 도구는 MAGIC.EXE 한 곡 전용이라, 페이지 로드시 곡을 자동으로 재생
// 트랙에 로드한다 — "🎵 음악 로드"로 다른 파일을 올리면 그걸로 교체 가능.
async function _autoLoadDefaultSong() {
  try {
    if (!_audioCtx) _audioCtx = new AudioContext();
    const res = await fetch('assets/magicexe_mastering.mp3');
    const buf = await res.arrayBuffer();
    _audioBuf = await _audioCtx.decodeAudioData(buf);
    const nameEl = document.getElementById('audio-name');
    if (nameEl) nameEl.textContent = 'MAGIC.EXE (Mastering)';

    // 곡이 고정 1개이므로, 타임라인(마디 수)이 곡 전체 길이를 항상
    // 덮도록 자동으로 맞춘다 — 기존 마디 수가 이미 곡보다 길면 그대로 둔다.
    const barDur     = (60 / bpm) * beatsPerBar;
    const neededBars = Math.ceil(_audioBuf.duration / barDur) + 1; // 여유 1마디
    if (totalBars < neededBars) {
      totalBars = neededBars;
      const barsEl = document.getElementById('bars-inp');
      if (barsEl) barsEl.value = totalBars;
      renderTimeline();
      updateTLInfo();
      saveSettings();
    }

    setStatus(`곡 자동 로드: MAGIC.EXE (Mastering) (${_audioBuf.duration.toFixed(1)}s) · 타임라인 ${totalBars}마디`);
  } catch (err) {
    setStatus('기본 곡 자동 로드 실패: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
//  참고 영상 (오프셋 동기화) — 실제로 자르지 않고, 영상 재생 위치를
//  음악 타임라인과 맞추는 오프셋(초)만 입력받는다. 영상 자체 소리는
//  음소거하지 않아(토글만 제공) 손 위치·타이밍을 소리로도 확인 가능.
// ═══════════════════════════════════════════════════════════════
let videoOffset = 0;
function _refVideoEl() { return document.getElementById('ref-video-el'); }

// 업로드한 참고 영상 파일 자체(Blob)를 IndexedDB에 저장해, 새로고침해도
// "제거" 버튼을 누르기 전까지는 다시 불러올 필요 없이 유지되게 한다.
// localStorage는 용량이 작아(수MB) 영상 파일엔 안 맞아 IndexedDB를 쓴다.
const _REF_VIDEO_DB = 'magicexe_ref_video_db', _REF_VIDEO_STORE = 'video';
function _openRefVideoDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_REF_VIDEO_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(_REF_VIDEO_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function _saveRefVideoToDB(file) {
  try {
    const db = await _openRefVideoDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(_REF_VIDEO_STORE, 'readwrite');
      tx.objectStore(_REF_VIDEO_STORE).put({ blob: file, name: file.name }, 'current');
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  } catch (e) { /* IndexedDB 사용 불가 환경 — 이번 세션에서만 유지됨 */ }
}
async function _loadRefVideoFromDB() {
  try {
    const db = await _openRefVideoDB();
    return await new Promise((resolve, reject) => {
      const tx  = db.transaction(_REF_VIDEO_STORE, 'readonly');
      const req = tx.objectStore(_REF_VIDEO_STORE).get('current');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  } catch (e) { return null; }
}
async function _clearRefVideoDB() {
  try {
    const db = await _openRefVideoDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(_REF_VIDEO_STORE, 'readwrite');
      tx.objectStore(_REF_VIDEO_STORE).delete('current');
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  } catch (e) {}
}
// 페이지 로드 시 저장된 영상이 있으면 자동 복원
(async function _restoreRefVideo() {
  const rec = await _loadRefVideoFromDB();
  if (!rec) return;
  const video = _refVideoEl();
  if (!video) return;
  video.src = URL.createObjectURL(rec.blob);
  const nameEl = document.getElementById('ref-video-name');
  if (nameEl) nameEl.textContent = rec.name;
  setStatus(`참고 영상 복원: ${rec.name}`);
})();

window.toggleRefVideoPanel = function () {
  document.getElementById('video-panel')?.classList.toggle('collapsed');
};
window.toggleDrumPanel = function () {
  document.getElementById('drum-panel')?.classList.toggle('collapsed');
};
window.toggleStrokePanel = function () {
  document.getElementById('stroke-panel')?.classList.toggle('collapsed');
};

window.loadRefVideo = function (input) {
  const file = input.files[0];
  if (!file) return;
  const video = _refVideoEl();
  if (!video) return;
  video.src = URL.createObjectURL(file);
  const nameEl = document.getElementById('ref-video-name');
  if (nameEl) nameEl.textContent = file.name;
  _ensureRefVideoGain();   // 사용자가 파일을 고른 시점(제스처)에 오디오 그래프 준비
  _saveRefVideoToDB(file);
  setStatus(`참고 영상 로드: ${file.name} — 오프셋을 조절해 음악 시작 지점과 맞추세요`);
};

window.clearRefVideo = function () {
  const video = _refVideoEl();
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  const nameEl = document.getElementById('ref-video-name');
  if (nameEl) nameEl.textContent = '파일 없음';
  const fileInput = document.getElementById('ref-video-file');
  if (fileInput) fileInput.value = '';
  _clearRefVideoDB();
  setStatus('참고 영상 제거됨');
};

window.setRefVideoOffset = function (val) {
  videoOffset = parseFloat(val) || 0;
};

window.toggleRefVideoMute = function () {
  const video = _refVideoEl();
  if (!video) return;
  video.muted = !video.muted;
  const btn = document.getElementById('ref-video-mute-btn');
  if (btn) btn.textContent = video.muted ? '🔇' : '🔊';
};

// 참고 영상 자체 소리 크기 — <video>의 기본 volume은 0~1(100%)까지만 되고
// 원본 녹화 음량이 작으면 그 이상 키울 방법이 없다. Web Audio GainNode를
// 거치게 하면 100%(1.0)를 넘겨 원본보다 증폭할 수 있다(최대 250%).
// createMediaElementSource는 같은 <video> 엘리먼트에 대해 딱 한 번만 호출
// 가능하므로(두 번째 호출은 예외 발생) _refVideoGainNode가 있으면 재사용.
let _refVideoAudioCtx  = null;
let _refVideoGainNode  = null;
function _ensureRefVideoGain() {
  if (_refVideoGainNode) return _refVideoGainNode;
  const video = _refVideoEl();
  if (!video) return null;
  try {
    _refVideoAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = _refVideoAudioCtx.createMediaElementSource(video);
    _refVideoGainNode = _refVideoAudioCtx.createGain();
    _refVideoGainNode.gain.value = parseFloat(document.getElementById('ref-video-volume')?.value) || 1;
    src.connect(_refVideoGainNode).connect(_refVideoAudioCtx.destination);
  } catch (e) { /* 이미 다른 곳에서 연결된 경우 등 — 무시 */ }
  return _refVideoGainNode;
}
window.setRefVideoVolume = function (val) {
  const v = parseFloat(val) || 0;
  const gain = _ensureRefVideoGain();
  if (_refVideoAudioCtx?.state === 'suspended') _refVideoAudioCtx.resume();
  if (gain) gain.gain.value = v;
  const lbl = document.getElementById('ref-video-volume-val');
  if (lbl) lbl.textContent = Math.round(v * 100) + '%';
};

// 타임라인 시간(t, 인트로 포함) → 참고 영상 재생 위치로 변환해 맞춘다.
// _getAudioTimeOffset()과 같은 기준(인트로 구간)에 videoOffset을 더함.
function _syncRefVideo(t) {
  const video = _refVideoEl();
  if (!video || !video.src) return;
  const songT = t - _getAudioTimeOffset();
  const pos   = songT + videoOffset;
  if (pos < 0 || (video.duration && pos > video.duration)) {
    video.pause();
    return;
  }
  if (Math.abs(video.currentTime - pos) > 0.15) video.currentTime = pos;
}

/** 인트로 구간(0 ~ introDur) 동안 음악 재생을 지연시키는 오디오 오프셋 */
function _getAudioTimeOffset() {
  const inclIntro = document.getElementById('chk-intro')?.checked ?? true;
  return inclIntro ? 4.0 : 0.0;
}

function _playAudio(timelineOffset) {
  if (!_audioCtx || !_audioBuf) return;
  _stopAudio();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();

  const audioStart = _getAudioTimeOffset();
  // 인트로 구간이면 시작 지연, 이미 지난 경우 파일 내 해당 위치부터 즉시 재생
  const audioFilePos = Math.max(0, timelineOffset - audioStart);
  const startDelay   = Math.max(0, audioStart - timelineOffset);

  _audioSrc = _audioCtx.createBufferSource();
  _audioSrc.buffer = _audioBuf;
  _audioSrc.playbackRate.value = _playbackSpeed;
  _audioSrc.connect(_audioCtx.destination);
  _audioPlayOff   = clamp(audioFilePos, 0, _audioBuf.duration);
  const realStartDelay = startDelay / _playbackSpeed;   // 배속으로 늘어난 인트로 대기 시간만큼 지연
  _audioStartCtxT = _audioCtx.currentTime + realStartDelay;
  _audioSrc.start(_audioCtx.currentTime + realStartDelay, _audioPlayOff);
}

function _pauseAudio() {
  if (_audioCtx) _audioCtx.suspend();
}

function _stopAudio() {
  if (_audioSrc) { try { _audioSrc.stop(); } catch(e){} _audioSrc = null; }
  if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
//  드럼 3D 드래그
//  좌클릭 드래그 → 드럼을 수평면(XY URDF)에서 이동
//  URDF 좌표 ↔ Three.js 세계 좌표 변환:
//    world(x, y, z) = URDF(x, z, -y)  [sceneRoot.rotation.x = -PI/2]
// ═══════════════════════════════════════════════════════════════
const _rc        = new THREE.Raycaster();
const _rcMouse   = new THREE.Vector2();
const _dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _dragPt    = new THREE.Vector3();
let _dragDrumId  = null;
let _dragOffX    = 0, _dragOffZ = 0;
let _isDragging  = false;

renderer.domElement.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  _rcMouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
  _rcMouse.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
  _rc.setFromCamera(_rcMouse, camera);

  const meshList = Object.values(drumMeshes);
  if (!meshList.length) return;
  const hits = _rc.intersectObjects(meshList, false);
  if (!hits.length) return;

  const hitMesh = hits[0].object;
  const drumId  = Object.keys(drumMeshes).find(k => drumMeshes[k] === hitMesh);
  if (!drumId) return;

  const drum = drumKit.find(d => d.id === drumId);
  if (!drum) return;

  _dragDrumId      = drumId;
  _isDragging      = true;
  orbit.enabled    = false;

  // 수평 드래그 평면: Three.js 세계 Y = URDF Z 높이
  _dragPlane.constant = -drum.pos.z;
  _rc.ray.intersectPlane(_dragPlane, _dragPt);
  // 클릭 위치와 드럼 위치의 오프셋 보존
  _dragOffX = drum.pos.x - _dragPt.x;
  _dragOffZ = drum.pos.y + _dragPt.z;  // URDF y = -world_z

  renderer.domElement.style.cursor = 'grabbing';
  e.preventDefault();
});

renderer.domElement.addEventListener('mousemove', e => {
  const rect = renderer.domElement.getBoundingClientRect();
  _rcMouse.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
  _rcMouse.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1;

  if (_isDragging && _dragDrumId) {
    _rc.setFromCamera(_rcMouse, camera);
    if (!_rc.ray.intersectPlane(_dragPlane, _dragPt)) return;

    const drum = drumKit.find(d => d.id === _dragDrumId);
    if (!drum) return;

    drum.pos.x = parseFloat((_dragPt.x + _dragOffX).toFixed(3));
    drum.pos.y = parseFloat((-_dragPt.z + _dragOffZ).toFixed(3));

    const grp = drumGroups[_dragDrumId];
    if (grp) grp.position.set(drum.pos.x, drum.pos.y, drum.pos.z);

    _updateDrumReachVisual(drum);   // 드래그 중에도 도달 불가 시 즉시 빨간색으로

    // 패널 숫자 입력 즉시 반영
    const item = document.querySelector(`.drum-row[data-id="${drum.id}"]`);
    if (item) {
      const inps = item.querySelectorAll('.drum-pos-inp');
      if (inps[0]) inps[0].value = drum.pos.x.toFixed(2);
      if (inps[1]) inps[1].value = drum.pos.y.toFixed(2);
    }
  } else {
    // 호버 커서
    _rc.setFromCamera(_rcMouse, camera);
    const meshList = Object.values(drumMeshes);
    const hits = meshList.length ? _rc.intersectObjects(meshList, false) : [];
    renderer.domElement.style.cursor = hits.length ? 'grab' : '';
  }
});

renderer.domElement.addEventListener('mouseup', () => {
  if (_isDragging) {
    _isDragging   = false;
    orbit.enabled = true;
    renderer.domElement.style.cursor = '';
    // 드래그 후 키프레임 재빌드
    saveDrumKit();
    _checkTemplateDirty();
    renderDrumList();
    const dragged = drumKit.find(d => d.id === _dragDrumId);
    if (dragged) _updateDrumReachVisual(dragged, true);
    _playKFs = buildFinalKeyframes();
    _playDur = _playKFs.totalTime;
    _dragDrumId = null;
  }
});

renderer.domElement.addEventListener('mouseleave', () => {
  if (_isDragging) {
    _isDragging   = false;
    orbit.enabled = true;
    renderer.domElement.style.cursor = '';
    _dragDrumId   = null;
  }
});

// ═══════════════════════════════════════════════════════════════
//  타임라인 렌더링 (피아노 롤)
// ═══════════════════════════════════════════════════════════════

// 비트 1개의 DOM 엘리먼트 생성 — renderTimeline()의 전체 재빌드와, 드래그
// 중 가벼운 개별 추가(_tlAppendHits) 양쪽에서 공용으로 쓴다.
function _createHitEl(drum, evt, splitArm, typeInfo) {
  typeInfo = typeInfo || DRUM_TYPES[drum.type] || DRUM_TYPES.snare;
  const vel = evt.vel ?? 'medium';
  const x   = (evt.beat - 1) * PX_PER_BEAT;
  const effArm  = _effArm(evt) || drum.arm;
  const armCls  = !splitArm ? 'arm-none' : effArm === 'L' ? 'arm-L' : 'arm-R';
  const hit = document.createElement('div');
  hit.className      = `tl-hit vel-${vel} ${armCls}`;
  hit.dataset.vel    = vel;
  // key는 팔까지 포함 — 같은 드럼·같은 박자를 왼팔·오른팔이 동시에 칠 때
  // (유니즌 액센트) 두 이벤트가 별개 DOM 요소로 구분되게 한다. beat(팔 없이
  // 드럼+박자만)는 "이 드럼의 이 박자에 있는 점을 전부 지우고 다시 그린다"류
  // 갱신(_tlAppendHits)에서 쓴다.
  hit.dataset.key    = `${drum.id}_${evt.beat}_${effArm}`;
  hit.dataset.beat   = `${drum.id}_${evt.beat}`;
  hit.style.left     = x + 'px';
  hit.style.background  = typeInfo.color;
  hit.style.boxShadow   = VEL_GLOW[vel](typeInfo.color);
  const velLabel = { soft:'약', medium:'중', hard:'강' }[vel];
  const armLabel = effArm === 'L' ? '왼팔' : effArm === 'R' ? '오른팔' : '';
  hit.title = `${drum.name} — beat ${evt.beat.toFixed(2)} [${velLabel}]${armLabel ? ' · ' + armLabel : ''}  (클릭: 강도 변경 / 더블클릭: 타격 팔 변경 / 우클릭: 삭제)`;
  hit.addEventListener('click',       e => { e.stopPropagation(); applyVel(drum.id, evt.beat, effArm); });
  hit.addEventListener('dblclick',    e => { e.preventDefault(); e.stopPropagation(); if (splitArm) _showArmDropdown(e.clientX, e.clientY, drum.id, evt.beat, effArm); });
  hit.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    // 오른쪽 드래그 지우개가 방금 끝난 직후의 트레일링 contextmenu가 남아있는
    // 점 위에 떨어지면, 의도치 않게 그 점까지 하나 더 지워버리는 걸 방지.
    if (performance.now() < _tlDragSuppressClickUntil) return;
    removeEvent(drum.id, evt.beat, effArm);
  });
  return hit;
}

// 그리드 선(마디·박자·세분음)은 모든 레인이 동일하고 편집(클릭 1번)마다
// renderTimeline이 전체를 다시 그린다. 157마디×3박×세분음 = 레인당 ~900개,
// 7레인이면 매 편집마다 div ~6000개를 createElement로 새로 만들어 편집이 크게
// 밀렸다. 한 번만 만들어 두고(레이아웃이 바뀔 때만 재생성) 네이티브 cloneNode로
// 복제한다 — 결과 DOM은 완전히 동일하고 생성 비용만 대폭 준다.
let _gridTpl = null, _gridTplKey = '';
function _laneGridFragment(div) {
  const key = `${totalBars}|${beatsPerBar}|${div}|${PX_PER_BEAT.toFixed(3)}`;
  if (!_gridTpl || _gridTplKey !== key) {
    const frag = document.createDocumentFragment();
    const subCount = div / 4;
    for (let bar = 0; bar < totalBars; bar++) {
      for (let beat = 0; beat < beatsPerBar; beat++) {
        const bi = bar * beatsPerBar + beat;
        const x  = bi * PX_PER_BEAT;
        const line = document.createElement('div');
        line.className  = 'tl-grid-line ' + (beat === 0 ? 'bar' : 'beat');
        line.style.left = x + 'px';
        frag.appendChild(line);
        for (let sub = 1; sub < subCount; sub++) {
          const sx = x + (sub / subCount) * PX_PER_BEAT;
          const sl = document.createElement('div');
          sl.className     = 'tl-grid-line';
          sl.style.left    = sx + 'px';
          sl.style.opacity = '0.35';
          frag.appendChild(sl);
        }
      }
    }
    _gridTpl = frag; _gridTplKey = key;
  }
  return _gridTpl.cloneNode(true);
}

function renderTimeline() {
  _flashDirty = true;   // 키트·타입·박자 변경도 플래시 스케줄 재계산 대상
  updatePxPerBeat();
  const totalBeats = totalBars * beatsPerBar;
  const totalW     = totalBeats * PX_PER_BEAT;
  const div        = parseInt(document.getElementById('grid-sel')?.value || 8);

  const labelsEl = document.getElementById('tl-lane-labels');
  let lblHtml = '<div class="tl-lbl-ruler"></div>';
  drumKit.forEach(drum => {
    const col = DRUM_TYPES[drum.type]?.color || '#888';
    lblHtml += `<div class="tl-label" style="color:${col}" title="${drum.name}">${drum.name}</div>`;
  });
  labelsEl.innerHTML = lblHtml;

  // ── 초(seconds) 루러 행 ──────────────────────────────────────
  const beatDurSec = 60 / bpm;
  const secRulerEl = document.getElementById('tl-ruler-sec');
  secRulerEl.style.width = totalW + 'px';
  let secHtml = '';
  for (let bar = 0; bar < totalBars; bar++) {
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const bi  = bar * beatsPerBar + beat;
      const x   = bi * PX_PER_BEAT;
      const sec = (bi * beatDurSec).toFixed(beat === 0 ? 1 : 2);
      // 마디 시작 + 각 박자마다 초 표시
      const sCls = beat === 0 ? 'ruler-sec ruler-sec-bar' : 'ruler-sec';
      secHtml += `<span class="${sCls}" style="left:${x}px">${sec}s</span>`;
    }
  }
  // 마지막 끝 시간
  const endSec = (totalBars * beatsPerBar * beatDurSec).toFixed(1);
  secHtml += `<span class="ruler-sec ruler-sec-bar" style="left:${totalW}px">${endSec}s</span>`;
  secRulerEl.innerHTML = secHtml;

  // ── 마디·박자 루러 행 ─────────────────────────────────────────
  const rulerEl = document.getElementById('tl-ruler');
  rulerEl.style.width = totalW + 'px';
  const SUB_LABELS = {
    2: ['+'],
    4: ['e', '+', 'a'],
    8: ['', '', '', '+', '', '', ''],
  };
  let rulerHtml = '';
  for (let bar = 0; bar < totalBars; bar++) {
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const bi  = bar * beatsPerBar + beat;
      const x   = bi * PX_PER_BEAT;
      const cls = beat === 0 ? 'ruler-bar' : 'ruler-beat';
      const lbl = beat === 0 ? `${bar+1}` : `.${beat+1}`;
      rulerHtml += `<span class="ruler-mark ${cls}" style="left:${x}px">${lbl}</span>`;

      const subCount = div / 4;
      if (subCount > 1) {
        const subLbls = SUB_LABELS[subCount] || [];
        for (let sub = 1; sub < subCount; sub++) {
          const sx  = x + (sub / subCount) * PX_PER_BEAT;
          const txt = subLbls[sub - 1] || '';
          const sc  = (subCount <= 4 && sub === subCount / 2) ? 'ruler-sub-strong' : 'ruler-sub';
          rulerHtml += `<span class="ruler-mark ${sc}" style="left:${sx}px">${txt}</span>`;
        }
      }
    }
  }
  rulerEl.innerHTML = rulerHtml;

  const lanesEl = document.getElementById('tl-lanes');
  lanesEl.style.width = totalW + 'px';
  lanesEl.innerHTML   = '';

  drumKit.forEach(drum => {
    const lane = document.createElement('div');
    const splitArm = drum.type !== 'kick'; // 킥은 팔이 없어 구분 안 함
    lane.className       = 'tl-lane' + (splitArm ? ' split' : '')
      + (splitArm && drum._reachL === false ? ' half-l-unreachable' : '')
      + (splitArm && drum._reachR === false ? ' half-r-unreachable' : '');
    lane.style.width     = totalW + 'px';
    lane.dataset.drumId  = drum.id;
    const typeInfo = DRUM_TYPES[drum.type] || DRUM_TYPES.snare;

    lane.appendChild(_laneGridFragment(div));

    timelineEvents.filter(e => e.drumId === drum.id).forEach(evt => {
      lane.appendChild(_createHitEl(drum, evt, splitArm, typeInfo));
    });

    function beatFromEvent(e) {
      // lane.getBoundingClientRect()의 left는 가로 스크롤이 반영된 값이라
      // (스크롤할수록 점점 더 음수) 여기에 scrollLeft를 또 더하면 스크롤한
      // 만큼 이중으로 계산돼, 타임라인을 스크롤한 상태에서 클릭하면 전혀
      // 엉뚱한(스크롤한 만큼 더 뒤의) 박자에 비트가 찍히는 버그가 있었다.
      const rect = lane.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      let beat   = rawX / PX_PER_BEAT + 1;
      if (document.getElementById('chk-snap')?.checked) {
        const snapUnit = 4 / div;
        beat = Math.round(beat / snapUnit) * snapUnit;
      }
      return parseFloat(clamp(beat, 1, totalBeats + 1).toFixed(4));
    }

    // 레인의 위 절반=왼팔, 아래 절반=오른팔 — 클릭한 세로 위치로 팔을 정한다.
    // 킥처럼 팔 구분이 없는 레인은 undefined(= 드럼 기본 팔) 반환.
    function armFromEvent(e) {
      if (!splitArm) return undefined;
      const rect = lane.getBoundingClientRect();
      return (e.clientY - rect.top) < rect.height / 2 ? 'L' : 'R';
    }

    lane.addEventListener('click', e => {
      if (e.target.classList.contains('tl-hit')) return;
      if (performance.now() < _tlDragSuppressClickUntil) return; // 드래그 직후의 트레일링 클릭은 무시(중복 토글 방지)
      addEvent(drum.id, beatFromEvent(e), armFromEvent(e));
    });

    // 드래그로 일정 간격마다 반복 채우기 — mousemove/mouseup은 document에 한 번만
    // 등록해 커서가 레인 밖으로 살짝 벗어나도 드래그가 끊기지 않게 한다.
    lane.addEventListener('mousedown', e => {
      if (e.button === 2) {
        // 오른쪽 버튼 드래그 = 지우개 — 왼쪽 드래그(채우기)와 대칭. 지금까진
        // 드래그로 채운 걸 되돌리려면 점 하나하나 우클릭해야 해서 번거로웠다.
        // 간격 개념 없이, 드래그가 지나간 범위 안의 비트를 전부 지운다.
        e.preventDefault();
        _tlErase = { drumId: drum.id, startBeat: beatFromEvent(e) };
        _tlDragActive = true;
        _tlDragDirty  = false;
        return;
      }
      if (e.button !== 0 || e.target.classList.contains('tl-hit')) return;
      _tlDrag = { drumId: drum.id, lane, startBeat: beatFromEvent(e), arm: armFromEvent(e), filled: new Set() };
      _tlDragActive = true;
      _tlDragDirty  = false;
    });
    lane.addEventListener('contextmenu', e => {
      // 지우개 드래그 중이거나 방금 끝난 직후엔 OS 우클릭 메뉴가 뜨지 않게 한다.
      if (_tlErase || performance.now() < _tlDragSuppressClickUntil) e.preventDefault();
    });

    lanesEl.appendChild(lane);
  });

  const ph = document.createElement('div');
  ph.id = 'tl-playhead';
  lanesEl.appendChild(ph);
  _updatePlayhead(pauseOffset);
}

// 이벤트가 실제로 타격하는 팔 — evt.arm(수동 오버라이드)이 있으면 그걸,
// 없으면 드럼의 기본 배정 팔을 쓴다.
function _effArm(evt) {
  if (evt.arm === 'L' || evt.arm === 'R') return evt.arm;
  const d = drumKit.find(x => x.id === evt.drumId);
  return d?.arm;
}

// arm을 명시하면(레인의 클릭된 절반) 그 팔로 배치, 생략하면 드럼 기본 팔 사용.
function addEvent(drumId, beat, arm) {
  const drum = drumKit.find(d => d.id === drumId);

  // 킥은 팔 충돌 없음 — 토글도 드럼+박자만으로 충분(팔 개념 자체가 없음)
  if (!drum || drum.type === 'kick') {
    const sameIdx = timelineEvents.findIndex(e => e.drumId === drumId && Math.abs(e.beat - beat) < 0.01);
    if (sameIdx >= 0) { timelineEvents.splice(sameIdx, 1); _commitTimeline(); return; }
    timelineEvents.push({ drumId, beat, vel: defaultVel });
    _commitTimeline();
    return;
  }

  const useArm = (arm === 'L' || arm === 'R') ? arm : drum.arm;

  // ── 토글: 같은 드럼·같은 박자·같은 팔 → 제거. 팔이 다르면(예: 같은 드럼을
  // 왼팔은 이미 치고 있고 오른쪽 절반을 클릭) 토글하지 않고 아래로 내려가
  // 새 이벤트로 추가한다 — 왼팔·오른팔이 같은 드럼을 동시에 치는 유니즌
  // 액센트(예: 스네어 양손 강타)를 표현할 수 있어야 하는데, 예전엔 드럼+
  // 박자만으로 "이미 있음"을 판단해 팔이 달라도 무조건 토글(삭제)해버렸다.
  const sameArmIdx = timelineEvents.findIndex(e =>
    e.drumId === drumId && Math.abs(e.beat - beat) < 0.01 && _effArm(e) === useArm);
  if (sameArmIdx >= 0) {
    timelineEvents.splice(sameArmIdx, 1);
    _commitTimeline();
    return;
  }

  // ── 규칙 1: 동일 팔이 같은 박자에 이미 있으면 배치 불가 (팔 오버라이드 반영)
  const sameArmConflict = timelineEvents.find(e => {
    if (Math.abs(e.beat - beat) >= 0.01) return false;
    const ed = drumKit.find(d => d.id === e.drumId);
    return ed && ed.type !== 'kick' && _effArm(e) === useArm;
  });

  if (sameArmConflict) {
    const armKr    = useArm === 'L' ? '왼팔' : '오른팔';
    const otherArm = useArm === 'L' ? 'R' : 'L';
    const otherKr  = useArm === 'L' ? '오른팔' : '왼팔';
    // 반대팔로 이 드럼을 칠 수 있는지 체크
    const distOther = reachDist({ ...drum, arm: otherArm });
    const hint = distOther <= STICK_REACH
      ? ` — ${otherKr}은 도달 가능(${distOther.toFixed(2)}m)하니 레인 반대쪽 절반을 클릭해보세요`
      : ` (${otherKr}도 도달 불가 ${distOther.toFixed(2)}m)`;
    setStatus(`❌ beat ${beat.toFixed(2)}: ${armKr}은 이미 이 박자에 다른 드럼을 칩니다${hint}`);
    return;
  }

  // ── 규칙 2: 동일 타이밍에 양팔이 모두 배정됐으면 3번째 불가
  const bothArmsUsed = ['L', 'R'].every(a =>
    timelineEvents.some(e => {
      if (Math.abs(e.beat - beat) >= 0.01) return false;
      const ed = drumKit.find(d => d.id === e.drumId);
      return ed && ed.type !== 'kick' && _effArm(e) === a;
    })
  );
  if (bothArmsUsed) {
    setStatus(`❌ beat ${beat.toFixed(2)}: 동일 타이밍은 양팔 각 1개씩 최대 2개까지만 가능합니다`);
    return;
  }

  timelineEvents.push({ drumId, beat, vel: defaultVel, arm: useArm });
  _commitTimeline();
}

// 이미 배치된 비트의 타격 팔을 바꾼다 — 같은 박자에 대상 팔이 이미 쓰이고
// 있으면 거부(규칙 1·2와 동일한 제약을 그대로 적용). oldArm으로 정확히 어느
// 이벤트를 바꿀지 지정한다 — 이제 같은 드럼·같은 박자에 왼팔·오른팔 이벤트가
// 동시에 있을 수 있어서, drumId+beat만으로는 어느 쪽을 바꾸려는 건지 모호하다.
function setEventArm(drumId, beat, oldArm, newArm) {
  const evt = timelineEvents.find(e =>
    e.drumId === drumId && Math.abs(e.beat - beat) < 0.01 && _effArm(e) === oldArm);
  if (!evt) return;
  const drum = drumKit.find(d => d.id === drumId);
  if (!drum || drum.type === 'kick') return;
  if (_effArm(evt) === newArm) return;

  const conflict = timelineEvents.some(e => {
    if (e === evt || Math.abs(e.beat - beat) >= 0.01) return false;
    const ed = drumKit.find(d => d.id === e.drumId);
    return ed && ed.type !== 'kick' && _effArm(e) === newArm;
  });
  if (conflict) {
    setStatus(`❌ beat ${beat.toFixed(2)}: 해당 박자에 이미 ${newArm === 'L' ? '왼팔' : '오른팔'} 타격이 있습니다`);
    return;
  }

  // 드럼 위치가 아직 미정이라(추후 조정 예정) 지금 자세가 안 풀린다고
  // 배정 자체를 막지는 않는다 — 모든 악기를 양팔 어디로든 배정할 수
  // 있어야 하므로, 도달/IK 문제는 경고만 띄우고 그대로 적용한다.
  const dist   = reachDist({ ...drum, arm: newArm });
  const solved = _solveStickStrike({ ...drum, arm: newArm }, evt.vel ?? 'medium');
  const warn = dist > STICK_REACH
    ? ` ⚠ 현재 드럼 위치 기준 도달 거리 초과(${dist.toFixed(2)}m) — 위치 조정 필요`
    : !solved.ok
      ? ` ⚠ 현재 드럼 위치 기준 IK 미수렴 — 위치 조정 필요`
      : '';

  evt.arm = newArm;
  _commitTimeline();
  setStatus(`[${drum.name}] beat ${beat.toFixed(2)} → ${newArm === 'L' ? '왼팔' : '오른팔'}로 변경${warn}`);
}

// 비트를 더블클릭하면 그 자리(마우스 커서 기준)에 L/R 드롭다운을 띄워
// 타격 팔을 바로 바꿀 수 있게 한다. 레인이 화면 아래쪽 끝에 가까우면
// 화면 밖으로 나가지 않도록 위치를 clamp한다(marker 자체는 8px짜리
// 반쪽 높이라 anchor 기준으로 잡으면 위치가 어긋나 보였음).
function _showArmDropdown(clientX, clientY, drumId, beat, currentArm) {
  document.querySelectorAll('.tl-arm-dropdown').forEach(el => el.remove());
  const sel = document.createElement('select');
  sel.className = 'tl-arm-dropdown';
  sel.innerHTML = '<option value="L">L (왼팔)</option><option value="R">R (오른팔)</option>';
  sel.value = currentArm;
  sel.style.position = 'fixed';
  document.body.appendChild(sel); // 실제 크기를 재려면 먼저 붙여야 함

  const w = sel.offsetWidth  || 90;
  const h = sel.offsetHeight || 24;
  const left = Math.min(Math.max(4, clientX - w / 2), window.innerWidth  - w - 4);
  const top  = Math.min(Math.max(4, clientY + 8), window.innerHeight - h - 4);
  sel.style.left = left + 'px';
  sel.style.top  = top + 'px';

  sel.focus();
  const close = () => sel.remove();
  sel.addEventListener('change', () => { setEventArm(drumId, beat, currentArm, sel.value); close(); });
  sel.addEventListener('blur', close);
  sel.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

// arm을 주면 그 팔의 이벤트만 정확히 지운다(같은 드럼·박자에 왼팔·오른팔
// 이벤트가 동시에 있을 수 있으므로) — 생략하면 예전처럼 첫 매치를 지운다.
function removeEvent(drumId, beat, arm) {
  const idx = timelineEvents.findIndex(e =>
    e.drumId === drumId && Math.abs(e.beat - beat) < 0.01 && (arm == null || _effArm(e) === arm));
  if (idx >= 0) {
    timelineEvents.splice(idx, 1);
    _commitTimeline();
  }
}

// 이미 이 팔로 채워져 있으면 손대지 않음(드래그로 같은 위치를 여러 번
// 지나가도 지워지지 않게). 반대팔 이벤트가 이미 있으면 — 클릭과 달리 여기선
// 유니즌으로 "추가"하지 않고 그 이벤트를 이 팔로 "재지정"한다 — 왼팔
// 드래그·오른팔 드래그를 교차시켜 번갈아 치는 패턴(엇박 등)을 만드는 기존
// 용도를 그대로 유지하기 위함. 왼팔·오른팔이 같은 드럼을 동시에 치는
// 유니즌 액센트는 (의도적인 조작이라) 개별 클릭(addEvent)으로만 만든다.
function addEventIfMissing(drumId, beat, arm) {
  const sameArm = timelineEvents.find(e =>
    e.drumId === drumId && Math.abs(e.beat - beat) < 0.01 && _effArm(e) === arm);
  if (sameArm) return;
  const otherArm = timelineEvents.find(e => e.drumId === drumId && Math.abs(e.beat - beat) < 0.01);
  if (otherArm && (arm === 'L' || arm === 'R')) { setEventArm(drumId, beat, _effArm(otherArm), arm); return; }
  addEvent(drumId, beat, arm);
}

// ── 타임라인 레인 드래그 → 지정 간격마다 반복 채우기 ─────────────────
// 하나씩 클릭하는 대신, 레인을 누른 채 드래그하면 "드래그 간격" 설정값
// (1/4~4박)마다 비트 1을 기준으로 한 전역 그리드 위치에 자동으로 타격을
// 채운다. mousemove/mouseup은 레인이 renderTimeline()마다 다시 생성되므로
// document에 한 번만 등록해 리스너가 쌓이지 않게 한다.
let _tlDrag = null;          // { drumId, lane, startBeat, filled }
let _tlDragOccurred = false; // 이번 드래그에서 실제 이동(임계값 이상)이 있었는지
// 드래그 종료 후 이 시각(performance.now() 기준)까지의 클릭은 "드래그의 뒤이은
// 클릭"으로 간주해 무시한다(중복 토글 방지). 예전엔 불리언 플래그(_tlDragOccurred)를
// click 핸들러에서 소비했는데, 그 트레일링 클릭이 방금 드래그로 막 생겨난
// .tl-hit 점 위에 떨어지면 click 핸들러가 `e.target이 tl-hit`라서 플래그를
// 리셋하지 못한 채 조기 반환 — 그러면 플래그가 계속 true로 남아 그다음
// "진짜" 새 클릭(전혀 다른 위치)까지 통째로 씹혀버리는 버그가 있었다
// (드래그로 쭉 채우고 이어서 하나 더 추가하려 하면 안 먹히는 현상).
// 시간 기반 창으로 바꾸면 클릭의 target이 무엇이든 일정 시간 후 자동으로
// 풀려서 이후 클릭을 영구히 막지 않는다.
let _tlDragSuppressClickUntil = 0;

let _tlErase = null;          // { drumId, startBeat } — 오른쪽 버튼 드래그로 지우는 중
let _tlEraseOccurred = false; // 실제 지우개 드래그가 있었는지(트레일링 contextmenu 억제용)

document.addEventListener('mousemove', e => {
  if (!_tlDrag) return;
  const { startBeat, filled } = _tlDrag;
  // _commitTimeline()이 renderTimeline()으로 레인 DOM을 통째로 다시 만들기
  // 때문에, mousedown 시점의 lane 참조를 그대로 쓰면 첫 타격이 채워진 순간
  // 이후로 낡은(detached) 엘리먼트가 되어 나머지 드래그가 전부 깨진다 —
  // 매번 현재 DOM에서 다시 찾는다.
  const lane = document.querySelector(`.tl-lane[data-drum-id="${_tlDrag.drumId}"]`);
  if (!lane) { _tlDrag = null; return; }
  const rect    = lane.getBoundingClientRect();   // left에 스크롤이 이미 반영돼 있음(beatFromEvent 참고)
  const rawX    = e.clientX - rect.left;
  const curBeat = rawX / PX_PER_BEAT + 1;

  if (!_tlDragOccurred && Math.abs(curBeat - startBeat) < 0.05) return; // 미세한 움직임은 클릭으로 취급
  _tlDragOccurred = true;

  // "1마디"는 박자표에 따라 실제 박 수가 달라지므로(3/4=3박, 4/4=4박) 고정
  // 숫자 대신 beatsPerBar를 그때그때 읽어 계산한다 — 3/4박자에선 2박·4박
  // 간격이 마디 경계와 안 맞아(3의 배수가 아니라서) 매번 다른 박에 걸리는데,
  // "1마디"를 쓰면 항상 마디 시작(1박, 정박)에만 정확히 채울 수 있다.
  const intervalSel = document.getElementById('drag-interval-sel')?.value;
  const interval     = intervalSel === 'bar' ? beatsPerBar : (parseFloat(intervalSel) || 1);
  const totalBeats = totalBars * beatsPerBar;
  const lo = Math.min(startBeat, curBeat);
  const hi = Math.max(startBeat, curBeat);
  // 간격 그리드의 기준점 — 드래그를 "시작한 바로 그 위치"(startBeat, 이미
  // beatFromEvent의 1/8 스냅이 적용된 값)를 그대로 기준으로 삼는다. 한때
  // 이걸 "비트 1 기준 전역 그리드"에 반올림해서 스냅한 적이 있었는데, 그러면
  // 정작 사용자가 정확히 찍은 시작 위치가 아니라 그 근처의 다른 박(반박
  // 어긋난 자리)부터 채워지는 버그가 있었다 — 항상 "내가 처음 클릭한 지점"
  // 이 첫 비트가 되도록 반올림 없이 그대로 쓴다. "엇박" 체크박스는 여기서
  // 반 칸(interval/2)을 더해, 오른팔을 정박으로 채운 뒤 왼팔을 "같은 간격"
  // 으로 다시 드래그하면 정박을 덮어쓰지 않고 엇박에만 채워 교차 패턴을
  // 쉽게 만들 수 있게 해준다.
  const offbeat    = document.getElementById('chk-drag-offbeat')?.checked;
  const gridAnchor = startBeat + (offbeat ? interval / 2 : 0);
  const firstK = Math.ceil((lo - gridAnchor) / interval);
  const lastK  = Math.floor((hi - gridAnchor) / interval);
  const addedEvts = [];
  for (let k = firstK; k <= lastK; k++) {
    const beat = parseFloat((gridAnchor + k * interval).toFixed(4));
    if (beat < 1 || beat > totalBeats + 1) continue;
    const key = beat.toFixed(4);
    if (filled.has(key)) continue;
    filled.add(key);
    const before = timelineEvents.length;
    addEventIfMissing(_tlDrag.drumId, beat, _tlDrag.arm);
    if (timelineEvents.length !== before) {
      addedEvts.push(timelineEvents[timelineEvents.length - 1]);   // 새로 추가된 비트
    } else {
      const changed = timelineEvents.find(e => e.drumId === _tlDrag.drumId && Math.abs(e.beat - beat) < 0.01);
      if (changed) addedEvts.push(changed);   // 팔이 바뀌었을 수도 있는 기존 비트 — 점 다시 그리기
    }
  }
  if (addedEvts.length) _commitTimeline(addedEvts);
});

// 오른쪽 버튼 드래그 지우개 — 간격 개념 없이, 드래그가 지나간 범위(시작~현재
// 커서 사이 박자) 안에 있는 이 드럼의 비트를 전부 지운다. 왼쪽 드래그
// 채우기와 마찬가지로 무거운 전체 재계산(_commitTimeline)은 mouseup에서
// 한 번만 하고, 드래그 중엔 지워진 점만 DOM에서 바로 뗀다.
document.addEventListener('mousemove', e => {
  if (!_tlErase) return;
  const lane = document.querySelector(`.tl-lane[data-drum-id="${_tlErase.drumId}"]`);
  if (!lane) { _tlErase = null; return; }
  const rect    = lane.getBoundingClientRect();
  const curBeat = (e.clientX - rect.left) / PX_PER_BEAT + 1;
  const lo = Math.min(_tlErase.startBeat, curBeat) - 0.05;
  const hi = Math.max(_tlErase.startBeat, curBeat) + 0.05;

  const toRemove = timelineEvents.filter(ev => ev.drumId === _tlErase.drumId && ev.beat >= lo && ev.beat <= hi);
  if (!toRemove.length) return;
  _tlEraseOccurred = true;
  toRemove.forEach(evt => {
    document.querySelector(`.tl-lane[data-drum-id="${evt.drumId}"] .tl-hit[data-key="${evt.drumId}_${evt.beat}_${_effArm(evt)}"]`)?.remove();
  });
  const removeSet = new Set(toRemove);
  timelineEvents = timelineEvents.filter(ev => !removeSet.has(ev));
  _tlDragDirty = true;   // 무거운 재계산·저장은 mouseup에서 한 번만
});

document.addEventListener('mouseup', () => {
  if (_tlDrag && _tlDragOccurred) _tlDragSuppressClickUntil = performance.now() + 300;
  if (_tlErase && _tlEraseOccurred) _tlDragSuppressClickUntil = performance.now() + 300;
  _tlDrag = null;
  _tlDragActive = false;
  _tlDragOccurred = false;
  _tlErase = null;
  _tlEraseOccurred = false;
  if (_tlDragDirty) { _tlDragDirty = false; _commitTimeline(); }   // 드래그 중 미룬 전체 재빌드·키프레임 계산을 한 번만
});

// 노트 클릭 시 현재 선택된 defaultVel로 즉시 적용
// arm을 주면(같은 드럼·박자에 유니즌으로 왼팔·오른팔 이벤트가 동시에 있을
// 수 있으므로) 그 팔의 이벤트만 정확히 찾는다.
function applyVel(drumId, beat, arm) {
  const evt = timelineEvents.find(e =>
    e.drumId === drumId && Math.abs(e.beat - beat) < 0.01 && (arm == null || _effArm(e) === arm));
  if (!evt) return;
  evt.vel = defaultVel;
  _commitTimeline();
  if (!isPlaying) renderFrame(pauseOffset);
}

// 타임라인 상단 모드 버튼 클릭 핸들러
window.setDefaultVel = function (vel) {
  defaultVel = vel;
  ['soft','medium','hard'].forEach(v => {
    document.getElementById(`vel-mode-${v}`)?.classList.toggle('active', v === vel);
  });
};

// ═══════════════════════════════════════════════════════════════
//  드럼 타격 자세 실시간 미리보기
//  클릭 시: 중립 → raise → strike → rebound → 중립 애니메이션
//  setInterval 기반 — RAF 경쟁 타이밍 문제 없음
// ═══════════════════════════════════════════════════════════════
window._drumPreviewActive = false;
let _previewTimer = null;

window.previewDrumHit = function (drumId, vel = 'medium') {
  if (_previewTimer) { clearInterval(_previewTimer); _previewTimer = null; }
  window._drumPreviewActive = false;

  const drum = drumKit.find(d => d.id === drumId);
  if (!drum || drum.type === 'kick') {
    setStatus(`[${drum?.name || drumId}] 킥 드럼은 팔 동작이 없습니다`);
    return;
  }

  // 패널 선택 하이라이트 + 버튼 활성 표시
  document.querySelectorAll('.drum-row').forEach(el => el.classList.remove('drum-selected'));
  document.querySelector(`.drum-row[data-id="${drumId}"]`)?.classList.add('drum-selected');
  document.querySelectorAll('.dvp-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.drum-row[data-id="${drumId}"] .dvp-${vel}`)?.classList.add('active');

  // 드럼 구체 플래시
  const mesh = drumMeshes[drumId];
  if (mesh) {
    mesh.material.emissiveIntensity = 2.0;
    mesh.scale.setScalar(1.3);
    setTimeout(() => { mesh.material.emissiveIntensity = 0.20; mesh.scale.setScalar(1.0); }, 180);
  }

  // TCP 경로: 강제 활성화 + 초기화 (강도별 궤적 비교용)
  if (!_trailOn) { _trailOn = true; document.getElementById('btn-trail')?.classList.add('on'); }
  clearTCPTrails();

  const velLabel = { soft:'약', medium:'중', hard:'강' }[vel];
  setStatus(`[${drum.name}] ${drum.arm === 'L' ? '왼팔' : '오른팔'} 미리보기 (${velLabel}) — 거리 ${reachDist(drum).toFixed(2)}m`);

  const phases = [
    { from: { ...NEUTRAL },                          to: computeStrikePose(drum, 'raise',   vel), dur: 0.14 },
    { from: computeStrikePose(drum, 'raise',   vel), to: computeStrikePose(drum, 'strike',  vel), dur: 0.09 },
    { from: computeStrikePose(drum, 'strike',  vel), to: computeStrikePose(drum, 'rebound', vel), dur: 0.09 },
    { from: computeStrikePose(drum, 'rebound', vel), to: { ...NEUTRAL },                          dur: 0.22 },
  ];

  let phaseIdx = 0;
  let phaseT0  = performance.now();
  window._drumPreviewActive = true;

  _previewTimer = setInterval(() => {
    if (phaseIdx >= phases.length) {
      clearInterval(_previewTimer);
      _previewTimer = null;
      window._drumPreviewActive = false;
      document.querySelector('.dvp-btn.active')?.classList.remove('active');
      updateFK({ ...NEUTRAL });
      return;
    }

    const { from, to, dur } = phases[phaseIdx];
    const elapsed = performance.now() - phaseT0;
    const t  = Math.min(1, elapsed / (dur * 1000));
    const st = smoothStep(t);

    const cur = { L_grip: 0, R_grip: 0 };
    ['L1','L2','L3','L4','L5','L6','L7','R1','R2','R3','R4','R5','R6','R7'].forEach(k => {
      cur[k] = (from[k] ?? 0) + ((to[k] ?? 0) - (from[k] ?? 0)) * st;
    });
    updateFK(cur);

    // TCP 궤적 실시간 기록 (throttle 바이패스)
    ['L','R'].forEach(arm => { _trailData[arm].lastUpd = 0; });
    const wasPlaying = isPlaying; isPlaying = true;
    updateTCPTrails();
    isPlaying = wasPlaying;

    if (t >= 1) { phaseIdx++; phaseT0 = performance.now(); }
  }, 16);
};

// ═══════════════════════════════════════════════════════════════
//  씬 팔레트 (배경·팔·몸체 컬러 변경)
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  씬 팔레트 프레셋
// ═══════════════════════════════════════════════════════════════
const SKIN_PRESETS = {
  default: { name:'기본 (블루·레드)',        bg:'#06060c', L:'#3a7ae0', R:'#e04030', body:'#4a6080', hand:'#7a8898' },
  cyber:   { name:'사이버펑크 (민트·마젠타)', bg:'#0d0720', L:'#00e87a', R:'#e000cc', body:'#1a0a30', hand:'#7733cc' },
  metal:   { name:'클래식 메탈 (실버)',       bg:'#101418', L:'#a8bac8', R:'#a8bac8', body:'#607080', hand:'#8898a8' },
  fire:    { name:'불꽃 (오렌지·레드)',       bg:'#0c0400', L:'#ff6600', R:'#ff2200', body:'#3a1200', hand:'#772200' },
  ocean:   { name:'오션 (블루·시안)',         bg:'#020c18', L:'#0077ff', R:'#00ccff', body:'#003366', hand:'#004488' },
  stealth: { name:'스텔스 (다크)',            bg:'#060608', L:'#334455', R:'#223344', body:'#151822', hand:'#1e2430' },
};

// 배경 색상 변경 시 색상 피커 동기화
window.syncBgPicker = function (hex) {
  const el = document.getElementById('pal-bg');
  if (el) el.value = hex;
};

// 스킨 프레셋 전체 적용 (배경 + 팔 + 몸체 + 손)
window.applySkinPreset = function (name) {
  const p = SKIN_PRESETS[name];
  if (!p) return;
  setSceneBg(p.bg);
  setArmColor('L', p.L);
  setArmColor('R', p.R);
  setBodyColor(p.body);
  setHandColor(p.hand);
  const sync = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  sync('pal-bg',    p.bg);
  sync('pal-arm-l', p.L);
  sync('pal-arm-r', p.R);
  sync('pal-body',  p.body);
  sync('pal-hand',  p.hand);
  setStatus(`스킨 프레셋 적용: ${p.name}`);
};

window.togglePalette = function () {
  document.getElementById('pal-popup')?.classList.toggle('open');
};

// 팔레트 팝업 외부 클릭 시 닫기
document.addEventListener('click', e => {
  const btn   = document.getElementById('pal-toggle-btn');
  const popup = document.getElementById('pal-popup');
  if (popup && popup.classList.contains('open') &&
      !popup.contains(e.target) && e.target !== btn) {
    popup.classList.remove('open');
  }
});

// 참고 영상 패널은 비트를 찍는 동안 계속 봐야 하므로(타임라인 클릭 등
// 외부 클릭에) 자동으로 닫히지 않는다 — 🎬 토글 버튼으로만 열고 닫는다.

// 프리셋 버튼을 SKIN_PRESETS 데이터에서 동적 생성
function renderSkinPresets() {
  const container = document.getElementById('skin-presets-container');
  if (!container) return;
  container.innerHTML = Object.entries(SKIN_PRESETS).map(([key, p]) =>
    `<button class="preset-skin" title="${p.name}"
      style="background:linear-gradient(135deg,${p.L} 50%,${p.R} 50%)"
      onclick="applySkinPreset('${key}')"></button>`
  ).join('');
}

window.setSceneBg = function (hexStr) {
  const col = new THREE.Color(hexStr);
  scene.background = col;
  const bright = (col.r + col.g + col.b) / 3;
  scene.fog = new THREE.FogExp2(col.getHex(), bright > 0.5 ? 0.04 : 0.08);
};

window.setArmColor = function (side, hexStr) {
  const col = new THREE.Color(hexStr);
  sceneRoot.traverse(child => {
    if (!child.isMesh || !child.parent) return;
    const n = child.parent.name;
    if (!n) return;
    const isArm = n.startsWith(side) &&
      !n.includes('_hand') && !n.includes('_fR') &&
      !n.includes('_fL')   && !n.includes('_tcp');
    if (isArm) child.material.color.set(col);
  });
};

window.setHandColor = function (hexStr) {
  const col = new THREE.Color(hexStr);
  sceneRoot.traverse(child => {
    if (!child.isMesh || !child.parent) return;
    const n = child.parent.name;
    if (n && (n.includes('_hand') || n.includes('_fR') || n.includes('_fL')))
      child.material.color.set(col);
  });
};

window.setBodyColor = function (hexStr) {
  const col = new THREE.Color(hexStr);
  const g = groups['body'];
  if (g) g.traverse(c => { if (c.isMesh) c.material.color.set(col); });
};

window.clearTimeline = function () {
  timelineEvents = [];
  stopAnim();
  renderTimeline();
  saveTimeline();
  setStatus('타임라인 초기화됨');
};

// ═══════════════════════════════════════════════════════════════
//  드럼 키트 패널
// ═══════════════════════════════════════════════════════════════
function renderDrumList() {
  const el       = document.getElementById('drum-list');
  const typeOpts = Object.entries(DRUM_TYPES)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');

  el.innerHTML = drumKit.map(drum => {
    const typeInfo  = DRUM_TYPES[drum.type] || DRUM_TYPES.snare;
    const isKick    = drum.type === 'kick';

    return `
<div class="drum-row" data-id="${drum.id}" title="뷰포트에서 드래그로 위치 이동 가능">
  <div class="drum-color-dot" style="background:${typeInfo.color};color:${typeInfo.color}"></div>
  <input class="drum-name-inp" value="${drum.name}"
    onchange="updateDrumProp('${drum.id}','name',this.value)">
  <select class="drum-type-sel" onchange="updateDrumProp('${drum.id}','type',this.value)">
    ${typeOpts.replace(`value="${drum.type}"`, `value="${drum.type}" selected`)}
  </select>
  ${isKick
    ? `<select class="drum-arm-sel" disabled title="킥은 표시 전용 — 팔이 연주하지 않음"><option selected>−</option></select>`
    : `<select class="drum-arm-sel" onchange="updateDrumProp('${drum.id}','arm',this.value)">
    <option value="L" ${drum.arm==='L'?'selected':''}>L</option>
    <option value="R" ${drum.arm==='R'?'selected':''}>R</option>
  </select>`}
  ${isKick
    ? `<span class="drum-reach-badge"></span>`
    : `<span class="drum-reach-badge" title="이 위치에서 왼팔/오른팔로 실제로 자연스럽게 닿는지">
    <span class="reach-l ${drum._reachL === false ? 'bad' : 'ok'}">L</span><span class="reach-r ${drum._reachR === false ? 'bad' : 'ok'}">R</span>
  </span>`}
  <input class="drum-pos-inp" type="number" step="0.01" title="X (앞)" value="${drum.pos.x.toFixed(2)}"
    onchange="updateDrumPos('${drum.id}','x',+this.value)">
  <input class="drum-pos-inp" type="number" step="0.01" title="Y (좌우)" value="${drum.pos.y.toFixed(2)}"
    onchange="updateDrumPos('${drum.id}','y',+this.value)">
  <input class="drum-pos-inp" type="number" step="0.01" title="Z (높이)" value="${drum.pos.z.toFixed(2)}"
    onchange="updateDrumPos('${drum.id}','z',+this.value)">
  <div class="drum-vel-preview">
    <button class="dvp-btn dvp-soft"   onclick="previewDrumHit('${drum.id}','soft')"   title="약 미리보기 (TCP 경로 표시)">약</button>
    <button class="dvp-btn dvp-medium" onclick="previewDrumHit('${drum.id}','medium')" title="중 미리보기 (TCP 경로 표시)">중</button>
    <button class="dvp-btn dvp-hard"   onclick="previewDrumHit('${drum.id}','hard')"   title="강 미리보기 (TCP 경로 표시)">강</button>
  </div>
  <span class="drum-autogen-chk"></span>
  <button class="drum-del-btn" onclick="deleteDrum('${drum.id}')" title="삭제">✕</button>
</div>`;
  }).join('');
}


window.updateDrumProp = function (id, prop, val) {
  const drum = drumKit.find(d => d.id === id);
  if (!drum) return;
  drum[prop] = val;
  // 타입 ↔ kick 전환 시 arm 정합성 보정 (kick은 팔 미배정)
  if (prop === 'type') {
    if (val === 'kick') drum.arm = 'kick';
    else if (drum.arm !== 'L' && drum.arm !== 'R') drum.arm = drum.pos.y >= 0 ? 'L' : 'R';
  }
  saveDrumKit();
  rebuildDrumSpheres();
  renderDrumList();
  renderTimeline();
};

window.updateDrumPos = function (id, axis, val) {
  const drum = drumKit.find(d => d.id === id);
  if (!drum || !isFinite(val)) return;
  drum.pos[axis] = val;

  const grp = drumGroups[id];
  if (grp) grp.position.set(drum.pos.x, drum.pos.y, drum.pos.z);

  _updateDrumReachVisual(drum, true);   // 전체 재렌더 없이 도달 불가 시 드럼 색만 갱신

  // 소수점 2자리로 표시 정규화
  const item = document.querySelector(`.drum-row[data-id="${id}"]`);
  if (item) {
    const inps    = item.querySelectorAll('.drum-pos-inp');
    const axisIdx = { x:0, y:1, z:2 }[axis];
    if (inps[axisIdx]) inps[axisIdx].value = val.toFixed(2);
  }
  saveDrumKit();
  _checkTemplateDirty();
};

window.addDrum = function () {
  const id = 'd' + nextDrumId++;
  drumKit.push({ id, name:`드럼 ${nextDrumId}`, type:'snare', arm:'L', pos:{x:0.50, y:0.20, z:0.46} });
  saveDrumKit();
  rebuildDrumSpheres();
  renderDrumList();
  renderTimeline();
};

window.deleteDrum = function (id) {
  drumKit         = drumKit.filter(d => d.id !== id);
  timelineEvents  = timelineEvents.filter(e => e.drumId !== id);
  saveDrumKit();
  rebuildDrumSpheres();
  renderDrumList();
  renderTimeline();
};

// ═══════════════════════════════════════════════════════════════
//  패턴 적용
// ═══════════════════════════════════════════════════════════════
window.applyPattern = function () {
  bpm         = parseInt(document.getElementById('bpm-inp').value)  || 120;
  beatsPerBar = parseInt(document.getElementById('meter-sel').value) || 4;
  totalBars   = parseInt(document.getElementById('bars-inp').value)  || 4;

  _playKFs = buildFinalKeyframes();
  _playDur = _playKFs.totalTime;
  document.getElementById('scrubber').max = _playDur;

  renderTimeline();
  updateTLInfo();
  const kfCount = (_playKFs.L?.length ?? 0) + (_playKFs.R?.length ?? 0);
  setStatus(`적용됨 — ${kfCount}개 KF · ${_playDur.toFixed(1)}s`);
  stopAnim();
  if (timelineEvents.length) playAnim();
};

document.getElementById('bpm-inp').addEventListener('change', () => {
  // 박자·마디 핸들러와 동일하게 전역 bpm을 즉시 커밋 — "적용" 없이 BPM만 바꿔도
  // 재생·WAV·YAML이 올바른 템포를 쓰도록(이전엔 라벨만 바뀌고 bpm은 그대로였음)
  bpm = parseInt(document.getElementById('bpm-inp').value) || 120;
  updateTLInfo(); saveSettings();
});

// 스트로크 튜닝 슬라이더 공통 rebuild
function _rebuildStroke() {
  _playKFs = buildFinalKeyframes();
  _playDur  = _playKFs.totalTime;
  if (!isPlaying) renderFrame(pauseOffset);
}

// 스트로크 튜닝: 슬라이더 ↔ 숫자 입력 연동 헬퍼
function _bindStrokePair(sliderId, numId, setter, min, max) {
  const slider = document.getElementById(sliderId);
  const num    = document.getElementById(numId);
  slider.addEventListener('input', function () {
    const v = parseFloat(this.value);
    setter(v);
    num.value = v.toFixed(2);
    _rebuildStroke();
  });
  num.addEventListener('change', function () {
    const v = Math.min(max, Math.max(min, parseFloat(this.value) || 0));
    setter(v);
    slider.value = v;
    this.value   = v.toFixed(2);
    _rebuildStroke();
  });
}
_bindStrokePair('stick-j7-slider',  'stick-j7-val',  v => { stickJ7Offset  = v; saveSettings(); }, -0.6, 0.6);
_bindStrokePair('contact-boost-slider', 'contact-boost-val', v => { contactBoostMax = v; saveSettings(); }, 0.3, 1.5);
document.getElementById('bpm-inp').addEventListener('input', () => saveSettings());
document.getElementById('meter-sel').addEventListener('change', () => {
  beatsPerBar = parseInt(document.getElementById('meter-sel').value) || 4;
  renderTimeline(); updateTLInfo(); saveSettings();
});
document.getElementById('bars-inp').addEventListener('change', () => {
  totalBars = parseInt(document.getElementById('bars-inp').value) || 4;
  renderTimeline(); updateTLInfo(); saveSettings();
});
document.getElementById('grid-sel').addEventListener('change', () => renderTimeline());

// ═══════════════════════════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════════════════════════
function setStatus(msg) {
  const el = document.getElementById('status-span');
  if (el) el.textContent = msg;
}

function updateTLInfo() {
  const b  = parseInt(document.getElementById('bpm-inp').value)    || bpm;
  const bp = parseInt(document.getElementById('meter-sel').value)  || beatsPerBar;
  const tb = parseInt(document.getElementById('bars-inp').value)   || totalBars;
  const el = document.getElementById('tl-info');
  if (el) el.textContent = `${tb}마디 · ${b}BPM · ${bp}/4박자`;
}

// ═══════════════════════════════════════════════════════════════
//  초기화
// ═══════════════════════════════════════════════════════════════
loadDrumKit();
let _resizeTimer = null;
window.addEventListener('resize', () => {
  // 리사이즈 드래그 중 연속 발생하는 이벤트마다 전체 레인을 재빌드하면 버벅이므로
  // 마지막 이벤트로부터 150ms 뒤 한 번만 다시 그린다.
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => renderTimeline(), 150);
});

// 인트로/아웃트로 체크박스·인트로 스타일 변경 → 재생 타임라인 즉시 갱신
['chk-intro', 'chk-outro', 'intro-style-sel'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => {
    _playKFs = buildFinalKeyframes();
    _playDur = _playKFs.totalTime;
    document.getElementById('scrubber').max = _playDur;
    document.getElementById('scrubber').value = 0;
    pauseOffset = 0;
    const inclIntro = document.getElementById('chk-intro')?.checked ?? true;
    const inclOutro = document.getElementById('chk-outro')?.checked ?? true;
    const label = [inclIntro && '인트로', inclOutro && '아웃트로'].filter(Boolean).join('+');
    setStatus(`타임라인 갱신: ${label || '드럼 본편만'} (${_playDur.toFixed(1)}s)`);
    saveSettings();
  });
});
updateFK({ ...NEUTRAL });
renderPresetDropdown();
renderSkinPresets();
rebuildDrumSpheres();
renderDrumList();
loadSettings();   // BPM·박자·마디·체크박스·스트로크 오프셋 복원
loadTimeline();   // 타임라인 이벤트 복원
renderTimeline();
updateTLInfo();
_autoLoadDefaultSong();
if (timelineEvents.length) {
  _playKFs = buildFinalKeyframes();
  _playDur  = _playKFs.totalTime;
  document.getElementById('scrubber').max = _playDur;
}
setStatus('드럼 키트 로드됨 — 타임라인 클릭으로 배치 · 뷰포트 드래그로 위치 이동');
