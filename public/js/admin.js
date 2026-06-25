import { api, getMe, logout, fmtTime, fmtSize, toast, escapeHtml } from './api.js';

const me = await getMe();
if (!me) location.href = '/';
else if (me.role !== 'teacher') location.href = '/student.html';

document.getElementById('who-name').textContent = me.orgName ? `${me.name} · ${me.orgName}` : me.name;
document.getElementById('btn-logout').onclick = logout;

// ───────────────────────── 탭 ─────────────────────────
const tabs = {
  dash: { btn: 'tab-dash', panel: 'panel-dash', load: loadDashboard },
  lec: { btn: 'tab-lec', panel: 'panel-lec', load: loadLectures },
  stu: { btn: 'tab-stu', panel: 'panel-stu', load: loadStudents },
  mission: { btn: 'tab-mission', panel: 'panel-mission', load: loadMissions },
};
function switchTab(key) {
  for (const [k, t] of Object.entries(tabs)) {
    document.getElementById(t.btn).classList.toggle('active', k === key);
    document.getElementById(t.panel).classList.toggle('hidden', k !== key);
  }
  tabs[key].load();
}
for (const [k, t] of Object.entries(tabs)) {
  document.getElementById(t.btn).onclick = () => switchTab(k);
}

// ───────────────────────── 진도 대시보드 ─────────────────────────
document.getElementById('btn-refresh-dash').onclick = loadDashboard;

async function loadDashboard() {
  const { lectures, rows, threshold } = await api('/api/admin/dashboard');
  const head = document.getElementById('dash-head');
  const body = document.getElementById('dash-body');

  const doneStudents = rows.filter((r) => r.allDone).length;
  document.getElementById('dash-sub').textContent =
    `학생 ${rows.length}명 · 강의 ${lectures.length}강 · 전체이수 ${doneStudents}명 · 완료기준 ${threshold}%`;

  head.innerHTML = '<th>팀</th><th>이름</th>' +
    lectures.map((l) => `<th class="num" title="${escapeHtml(l.title)}">${escapeHtml(trunc(l.title, 14))}</th>`).join('') +
    '<th class="num">평균%</th><th class="num">완료</th><th class="num">이수</th>';

  // 학생 0명이면 헤더만 있는 CSV가 받아지므로 다운로드 버튼 비활성화
  const csvBtn = document.getElementById('btn-csv');
  csvBtn.classList.toggle('hidden', rows.length === 0);

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${lectures.length + 5}" class="muted" style="text-align:center;padding:30px">등록된 학생이 없습니다. ‘학생 명단’ 탭에서 추가하세요.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((r) => {
    const cells = r.cells.map((c) => {
      const cls = c.completed ? 'o' : (c.percent > 0 ? '' : 'x');
      const txt = c.completed ? 'O' : (c.percent > 0 ? Math.round(c.percent) : '·');
      return `<td class="num"><span class="pill ${cls}">${txt}</span></td>`;
    }).join('');
    return `<tr>
      <td>${escapeHtml(r.student.team || '-')}</td>
      <td>${escapeHtml(r.student.name)}${r.student.active ? '' : ' <span class="muted small">(비활성)</span>'}</td>
      ${cells}
      <td class="num"><b>${r.avg}</b></td>
      <td class="num">${r.completedCount}/${lectures.length}</td>
      <td class="num"><span class="pill ${r.allDone ? 'o' : 'x'}">${r.allDone ? 'O' : 'X'}</span></td>
    </tr>`;
  }).join('');
}
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

// ───────────────────────── 강의 관리 ─────────────────────────
const upFile = document.getElementById('up-file');
const upInfo = document.getElementById('up-fileinfo');
const upMsg = document.getElementById('up-msg');
const upProg = document.getElementById('up-progress');

upFile.addEventListener('change', () => {
  const f = upFile.files[0];
  upInfo.textContent = f ? `${f.name} · ${fmtSize(f.size)}` : '';
});

document.getElementById('btn-upload').onclick = uploadLecture;

function getVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    let done = false;
    const finish = (d) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(isFinite(d) && d > 0 ? d : 0);
    };
    v.onloadedmetadata = () => finish(v.duration);
    v.onerror = () => finish(0);
    setTimeout(() => finish(v.duration), 8000); // 메타데이터 지연 대비 타임아웃
    v.src = url;
  });
}

// presigned PUT URL로 R2에 직접 업로드 (진행률 표시)
function xhrPut(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`업로드 실패 (${xhr.status}) ${xhr.responseText || ''}`));
    };
    xhr.onerror = () => reject(new Error('네트워크 오류로 업로드에 실패했습니다.'));
    xhr.send(file);
  });
}

