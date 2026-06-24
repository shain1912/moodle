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

// 기본은 '이름만' 로그인. 학교 선택은 서로 다른 소속에 같은 이름이 있을 때만 노출.
formStudent.addEventListener('submit', async (e) => {
  e.preventDefault();
  msgS.className = 'msg';
  msgS.textContent = '';
  const name = document.getElementById('s-name').value;
  const pin = document.getElementById('s-pin').value;
  // 학교 선택칸이 떠 있을 때(동명이인 안내 후)에만 소속을 함께 전송
  const orgSlug = orgWrap.classList.contains('hidden') ? '' : (orgSel.value || '');
  try {
    await api('/api/auth/student/login', { method: 'POST', body: { name, pin, orgSlug } });
    location.href = '/student.html';
  } catch (err) {
    msgS.className = 'msg error';
    msgS.textContent = err.message;
    if (err.data?.needPin) pinWrap.classList.remove('hidden');
    if (err.data?.needOrg) {
      const opts = Array.isArray(err.data.orgs) && err.data.orgs.length ? err.data.orgs : null;
      if (opts) orgSel.innerHTML = opts.map((o) => `<option value="${o.slug}">${o.name}</option>`).join('');
      orgWrap.classList.remove('hidden');
    }
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
