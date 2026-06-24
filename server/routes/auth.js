import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { supabase } from '../supabase.js';
import { setSession, clearSession } from '../auth.js';

export const authRouter = Router();

const strip = (s) => String(s ?? '').replace(/\s/g, '');

// 로그인 시 학교(테넌트) 확정: orgSlug 가 오면 그 학교, 없으면 활성 학교가 정확히 1개일 때만 그 학교.
async function resolveOrg(orgSlug) {
  const q = supabase.from('lms_orgs').select('id,slug,name').eq('active', true);
  const { data, error } = orgSlug ? await q.eq('slug', orgSlug).maybeSingle() : await q;
  if (error) return { error: 'DB 오류: ' + error.message };
  if (orgSlug) {
    if (!data) return { error: '존재하지 않는 학교입니다.' };
    return { org: data };
  }
  const list = data || [];
  if (list.length === 1) return { org: list[0] };
  return { error: '학교를 선택하세요.', needOrg: true };
}

// ── 학생 로그인: (학교 선택) + 이름으로 명단 검증. 학번/ PIN 은 있으면 추가 사용.
authRouter.post('/student/login', async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  const studentNo = String(req.body.studentNo ?? '').trim();
  const pin = String(req.body.pin ?? '').trim();
  const orgSlug = String(req.body.orgSlug ?? '').trim();
  if (!name) return res.status(400).json({ error: '이름을 입력하세요.' });

  const r = await resolveOrg(orgSlug);
  if (r.error) return res.status(r.needOrg ? 400 : 401).json({ error: r.error, needOrg: r.needOrg });
  const org = r.org;

  let student = null;
  if (studentNo) {
    // 학번이 주어지면 학교 내에서 학번+이름으로 검증
    const { data, error } = await supabase
      .from('lms_students').select('*').eq('org_id', org.id).eq('student_no', studentNo).maybeSingle();
    if (error) return res.status(500).json({ error: 'DB 오류: ' + error.message });
    if (!data || !data.active || strip(data.name) !== strip(name)) {
      return res.status(401).json({ error: '학번 또는 이름이 명단과 일치하지 않습니다.' });
    }
    student = data;
  } else {
    // 학교 내에서 이름만으로 로그인 (공백 무시 비교 → "김 봄"="김봄")
    const { data, error } = await supabase
      .from('lms_students').select('*').eq('org_id', org.id).eq('active', true);
    if (error) return res.status(500).json({ error: 'DB 오류: ' + error.message });
    const matches = (data || []).filter((s) => strip(s.name) === strip(name));
    if (matches.length === 0) {
      return res.status(401).json({ error: '명단에 없는 이름입니다. 학교와 이름을 정확히 확인하세요.' });
    }
    if (matches.length > 1) {
      return res.status(409).json({ error: '같은 이름이 여러 명이라 이름만으로 로그인할 수 없습니다. 관리자에게 문의하세요.' });
    }
    student = matches[0];
  }

  if (student.pin) {
    if (!pin) return res.status(401).json({ error: 'PIN을 입력하세요.', needPin: true });
    if (pin !== student.pin) return res.status(401).json({ error: 'PIN이 일치하지 않습니다.', needPin: true });
  }

  setSession(res, {
    role: 'student', sub: student.id, name: student.name, studentNo: student.student_no || null,
    org: org.id, orgSlug: org.slug, orgName: org.name,
  });
  res.json({ ok: true, user: { role: 'student', name: student.name, studentNo: student.student_no || null, orgName: org.name } });
});

// ── 교사(관리자) 로그인: 아이디 + 비밀번호
authRouter.post('/teacher/login', async (req, res) => {
  const username = String(req.body.username ?? '').trim();
  const password = String(req.body.password ?? '');
  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요.' });
  }

  const { data: teacher, error } = await supabase
    .from('lms_teachers').select('*').eq('username', username).maybeSingle();
  if (error) return res.status(500).json({ error: 'DB 오류: ' + error.message });
  if (!teacher) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });

  const ok = await bcrypt.compare(password, teacher.password_hash);
  if (!ok) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });

  // 교사의 소속 학교 정보(표시용)
  let org = null;
  if (teacher.org_id) {
    const { data } = await supabase.from('lms_orgs').select('id,slug,name').eq('id', teacher.org_id).maybeSingle();
    org = data || null;
  }

  setSession(res, {
    role: 'teacher', sub: teacher.id, name: teacher.name, username: teacher.username,
    org: teacher.org_id, orgSlug: org?.slug || null, orgName: org?.name || null,
  });
  res.json({ ok: true, user: { role: 'teacher', name: teacher.name, username: teacher.username, orgName: org?.name || null } });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = req.user;
  res.json({ user: { role: u.role, name: u.name, studentNo: u.studentNo, username: u.username, orgName: u.orgName || null } });
});
