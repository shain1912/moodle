import { api, getMe, logout, fmtTime, toast, escapeHtml } from './api.js';

const me = await getMe();
if (!me) location.href = '/';

// 관리자가 열면 "미리보기" 모드 (진도 저장 안 함, 로그아웃 대신 관리자로 복귀)
const isPreview = me && me.role === 'teacher';

if (isPreview) {
  document.getElementById('who-name').textContent = '👁 관리자 미리보기';
  const back = document.getElementById('btn-logout');
  back.textContent = '관리자로';
  back.onclick = () => { location.href = '/admin.html'; };
} else {
  document.getElementById('who-name').textContent = me.studentNo ? `${me.name} (${me.studentNo})` : me.name;
  document.getElementById('btn-logout').onclick = logout;
}

const viewList = document.getElementById('view-list');
const viewPlayer = document.getElementById('view-player');
const listEl = document.getElementById('lecture-list');
const emptyEl = document.getElementById('empty');

let threshold = 90;

// ───────────────────────── 목록 (섹션 그룹화 + 접기/펼치기) ─────────────────────────
const SEC_LS = 'secopen_';
const secOpen = (section, def) => {
  const v = localStorage.getItem(SEC_LS + section);
  return v === null ? def : v === '1';
};
const setSecOpen = (section, open) => { try { localStorage.setItem(SEC_LS + section, open ? '1' : '0'); } catch {} };

function renderItem(l, idx) {
  const p = l.progress;
  const pct = p ? Math.round(p.percent) : 0;
  const done = p?.completed;
  const badge = done
    ? '<span class="badge done">완료</span>'
    : (pct > 0 ? `<span class="badge prog">${pct}%</span>` : '<span class="badge none">미시청</span>');
  const item = document.createElement('div');
  item.className = 'lecture-item';
  item.innerHTML = `
    <div class="idx">${idx}</div>
    <div class="body">
      <div class="t">${escapeHtml(l.title)}</div>
      <div class="d">${escapeHtml(l.description || '')} ${l.duration_seconds ? '· ' + fmtTime(l.duration_seconds) : ''}</div>
      <div class="bar ${done ? 'ok' : ''}"><span style="width:${pct}%"></span></div>
    </div>
    <div class="meta">${badge}</div>`;
  item.onclick = () => openPlayer(l.id);
  return item;
}

async function loadList() {
  const { lectures } = await api('/api/lectures');
  listEl.innerHTML = '';
  if (!lectures.length) { emptyEl.classList.remove('hidden'); return; }
  emptyEl.classList.add('hidden');

  // 전체 요약
  const totalPct = lectures.reduce((a, l) => a + (l.progress ? Math.round(l.progress.percent) : 0), 0);
  const avg = Math.round(totalPct / lectures.length);
  const doneCount = lectures.filter((l) => l.progress?.completed).length;
  document.getElementById('overall-sub').textContent =
    `전체 ${lectures.length}강 · 완료 ${doneCount}강 · 평균 진도율 ${avg}%`;

  // 섹션 그룹화 (백엔드가 섹션→순서로 이미 정렬)
  const groups = [];
  const gmap = new Map();
  for (const l of lectures) {
    const sec = l.section || '';
    let g = gmap.get(sec);
    if (!g) { g = { section: sec, items: [] }; gmap.set(sec, g); groups.push(g); }
    g.items.push(l);
  }

  // 의미있는 섹션이 2개 미만이면 평면 목록(폴백)
  const useAccordion = groups.filter((g) => g.section).length >= 2;
  let n = 0;
  if (!useAccordion) {
    for (const l of lectures) listEl.appendChild(renderItem(l, ++n));
    return;
  }

  // 펼침/접힘: 사용자가 토글한 적 없으면 '미완료 섹션은 펼치고 완료 섹션은 접기'
  let firstOpenDone = false;
  for (const g of groups) {
    const done = g.items.filter((l) => l.progress?.completed).length;
    const gPct = Math.round(g.items.reduce((a, l) => a + (l.progress ? l.progress.percent : 0), 0) / g.items.length);
    const allDone = done === g.items.length;
    const open = secOpen(g.section, !allDone);

    const block = document.createElement('div');
    block.className = 'section-block' + (open ? ' open' : '');

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'section-head';
    header.innerHTML = `
      <span class="chev">▸</span>
      <span class="sec-name">${escapeHtml(g.section || '기타')}</span>
      <span class="sec-meta">${done}/${g.items.length} 완료 · 평균 ${gPct}%</span>`;

    const body = document.createElement('div');
    body.className = 'section-body';
    g.items.forEach((l) => body.appendChild(renderItem(l, ++n)));

    header.onclick = () => {
      const nowOpen = !block.classList.contains('open');
      block.classList.toggle('open', nowOpen);
      setSecOpen(g.section, nowOpen);
    };

    block.appendChild(header);
    block.appendChild(body);
    listEl.appendChild(block);
    firstOpenDone = firstOpenDone || open;
  }

  // 전부 접혀 있으면(모두 완료한 경우 등) 첫 섹션은 펼쳐서 보여줌
  if (!firstOpenDone && listEl.firstElementChild) {
    listEl.firstElementChild.classList.add('open');
  }
}

