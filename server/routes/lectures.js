import { Router } from 'express';
import { randomUUID } from 'crypto';
import { supabase } from '../supabase.js';
import { createUploadUrl, createPlaybackUrl, deleteObject } from '../storage.js';
import { requireAuth, requireTeacher } from '../auth.js';

export const lecturesRouter = Router();

// ── 강의 목록 (학생/교사 공통). 학생이면 본인 진도 포함
lecturesRouter.get('/', requireAuth, async (req, res) => {
  const { data: lectures, error } = await supabase
    .from('lms_lectures')
    .select('id,title,description,order_index,duration_seconds,size_bytes,created_at')
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  if (req.user.role === 'student') {
    const { data: prog } = await supabase
      .from('lms_progress')
      .select('lecture_id,percent,completed,last_position,watched_seconds')
      .eq('student_id', req.user.sub);
    const map = new Map((prog || []).map((p) => [p.lecture_id, p]));
    return res.json({ lectures: lectures.map((l) => ({ ...l, progress: map.get(l.id) || null })) });
  }
  res.json({ lectures });
});

// ── 업로드용 서명 URL 발급 (교사). 브라우저가 이 URL로 R2에 직접 PUT 업로드
lecturesRouter.post('/upload-url', requireTeacher, async (req, res) => {
  const filename = String(req.body.filename || 'video.mp4');
  const safe = filename
    .replace(/[^\w.\-가-힣]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120) || 'video.mp4';
  const key = `${randomUUID()}/${safe}`;
  try {
    const url = await createUploadUrl(key);
    res.json({ key, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 강의 등록 (업로드 완료 후 메타데이터 저장) (교사)
lecturesRouter.post('/', requireTeacher, async (req, res) => {
  const title = String(req.body.title || '').trim();
  const key = String(req.body.key || req.body.storagePath || '').trim();
  if (!title) return res.status(400).json({ error: '강의 제목을 입력하세요.' });
  if (!key) return res.status(400).json({ error: '업로드된 파일 정보가 없습니다.' });

  const { data: maxRow } = await supabase
    .from('lms_lectures').select('order_index')
    .order('order_index', { ascending: false }).limit(1).maybeSingle();
  const order = (maxRow?.order_index ?? -1) + 1;

  const { data, error } = await supabase.from('lms_lectures').insert({
    title,
    description: String(req.body.description || ''),
    storage_path: key,
    duration_seconds: Number(req.body.durationSeconds) || 0,
    size_bytes: Number(req.body.sizeBytes) || 0,
    mime_type: String(req.body.mimeType || 'video/mp4'),
    order_index: order,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ lecture: data });
});

// ── 재생용 서명 URL (학생/교사). 짧은 유효시간, range 요청 지원(seek 가능)
lecturesRouter.get('/:id/play', requireAuth, async (req, res) => {
  const { data: lec, error } = await supabase
    .from('lms_lectures').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!lec) return res.status(404).json({ error: '강의를 찾을 수 없습니다.' });

  let url;
  try { url = await createPlaybackUrl(lec.storage_path); }
  catch (e) { return res.status(500).json({ error: '재생 URL 발급 실패: ' + e.message }); }

  let myProgress = null;
  if (req.user.role === 'student') {
    const { data: p } = await supabase
      .from('lms_progress').select('percent,completed,last_position,watched_seconds,watched_set')
      .eq('student_id', req.user.sub).eq('lecture_id', lec.id).maybeSingle();
    myProgress = p || null;
  }

  res.json({
    url,
    lecture: {
      id: lec.id, title: lec.title, description: lec.description,
      duration_seconds: lec.duration_seconds,
    },
    progress: myProgress,
  });
});

// ── 강의 정보 수정 (교사)
lecturesRouter.patch('/:id', requireTeacher, async (req, res) => {
  const patch = {};
  if ('title' in req.body) patch.title = String(req.body.title).trim();
  if ('description' in req.body) patch.description = String(req.body.description);
  if ('order_index' in req.body) patch.order_index = Number(req.body.order_index) || 0;
  if (!Object.keys(patch).length) return res.status(400).json({ error: '수정할 내용이 없습니다.' });

  const { data, error } = await supabase
    .from('lms_lectures').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ lecture: data });
});

// ── 강의 삭제 (교사) — R2 파일도 함께 삭제
lecturesRouter.delete('/:id', requireTeacher, async (req, res) => {
  const { data: lec } = await supabase
    .from('lms_lectures').select('storage_path').eq('id', req.params.id).maybeSingle();
  const { error } = await supabase.from('lms_lectures').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  if (lec?.storage_path) {
    try { await deleteObject(lec.storage_path); } catch { /* 파일 삭제 실패는 무시 */ }
  }
  res.json({ ok: true });
});
