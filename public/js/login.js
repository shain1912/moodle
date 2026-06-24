import { api, getMe } from './api.js';

// 이미 로그인돼 있으면 바로 이동
(async () => {
  const me = await getMe();
  if (me?.role === 'student') location.href = '/student.html';
  else if (me?.role === 'teacher') location.href = '/admin.html';
})();

const tabStudent = document.getElementById('tab-student');
const tabTeacher = document.getElementById('tab-teacher');
const formStudent = document.getElementById('form-student');
const formTeacher = document.getElementById('form-teacher');

function show(which) {
  const isStudent = which === 'student';
  tabStudent.classList.toggle('active', isStudent);
  tabTeacher.classList.toggle('active', !isStudent);
  formStudent.classList.toggle('hidden', !isStudent);
  formTeacher.classList.toggle('hidden', isStudent);
}
tabStudent.onclick = () => show('student');
tabTeacher.onclick = () => show('teacher');

const msgS = document.getElementById('msg-student');
const pinWrap = document.getElementById('pin-wrap');
const orgWrap = document.getElementById('org-wrap');
const orgSel = document.getElementById('s-org');

// 학교 목록 — 2개 이상일 때만 선택 드롭다운 표시(1개면 자동 적용)
(async () => {
  try {
    const { orgs } = await api('/api/orgs');
    if (Array.isArray(orgs) && orgs.length) {
      orgSel.innerHTML = orgs.map((o) => `<option value="${o.slug}">${o.name}</option>`).join('');
      if (orgs.length > 1) orgWrap.classList.remove('hidden');
    }
  } catch { /* 학교 목록 실패 시 단일학교 가정 */ }
})();

formStudent.addEventListener('submit', async (e) => {
  e.preventDefault();
  msgS.className = 'msg';
  msgS.textContent = '';
  const name = document.getElementById('s-name').value;
  const pin = document.getElementById('s-pin').value;
  const orgSlug = orgSel.value || '';
  try {
    await api('/api/auth/student/login', { method: 'POST', body: { name, pin, orgSlug } });
    location.href = '/student.html';
  } catch (err) {
    msgS.className = 'msg error';
    msgS.textContent = err.message;
    if (err.data?.needPin) pinWrap.classList.remove('hidden');
    if (err.data?.needOrg) orgWrap.classList.remove('hidden');
  }
});

const msgT = document.getElementById('msg-teacher');
formTeacher.addEventListener('submit', async (e) => {
  e.preventDefault();
  msgT.className = 'msg';
  msgT.textContent = '';
  const username = document.getElementById('t-user').value;
  const password = document.getElementById('t-pass').value;
  try {
    await api('/api/auth/teacher/login', { method: 'POST', body: { username, password } });
    location.href = '/admin.html';
  } catch (err) {
    msgT.className = 'msg error';
    msgT.textContent = err.message;
  }
});
