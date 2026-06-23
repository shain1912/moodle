import { Router } from 'express';
import { supabase } from '../supabase.js';
import { config } from '../config.js';
import { requireTeacher } from '../auth.js';
import { toCsv } from '../lib/csv.js';

export const adminRouter = Router();
adminRouter.use(requireTeacher); // 이 라우터 전체는 교사 전용

// ── 학생 명단 조회
adminRouter.get('/students', async (_req, res) => {
  const { data, error } = await supabase
    .from('lms_students').select('*')
    .order('team', { ascending: true, nullsFirst: false }).order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ students: data });
});

// ── 학생 1명 추가/수정 (이름 기준 upsert)
adminRouter.post('/students', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const team = req.body.team ? String(req.body.team).trim() : null;
  const pin = req.body.pin ? String(req.body.pin).trim() : null;
  if (!name) return res.status(400).json({ error: '이름은 필수입니다.' });

  const { data, error } = await supabase
    .from('lms_students')
    .upsert({ name, team, pin, active: true }, { onConflict: 'name' })
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
    rows.push({ name, team, active: true });
  }
  if (!rows.length) {
    return res.status(400).json({ error: '등록할 행이 없습니다. (형식: 이름 또는 이름,팀)' });
  }
  const { data, error } = await supabase
    .from('lms_students').upsert(rows, { onConflict: 'name' }).select();
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
    .from('lms_students').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ student: data });
});

// ── 학생 삭제 (진도도 함께 삭제됨 — FK on delete cascade)
adminRouter.delete('/students/:id', async (req, res) => {
  const { error } = await supabase.from('lms_students').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// 진도 매트릭스 데이터 수집(대시보드/CSV 공용)
async function buildMatrix() {
  const [sRes, lRes, pRes] = await Promise.all([
    supabase.from('lms_students').select('id,name,active,team').order('team', { ascending: true, nullsFirst: false }).order('name', { ascending: true }),
    supabase.from('lms_lectures').select('id,title,order_index,duration_seconds').eq('active', true).order('order_index', { ascending: true }),
    supabase.from('lms_progress').select('student_id,lecture_id,percent,completed,watched_seconds,updated_at'),
  ]);
  const firstErr = sRes.error || lRes.error || pRes.error;
  if (firstErr) throw new Error('진도 데이터를 불러오지 못했습니다: ' + firstErr.message);
  const students = sRes.data, lectures = lRes.data, progress = pRes.data;
  const pmap = new Map();
  for (const p of progress || []) pmap.set(p.student_id + '|' + p.lecture_id, p);
  return { students: students || [], lectures: lectures || [], pmap };
}

// ── 진도 대시보드 (학생 × 강의 매트릭스)
adminRouter.get('/dashboard', async (_req, res) => {
  try {
    const { students, lectures, pmap } = await buildMatrix();
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
adminRouter.get('/report.csv', async (_req, res) => {
  try {
    const { students, lectures, pmap } = await buildMatrix();

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
