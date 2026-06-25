import { Router } from 'express';
import { supabase } from '../supabase.js';
import { config } from '../config.js';
import { requireTeacher } from '../auth.js';
import { toCsv } from '../lib/csv.js';

export const adminRouter = Router();
adminRouter.use(requireTeacher); // 이 라우터 전체는 교사 전용

// 이 라우터 전체에서 교사의 소속 학교(org)를 강제 — 누락 시 차단
adminRouter.use((req, res, next) => {
  if (!req.user?.org) return res.status(403).json({ error: '학교 정보가 없습니다. 다시 로그인해 주세요.' });
  next();
});

// ── 학생 명단 조회 (본 학교만)
adminRouter.get('/students', async (req, res) => {
  const { data, error } = await supabase
    .from('lms_students').select('*').eq('org_id', req.user.org)
    .order('team', { ascending: true, nullsFirst: false }).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ students: data });
});

// ── 학생 1명 추가/수정 (학교 내 이름 기준 upsert)
adminRouter.post('/students', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const team = req.body.team ? String(req.body.team).trim() : null;
  const pin = req.body.pin ? String(req.body.pin).trim() : null;
  if (!name) return res.status(400).json({ error: '이름은 필수입니다.' });

  const { data, error } = await supabase
    .from('lms_students')
    .upsert({ name, team, pin, active: true, org_id: req.user.org }, { onConflict: 'org_id,name' })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ student: data });
});

// ── 학생 일괄 등록 (붙여넣기). 한 줄당 "이름" 또는 "이름,팀" (콤마/탭 구분)
adminRouter.post('/students/bulk', async (req, res) => {
  const text = String(req.body.text || '');
  const rows = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[,\t]/).map((s) => s.trim());
    if (parts[0].replace(/\s/g, '') === '이름') continue; // 헤더 줄 무시
    const name = parts[0];
    const team = parts[1] || null;
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    rows.push({ name, team, active: true, org_id: req.user.org });
  }
  if (!rows.length) {
    return res.status(400).json({ error: '등록할 행이 없습니다. (형식: 이름 또는 이름,팀)' });
  }
  const { data, error } = await supabase
    .from('lms_students').upsert(rows, { onConflict: 'org_id,name' }).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ count: data.length, students: data });
});

// ── 학생 수정 (이름/팀/PIN/활성화)
adminRouter.patch('/students/:id', async (req, res) => {
  const patch = {};
  if ('name' in req.body) patch.name = String(req.body.name).trim();
  if ('team' in req.body) patch.team = req.body.team ? String(req.body.team).trim() : null;
  if ('pin' in req.body) patch.pin = req.body.pin ? String(req.body.pin).trim() : null;
  if ('active' in req.body) patch.active = !!req.body.active;
  if (!Object.keys(patch).length) return res.status(400).json({ error: '수정할 내용이 없습니다.' });

  const { data, error } = await supabase
    .from('lms_students').update(patch).eq('id', req.params.id).eq('org_id', req.user.org).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
  res.json({ student: data });
});