async function uploadLecture() {
  const title = document.getElementById('up-title').value.trim();
  const description = document.getElementById('up-desc').value.trim();
  const file = upFile.files[0];
  upMsg.className = 'msg';
  upMsg.textContent = '';

  if (!title) { upMsg.className = 'msg error'; upMsg.textContent = '강의 제목을 입력하세요.'; return; }
  if (!file) { upMsg.className = 'msg error'; upMsg.textContent = '영상 파일을 선택하세요.'; return; }

  const btn = document.getElementById('btn-upload');
  btn.disabled = true;
  upProg.classList.remove('hidden');
  const bar = upProg.firstElementChild;
  if (bar) bar.style.width = '0%';
  const setBar = (frac) => { if (bar) bar.style.width = Math.round(frac * 100) + '%'; };

  try {
    upMsg.textContent = '영상 정보 분석 중…';
    const duration = await getVideoDuration(file);
    if (!duration) {
      toast('영상 길이를 읽지 못했습니다. 학생이 처음 재생할 때 자동 보정됩니다.', 'error', 5000);
    }

    upMsg.textContent = '업로드 준비 중…';
    const { key, url } = await api('/api/lectures/upload-url', { method: 'POST', body: { filename: file.name } });

    upMsg.textContent = '업로드 중… (대용량은 시간이 걸립니다)';
    await xhrPut(url, file, setBar);

    upMsg.textContent = '강의 등록 중…';
    await api('/api/lectures', { method: 'POST', body: {
      title, description, key,
      durationSeconds: duration, sizeBytes: file.size, mimeType: file.type || 'video/mp4',
    }});
    finishUpload(btn);
  } catch (e) {
    upMsg.className = 'msg error';
    upMsg.textContent = e.message;
    btn.disabled = false;
    upProg.classList.add('hidden');
  }
}

function finishUpload(btn) {
  toast('강의가 업로드되었습니다.', 'ok');
  document.getElementById('up-title').value = '';
  document.getElementById('up-desc').value = '';
  upFile.value = '';
  upInfo.textContent = '';
  upMsg.className = 'msg ok';
  upMsg.textContent = '완료!';
  btn.disabled = false;
  setTimeout(() => { upProg.classList.add('hidden'); upMsg.textContent = ''; }, 1500);
  loadLectures();
}

async function loadLectures() {
  const { lectures } = await api('/api/lectures');
  const list = document.getElementById('lec-list');
  const empty = document.getElementById('lec-empty');
  document.getElementById('lec-count').textContent = lectures.length ? `(${lectures.length})` : '';
  list.innerHTML = '';
  if (!lectures.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  lectures.forEach((l, i) => {
    const item = document.createElement('div');
    item.className = 'lecture-item';
    item.style.cursor = 'default';
    const secTag = l.section ? `<span class="badge prog" style="margin-right:6px">${escapeHtml(l.section)}</span>` : '';
    item.innerHTML = `
      <div class="idx">${i + 1}</div>
      <div class="body">
        <div class="t">${secTag}${escapeHtml(l.title)}</div>
        <div class="d">${l.duration_seconds ? fmtTime(l.duration_seconds) : '-'} · ${fmtSize(l.size_bytes)}</div>
      </div>
      <div class="row">
        <button class="btn sm ghost" data-sec title="섹션 변경">섹션</button>
        <button class="btn sm ghost" data-up title="위로">▲</button>
        <button class="btn sm ghost" data-down title="아래로">▼</button>
        <button class="btn sm danger" data-del title="이 학교 목록에서 내리기">내리기</button>
      </div>`;
    item.querySelector('[data-sec]').onclick = () => editSection(l);
    item.querySelector('[data-up]').onclick = () => reorder(lectures, i, -1);
    item.querySelector('[data-down]').onclick = () => reorder(lectures, i, +1);
    item.querySelector('[data-del]').onclick = () => delLecture(l);
    list.appendChild(item);
  });
}

async function editSection(l) {
  const section = prompt(`"${l.title}" 강의의 섹션 이름을 입력하세요. (비우면 미분류)`, l.section || '');
  if (section === null) return;
  try {
    await api(`/api/lectures/${l.id}`, { method: 'PATCH', body: { section: section.trim() } });
    toast('섹션이 변경되었습니다.', 'ok');
    loadLectures();
  } catch (e) { toast(e.message, 'error'); }
}

async function reorder(lectures, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= lectures.length) return;
  const a = lectures[i], b = lectures[j];
  await api(`/api/lectures/${a.id}`, { method: 'PATCH', body: { order_index: b.order_index } });
  await api(`/api/lectures/${b.id}`, { method: 'PATCH', body: { order_index: a.order_index } });
  loadLectures();
}

