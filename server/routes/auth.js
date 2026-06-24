import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { supabase } from '../supabase.js';
import { setSession, clearSession } from '../auth.js';

export const authRouter = Router();

const strip = (s) => String(s ?? '').replace(/\s/g, '');

// ── 학생 로그인: 이름 우선. 학교 선택 없이 전체(활성)에서 이름 검색 →
//   1명이면 바로 로그인. 서로 다른 학교에 같은 이름이 둘 이상일 때만 학교 선택 요구.
authRouter.post('/student/login', async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  const pin = String(req.body.pin ?? '').trim();
  const orgSlug = String(req.body.orgSlug ?? '').trim(); // 동명이인 disambiguation 시에만 전달됨
  if (!name) return res.status(400).json({ error: '이름을 입력하세요.' });

  // 활성 학교 목록
  const { data: orgs, error: oe } = await supabase.from('lms_orgs').select('id,slug,name').eq('active', true);
  if (oe) return res.status(500).json({ error: 'DB 오류: ' + oe.message });
  const orgById = new Map((orgs || []).map((o) => [o.id, o]));
  let scopeIds = (orgs || []).map((o) => o.id);
  if (orgSlug) {
    const picked = (orgs || []).find((o) => o.slug === orgSlug);
    if (!picked) return res.status(401).json({ error: '존재하지 않는 학교입니다.' });
    scopeIds = [picked.id];
  }
  if (!scopeIds.length) return res.status(401).json({ error: '등록된 학교가 없습니다.' });

  // 이름으로 검색 (공백 무시 비교 → "김 봄"="김봄")
  const { data: studs, error: se } = await supabase
    .from('lms_students').select('*').eq('active', true).in('org_id', scopeIds);
  if (se) return res.status(500).json({ error: 'DB 오류: ' + se.message });
  const matches = (studs || []).filter((s) => strip(s.name) === strip(name));

  if (matches.length === 0) {
    return res.status(401).json({ error: '명단에 없는 이름입니다. 정확히 입력했는지 확인하세요.' });
  }
  if (matches.length > 1) {
    const matchOrgIds = [...new Set(matches.map((m) => m.org_id))];
    if (matchOrgIds.length > 1) {
      // 서로 다른 학교에 동명 → 학교 선택 요구
      const opts = matchOrgIds.map((id) => orgById.get(id)).filter(Boolean).map((o) => ({ slug: o.slug, name: o.name }));
      return res.status(409).json({ error: '같은 이름이 여러 곳에 있어요. 소속을 선택해 주세요.', needOrg: true, orgs: opts });
    }
    // 한 학교 안에 동명이인 → 이름만으론 불가
    return res.status(409).json({ error: '같은 이름이 여러 명이라 이름만으로 로그인할 수 없습니다. 관리자에게 문의하세요.' });
  }

  const student = matches[0];
  const org = orgById.get(student.org_id);
  if (!org) return res.status(401).json({ error: '학교 정보를 찾을 수 없습니다.' });

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