// ── 학생 삭제 (진도도 함께 삭제됨 — FK on delete cascade). 본 학교 학생만.
adminRouter.delete('/students/:id', async (req, res) => {
  const { error } = await supabase
    .from('lms_students').delete().eq('id', req.params.id).eq('org_id', req.user.org);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// 진도 매트릭스 데이터 수집(대시보드/CSV 공용) — 본 학교(org)만
async function buildMatrix(org) {
  const [sRes, olRes] = await Promise.all([
    supabase.from('lms_students').select('id,name,active,team').eq('org_id', org)
      .order('team', { ascending: true, nullsFirst: false }).order('name', { ascending: true }),
    supabase.from('lms_org_lectures').select('lecture_id,section,section_order,order_index').eq('org_id', org).eq('active', true)
      .order('section_order', { ascending: true }).order('order_index', { ascending: true }),
  ]);
  if (sRes.error || olRes.error) throw new Error('진도 데이터를 불러오지 못했습니다: ' + (sRes.error || olRes.error).message);
  const students = sRes.data || [];
  const subs = olRes.data || [];

  let lectures = [];
  if (subs.length) {
    const { data: lecs, error: le } = await supabase
      .from('lms_lectures').select('id,title,duration_seconds').in('id', subs.map((s) => s.lecture_id));
    if (le) throw new Error('강의 정보를 불러오지 못했습니다: ' + le.message);
    const lmap = new Map((lecs || []).map((l) => [l.id, l]));
    lectures = subs
      .map((s) => { const l = lmap.get(s.lecture_id); return l ? { ...l, section: s.section, order_index: s.order_index } : null; })
      .filter(Boolean);
  }

  const pmap = new Map();
  const sids = students.map((s) => s.id);
  if (sids.length && lectures.length) {
    const { data: progress } = await supabase
      .from('lms_progress').select('student_id,lecture_id,percent,completed,watched_seconds,updated_at')
      .in('student_id', sids);
    for (const p of progress || []) pmap.set(p.student_id + '|' + p.lecture_id, p);
  }
  return { students, lectures, pmap };
}

// ── 진도 대시보드 (학생 × 강의 매트릭스)
adminRouter.get('/dashboard', async (req, res) => {
  try {
    const { students, lectures, pmap } = await buildMatrix(req.user.org);
    const rows = students.map((s) => {
      const cells = lectures.map((l) => {
        const p = pmap.get(s.id + '|' + l.id);
        return { lectureId: l.id, percent: p?.percent ?? 0, completed: p?.completed ?? false };
      });
      const completedCount = cells.filter((c) => c.completed).length;
      const avg = lectures.length
        ? Math.round((cells.reduce((a, c) => a + c.percent, 0) / lectures.length) * 10) / 10
        : 0;
      return {
        student: s, cells, completedCount, avg,
        allDone: lectures.length > 0 && completedCount === lectures.length,
      };
    });
    res.json({ lectures, rows, threshold: config.completionThreshold });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 진도 CSV 한 번에 다운로드 (납품 증빙용)
adminRouter.get('/report.csv', async (req, res) => {
  try {
    const { students, lectures, pmap } = await buildMatrix(req.user.org);

    const headers = ['팀', '이름'];
    for (const l of lectures) {
      headers.push(`${l.title} (%)`);
      headers.push(`${l.title} 완료`);
    }
    headers.push('평균 진도율(%)', '완료 강의수', `전체 이수(${config.completionThreshold}%기준)`);

    const rows = students.map((s) => {
      const row = [s.team || '', s.name];
      let sum = 0, done = 0;
      for (const l of lectures) {
        const p = pmap.get(s.id + '|' + l.id);
        const pct = Number(p?.percent ?? 0);
        const comp = p?.completed ?? false;
        row.push(pct);
        row.push(comp ? 'O' : 'X');
        sum += pct;
        if (comp) done++;
      }
      const avg = lectures.length ? Math.round((sum / lectures.length) * 10) / 10 : 0;
      row.push(avg, done, lectures.length > 0 && done === lectures.length ? 'O' : 'X');
      return row;
    });

    const csv = toCsv(headers, rows);
    const today = new Date().toISOString().slice(0, 10);
    const fname = `progress_${today}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"; filename*=UTF-8''${fname}`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ───────────────────────── 미션 공지 관리 (본 학교만) ─────────────────────────

// ── 미션 목록 (비활성 포함, 주차 순)
adminRouter.get('/missions', async (req, res) => {
  const { data, error } = await supabase
    .from('lms_missions').select('*').eq('org_id', req.user.org)
    .order('round', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ missions: data });
});

// 요청 본문 → 미션 컬럼으로 정리(생성/수정 공용). 들어온 키만 반영.
function readMissionPatch(body, { forInsert = false } = {}) {
  const patch = {};
  if ('round' in body) patch.round = parseInt(body.round, 10) || 1;
  if ('week_label' in body) patch.week_label = String(body.week_label || '').trim();
  if ('title' in body) patch.title = String(body.title || '').trim();
  if ('body' in body) patch.body = String(body.body ?? '');
  if ('due_at' in body) patch.due_at = body.due_at ? new Date(body.due_at).toISOString() : null;
  if ('submit_email' in body) patch.submit_email = body.submit_email ? String(body.submit_email).trim() : null;
  if ('active' in body) patch.active = !!body.active;
  if (forInsert) {
    if (!patch.round) patch.round = 1;
    if (!patch.week_label) patch.week_label = `${patch.round}주차`;
  }
  return patch;
}

// ── 미션 생성
adminRouter.post('/missions', async (req, res) => {
  const patch = readMissionPatch(req.body, { forInsert: true });
  if (!patch.title) return res.status(400).json({ error: '제목은 필수입니다.' });
  const { data, error } = await supabase
    .from('lms_missions').insert({ ...patch, org_id: req.user.org }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ mission: data });
});

// ── 미션 수정 (부분)
adminRouter.patch('/missions/:id', async (req, res) => {
  const patch = readMissionPatch(req.body);
  if (!Object.keys(patch).length) return res.status(400).json({ error: '수정할 내용이 없습니다.' });
  const { data, error } = await supabase
    .from('lms_missions').update(patch)
    .eq('id', req.params.id).eq('org_id', req.user.org).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: '미션을 찾을 수 없습니다.' });
  res.json({ mission: data });
});

// ── 미션 삭제 (본 학교만)
adminRouter.delete('/missions/:id', async (req, res) => {
  const { error } = await supabase
    .from('lms_missions').delete().eq('id', req.params.id).eq('org_id', req.user.org);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
