import { Router } from 'express';
import { supabase } from '../supabase.js';
import { config } from '../config.js';
import { requireStudent } from '../auth.js';

export const progressRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── 진도 저장 (학생).
//   newSeconds: 이번에 새로 본 정수 초 배열(델타) → 서버가 기존 합집합과 union
//   duration  : 학생 재생기가 측정한 실제 영상 길이(업로드 시 길이를 못 읽었을 때 자가 치유)
progressRouter.post('/:lectureId', requireStudent, async (req, res) => {
  const lectureId = req.params.lectureId;
  if (!UUID_RE.test(lectureId)) return res.status(400).json({ error: '잘못된 강의 ID 입니다.' });

  const newSeconds = Array.isArray(req.body.newSeconds) ? req.body.newSeconds : [];
  const lastPosition = Math.max(0, Number(req.body.lastPosition) || 0);
  const clientDuration = Math.max(0, Number(req.body.duration) || 0);

  const { data: lec, error: le } = await supabase
    .from('lms_lectures').select('id,duration_seconds').eq('id', lectureId).maybeSingle();
  if (le) return res.status(500).json({ error: le.message });
  if (!lec) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' });

  // duration 자가 치유: 업로드 때 길이를 못 읽어 0이면, 학생 재생기가 보낸 실제 길이로 보정
  let duration = Number(lec.duration_seconds) || 0;
  if (duration <= 0 && clientDuration > 0) {
    duration = Math.round(clientDuration);
    await supabase.from('lms_lectures').update({ duration_seconds: duration }).eq('id', lectureId);
  }

  const { data: existing } = await supabase
    .from('lms_progress').select('*')
    .eq('student_id', req.user.sub).eq('lecture_id', lectureId).maybeSingle();

  // 실제 본 초의 합집합(여러 기기/세션 누적). 영상 길이를 넘는 값은 버림.
  const set = new Set(Array.isArray(existing?.watched_set) ? existing.watched_set : []);
  const cap = duration > 0 ? Math.floor(duration) : Number.MAX_SAFE_INTEGER;
  for (const s of newSeconds) {
    const n = Math.floor(Number(s));
    if (Number.isFinite(n) && n >= 0 && n < cap) set.add(n);
  }
  const watched = set.size;

  let percent = duration > 0 ? Math.min(100, (watched / duration) * 100) : 0;
  percent = Math.round(percent * 10) / 10;

  // 완료는 한 번 인정되면 유지(단조). duration 확정 후 기준 도달 시 인정.
  const completed = (existing?.completed || false) || (duration > 0 && percent >= config.completionThreshold);
  const completedAt = completed ? (existing?.completed_at || new Date().toISOString()) : null;

  const row = {
    student_id: req.user.sub,
    lecture_id: lectureId,
    watched_set: [...set],
    watched_seconds: watched,
    last_position: lastPosition,
    percent,
    completed,
    completed_at: completedAt,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('lms_progress').upsert(row, { onConflict: 'student_id,lecture_id' })
    .select('percent,completed,watched_seconds,last_position').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ progress: data });
});