async function delLecture(l) {
  if (!confirm(`"${l.title}" 강의를 이 학교 목록에서 내릴까요?\n· 우리 학교 학생들의 이 강의 진도 기록은 삭제됩니다.\n· 영상 원본은 보존됩니다(다른 학교가 사용할 수 있음).`)) return;
  try {
    await api(`/api/lectures/${l.id}`, { method: 'DELETE' });
    toast('목록에서 내렸습니다.', 'ok');
    loadLectures();
  } catch (e) { toast(e.message, 'error'); }
}

// ───────────────────────── 학생 명단 ─────────────────────────
document.getElementById('btn-refresh-stu').onclick = loadStudents;

document.getElementById('btn-add-stu').onclick = async () => {
  const name = document.getElementById('stu-name').value.trim();
  const team = document.getElementById('stu-team').value.trim();
  const pin = document.getElementById('stu-pin').value.trim();
  const msg = document.getElementById('stu-msg');
  msg.className = 'msg';
  msg.textContent = '';
  if (!name) { msg.className = 'msg error'; msg.textContent = '이름은 필수입니다.'; return; }
  try {
    await api('/api/admin/students', { method: 'POST', body: { name, team, pin } });
    msg.className = 'msg ok';
    msg.textContent = '등록되었습니다.';
    document.getElementById('stu-name').value = '';
    document.getElementById('stu-team').value = '';
    document.getElementById('stu-pin').value = '';
    loadStudents();
  } catch (e) { msg.className = 'msg error'; msg.textContent = e.message; }
};

document.getElementById('btn-bulk').onclick = async () => {
  const text = document.getElementById('bulk-text').value;
  const msg = document.getElementById('bulk-msg');
  msg.className = 'msg';
  msg.textContent = '';
  if (!text.trim()) { msg.className = 'msg error'; msg.textContent = '내용을 입력하세요.'; return; }
  try {
    const { count } = await api('/api/admin/students/bulk', { method: 'POST', body: { text } });
    msg.className = 'msg ok';
    msg.textContent = `${count}명 등록/갱신되었습니다.`;
    document.getElementById('bulk-text').value = '';
    loadStudents();
  } catch (e) { msg.className = 'msg error'; msg.textContent = e.message; }
};