// ───────────────────────── 플레이어 + 진도추적 ─────────────────────────
const video = document.getElementById('video');
let current = null;            // { id }
let watchedSet = new Set();    // 실제로 본 정수 초(이 기기 로컬 + 서버 합집합)
let pendingDelta = new Set();  // 아직 서버에 안 보낸 새 초
let isSeeking = false;
let syncTimer = null;
let metaHandler = null;        // loadedmetadata 리스너 참조(누수 방지)

function lsKey(id) { return `watched_${id}`; }
function loadWatchedFromLS(id) {
  const s = new Set();
  try {
    const raw = localStorage.getItem(lsKey(id));
    if (raw) JSON.parse(raw).forEach((x) => s.add(x));
  } catch {}
  return s;
}
function saveWatchedToLS(id) {
  try { localStorage.setItem(lsKey(id), JSON.stringify([...watchedSet])); } catch {}
}

function currentDuration() {
  return (isFinite(video.duration) && video.duration > 0) ? video.duration : 0;
}

function updateReadout() {
  const dur = currentDuration();
  const watched = watchedSet.size;
  const pct = dur > 0 ? Math.min(100, (watched / dur) * 100) : 0;
  const rpct = Math.round(pct * 10) / 10;
  document.getElementById('p-percent').textContent = Math.round(rpct);
  document.getElementById('p-watched').textContent = fmtTime(watched);
  document.getElementById('p-duration').textContent = dur > 0 ? fmtTime(dur) : '-';
  const bar = document.querySelector('#p-bar');
  bar.classList.toggle('ok', rpct >= threshold);
  bar.firstElementChild.style.width = rpct + '%';
  const status = document.getElementById('p-status');
  status.textContent = rpct >= threshold ? '✅ 완료 인정' : `완료까지 ${Math.max(0, Math.ceil(threshold - rpct))}% 남음`;
}

async function syncProgress() {
  if (isPreview) return;           // 미리보기(관리자)는 진도 저장 안 함
  const id = current?.id;          // 호출 시점의 강의 ID 고정(전환 레이스 방지)
  if (!id || pendingDelta.size === 0) return;
  const sent = [...pendingDelta];
  pendingDelta.clear();
  saveWatchedToLS(id);
  try {
    await api(`/api/progress/${id}`, {
      method: 'POST',
      body: { newSeconds: sent, lastPosition: video.currentTime || 0, duration: currentDuration() },
    });
  } catch {
    // 실패 시 보낸 델타를 되돌려 다음 주기에 재시도
    sent.forEach((s) => pendingDelta.add(s));
  }
}

video.addEventListener('seeking', () => { isSeeking = true; });
video.addEventListener('seeked', () => { isSeeking = false; });

video.addEventListener('timeupdate', () => {
  if (video.paused || isSeeking) return;
  const dur = currentDuration();
  const sec = Math.floor(video.currentTime);
  if (sec >= 0 && (dur === 0 || sec < dur) && !watchedSet.has(sec)) {
    watchedSet.add(sec);
    pendingDelta.add(sec);
  }
  updateReadout();
});

video.addEventListener('pause', syncProgress);
video.addEventListener('ended', syncProgress);
// 페이지 단발성 사용(로그아웃/새로고침 시 컨텍스트 파기)이라 별도 정리 불필요한 모듈 레벨 리스너
document.addEventListener('visibilitychange', () => { if (document.hidden) syncProgress(); });
window.addEventListener('beforeunload', () => {
  const id = current?.id;
  if (id && pendingDelta.size) {
    saveWatchedToLS(id);
    navigator.sendBeacon?.(
      `/api/progress/${id}`,
      new Blob([JSON.stringify({ newSeconds: [...pendingDelta], lastPosition: video.currentTime || 0, duration: currentDuration() })],
        { type: 'application/json' })
    );
  }
});

async function openPlayer(id) {
  let res;
  try { res = await api(`/api/lectures/${id}/play`); }
  catch (e) { toast(e.message, 'error'); return; }

  current = { id };

  // 로컬(이 기기) + 서버(다른 기기 포함) 실제 시청 구간의 합집합
  const localSet = loadWatchedFromLS(id);
  const serverSet = new Set(Array.isArray(res.progress?.watched_set) ? res.progress.watched_set : []);
  watchedSet = new Set([...localSet, ...serverSet]);
  // 로컬엔 있는데 서버엔 없는(미동기화) 초는 다음 sync에 올림
  pendingDelta = new Set([...localSet].filter((s) => !serverSet.has(s)));

  document.getElementById('p-title').textContent = res.lecture.title;
  document.getElementById('p-desc').textContent = res.lecture.description || '';
  document.getElementById('p-threshold').textContent = `시청 ${threshold}% 이상`;

  // 이전 loadedmetadata 리스너가 남아있으면 제거(빠른 강의 전환 시 누수 방지)
  if (metaHandler) video.removeEventListener('loadedmetadata', metaHandler);
  const resumeAt = Number(res.progress?.last_position) || 0;
  metaHandler = () => {
    video.removeEventListener('loadedmetadata', metaHandler);
    metaHandler = null;
    if (isFinite(video.duration) && resumeAt > 5 && resumeAt < video.duration - 5) {
      video.currentTime = resumeAt;
      toast(`${fmtTime(resumeAt)} 부터 이어서 재생합니다.`, 'ok');
    }
    updateReadout();
  };
  video.addEventListener('loadedmetadata', metaHandler);

  video.src = res.url;
  viewList.classList.add('hidden');
  viewPlayer.classList.remove('hidden');
  updateReadout();

  clearInterval(syncTimer);
  syncTimer = setInterval(syncProgress, 5000);
  window.scrollTo(0, 0);
}

async function closePlayer() {
  clearInterval(syncTimer);
  await syncProgress();
  if (metaHandler) { video.removeEventListener('loadedmetadata', metaHandler); metaHandler = null; }
  video.pause();
  video.removeAttribute('src');
  video.load();
  current = null;
  viewPlayer.classList.add('hidden');
  viewList.classList.remove('hidden');
  try { await loadList(); } catch (e) { toast('목록을 새로고침하지 못했습니다.', 'error'); }
}

document.getElementById('btn-back').onclick = closePlayer;

// 시작
try {
  const cfg = await api('/api/public-config');
  if (cfg?.completionThreshold) threshold = cfg.completionThreshold;
} catch {}
try {
  await loadList();
} catch (e) {
  toast('강의 목록을 불러올 수 없습니다. 새로고침 해주세요.', 'error');
  document.getElementById('overall-sub').textContent = '강의 목록을 불러오지 못했습니다.';
}