async function loadStudents() {
  const { students } = await api('/api/admin/students');
  const body = document.getElementById('stu-body');
  document.getElementById('stu-count').textContent = students.length ? `(${students.length})` : '';
  if (!students.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">등록된 학생이 없습니다.</td></tr>';
    return;
  }
  body.innerHTML = '';
  students.forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s.team || '-')}</td>
      <td>${escapeHtml(s.name)}</td>
      <td class="num">${s.pin ? '🔒' : '-'}</td>
      <td class="num"><span class="pill ${s.active ? 'o' : 'x'}">${s.active ? '활성' : '비활성'}</span></td>
      <td class="num row" style="justify-content:flex-end;gap:6px">
        <button class="btn sm ghost" data-pin>PIN</button>
        <button class="btn sm ghost" data-toggle>${s.active ? '비활성' : '활성'}</button>
        <button class="btn sm danger" data-del>삭제</button>
      </td>`;
    // 액션 핸들러: 버튼 비활성화 + try/catch 로 더블클릭/오류 처리
    const guard = (btn, fn) => async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      try { await fn(); }
      catch (e) { toast(e.message, 'error'); }
      finally { btn.disabled = false; }
    };
    const pinBtn = tr.querySelector('[data-pin]');
    pinBtn.onclick = guard(pinBtn, async () => {
      const pin = prompt(`${s.name} 학생의 PIN을 입력하세요. (비우면 PIN 해제 — 이름만으로 로그인)`, s.pin || '');
      if (pin === null) return;
      await api(`/api/admin/students/${s.id}`, { method: 'PATCH', body: { pin: pin.trim() } });
      toast('PIN이 변경되었습니다.', 'ok');
      await loadStudents();
    });
    const toggleBtn = tr.querySelector('[data-toggle]');
    toggleBtn.onclick = guard(toggleBtn, async () => {
      await api(`/api/admin/students/${s.id}`, { method: 'PATCH', body: { active: !s.active } });
      await loadStudents();
    });
    const delBtn = tr.querySelector('[data-del]');
    delBtn.onclick = guard(delBtn, async () => {
      if (!confirm(`${s.name}${s.team ? ' (' + s.team + ')' : ''} 학생을 삭제할까요? 진도 기록도 함께 삭제됩니다.`)) return;
      await api(`/api/admin/students/${s.id}`, { method: 'DELETE' });
      toast('삭제되었습니다.', 'ok');
      await loadStudents();
    });
    body.appendChild(tr);
  });
}

// ───────────────────────── 미션 공지 관리 ─────────────────────────
let editingMissionId = null;

const mEls = {
  round: () => document.getElementById('m-round'),
  week: () => document.getElementById('m-week'),
  title: () => document.getElementById('m-title'),
  body: () => document.getElementById('m-body'),
  due: () => document.getElementById('m-due'),
  email: () => document.getElementById('m-email'),
  msg: () => document.getElementById('m-msg'),
  cancel: () => document.getElementById('btn-m-cancel'),
};

function resetMissionForm() {
  editingMissionId = null;
  mEls.round().value = '1';
  mEls.week().value = '';
  mEls.title().value = '';
  mEls.body().value = '';
  mEls.due().value = '';
  mEls.email().value = 'sh.cho@pusan.ac.kr';
  mEls.cancel().classList.add('hidden');
  document.getElementById('btn-m-save').textContent = '등록 / 수정';
}

function fillMissionForm(m) {
  editingMissionId = m.id;
  mEls.round().value = String(m.round || 1);
  mEls.week().value = m.week_label || '';
  mEls.title().value = m.title || '';
  mEls.body().value = m.body || '';
  mEls.due().value = m.due_at ? new Date(m.due_at).toISOString().slice(0, 10) : '';
  mEls.email().value = m.submit_email || '';
  mEls.cancel().classList.remove('hidden');
  document.getElementById('btn-m-save').textContent = '수정 저장';
  document.getElementById('m-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.getElementById('btn-m-cancel').onclick = resetMissionForm;
document.getElementById('btn-m-refresh').onclick = loadMissions;

document.getElementById('btn-m-save').onclick = async () => {
  const round = parseInt(mEls.round().value, 10) || 1;
  const week_label = mEls.week().value.trim() || `${round}주차`;
  const title = mEls.title().value.trim();
  const body = mEls.body().value;
  const due_at = mEls.due().value || null;
  const submit_email = mEls.email().value.trim() || null;
  const msg = mEls.msg();
  msg.className = 'msg';
  msg.textContent = '';
  if (!title) { msg.className = 'msg error'; msg.textContent = '제목은 필수입니다.'; return; }
  const payload = { round, week_label, title, body, due_at, submit_email };
  try {
    if (editingMissionId) {
      await api(`/api/admin/missions/${editingMissionId}`, { method: 'PATCH', body: payload });
      toast('미션이 수정되었습니다.', 'ok');
    } else {
      await api('/api/admin/missions', { method: 'POST', body: payload });
      toast('미션이 등록되었습니다.', 'ok');
    }
    resetMissionForm();
    loadMissions();
  } catch (e) { msg.className = 'msg error'; msg.textContent = e.message; }
};

async function loadMissions() {
  const { missions } = await api('/api/admin/missions');
  const list = document.getElementById('m-list');
  const empty = document.getElementById('m-empty');
  document.getElementById('m-count').textContent = missions.length ? `(${missions.length})` : '';
  list.innerHTML = '';
  if (!missions.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  missions.forEach((m) => {
    const item = document.createElement('div');
    item.className = 'lecture-item';
    item.style.cursor = 'default';
    const due = m.due_at ? ' · 마감 ' + new Date(m.due_at).toISOString().slice(0, 10) : '';
    const stateBadge = m.active
      ? '<span class="badge prog" style="margin-right:6px">활성</span>'
      : '<span class="badge none" style="margin-right:6px">비활성</span>';
    item.innerHTML = `
      <div class="idx">${escapeHtml(m.week_label || (m.round + '주차'))}</div>
      <div class="body">
        <div class="t">${stateBadge}${escapeHtml(m.title)}</div>
        <div class="d">${escapeHtml((m.body || '').slice(0, 60))}${(m.body || '').length > 60 ? '…' : ''}${due}</div>
      </div>
      <div class="row">
        <button class="btn sm ghost" data-edit>수정</button>
        <button class="btn sm ghost" data-toggle>${m.active ? '비활성' : '활성'}</button>
        <button class="btn sm danger" data-del>삭제</button>
      </div>`;
    const guard = (btn, fn) => async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; }
    };
    item.querySelector('[data-edit]').onclick = () => fillMissionForm(m);
    const tg = item.querySelector('[data-toggle]');
    tg.onclick = guard(tg, async () => {
      await api(`/api/admin/missions/${m.id}`, { method: 'PATCH', body: { active: !m.active } });
      await loadMissions();
    });
    const del = item.querySelector('[data-del]');
    del.onclick = guard(del, async () => {
      if (!confirm(`"${m.title}" 미션을 삭제할까요?`)) return;
      await api(`/api/admin/missions/${m.id}`, { method: 'DELETE' });
      toast('삭제되었습니다.', 'ok');
      await loadMissions();
    });
    list.appendChild(item);
  });
}

resetMissionForm();

// 시작
switchTab('dash');
