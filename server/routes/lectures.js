import { Router } from 'express';
import { randomUUID } from 'crypto';
import { supabase } from '../supabase.js';
import { createUploadUrl, createPlaybackUrl } from '../storage.js';
import { requireAuth, requireTeacher } from '../auth.js';

export const lecturesRouter = Router();

// ── 강의 목록 (학생/교사 공통). 학교(테넌트)가 구독한 활성 강의만, 섹션·순서 포함. 학생이면 본인 진도 포함
lecturesRouter.get('/', requireAuth, async (req, res) => {
  const org = req.user.org;
  if (!org) return res.status(403).json({ error: '학교 정보가 없습니다. 다시 로그인해 주세요.' });

  const { data: subs, error } = await supabase
    .from('lms_org_lectures')
    .select('lecture_id,section,section_order,order_index')
    .eq('org_id', org).eq('active', true)
    .order('section_order', { ascending: true })
    .order('order_index', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  if (!subs.length) return res.json({ lectures: [] });

  const ids = subs.map((s) => s.lecture_id);
  const { data: lecs, error: le } = await supabase
    .from('lms_lectures')
    .select('id,title,description,duration_seconds,size_bytes,created_at')
    .in('id', ids);
  if (le) return res.status(500).json({ error: le.message });
  const lmap = new Map((lecs || []).map((l) => [l.id, l]));

  // subs 정렬(섹션→순서)을 유지하며 강의 메타 병합
  let lectures = subs
    .map((s) => {
      const l = lmap.get(s.lecture_id);
      return l ? { ...l, section: s.section, section_order: s.section_order, order_index: s.order_index } : null;
    })
    .filter(Boolean);

  if (req.user.role === 'student') {
    const { data: prog } = await supabase
      .from('lms_progress')
      .select('lecture_id,percent,completed,last_position,watched_seconds')
      .eq('student_id', req.user.sub);
    const map = new Map((prog || []).map((p) => [p.lecture_id, p]));
    lectures = lectures.map((l) => ({ ...l, progress: map.get(l.id) || null }));
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

// ── 강의 등록 (업로드 완료 후 메타데이터 저장) (교사). 라이브러리에 추가 + 교사 학교에 구독
lecturesRouter.post('/', requireTeacher, async (req, res) => {
  const org = req.user.org;
  if (!org) return res.status(403).json({ error: '학교 정보가 없습니다. 다시 로그인해 주세요.' });
  const title = String(req.body.title || '').trim();
  const key = String(req.body.key || req.body.storagePath || '').trim();
  const section = String(req.body.section || '').trim();
  if (!title) return res.status(400).json({ error: '강의 제목을 입력하세요.' });
  if (!key) return res.status(400).json({ error: '업로드된 파일 정보가 없습니다.' });

  // 라이브러리(공유) 등록
  const { data: lecture, error } = await supabase.from('lms_lectures').insert({
    title,
    description: String(req.body.description || ''),
    storage_path: key,
    duration_seconds: Number(req.body.durationSeconds) || 0,
    size_bytes: Number(req.body.sizeBytes) || 0,
    mime_type: String(req.body.mimeType || 'video/mp4'),
    order_index: 0,
    active: true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // 교사 학교에 구독(맨 뒤 순서). 섹션 지정 시 같은 섹션 끝에 붙임
  const { data: maxRow } = await supabase
    .from('lms_org_lectures').select('order_index,section_order')
    .eq('org_id', org).order('order_index', { ascending: false }).limit(1).maybeSingle();
  const order = (maxRow?.order_index ?? -1) + 1;
  const sectionOrder = (maxRow?.section_order ?? 0);
  const { error: se } = await supabase.from('lms_org_lectures').insert({
    org_id: org, lecture_id: lecture.id, section, section_order: sectionOrder, order_index: order, active: true,
  });
  if (se) return res.status(500).json({ error: '구독 등록 실패: ' + se.message });

  res.json({ lecture });
});

// ── 재생용 서명 URL (학생/교사). 짧은 유효시간, range 요청 지원(seek 가능)
lecturesRouter.get('/:id/play', requireAuth, async (req, res) => {
  const org = req.user.org;
  if (!org) return res.status(403).json({ error: '학교 정보가 없습니다. 다시 로그인해 주세요.' });

  // 본 학교가 구독(활성)한 강의만 재생 허용 (학교 간 접근 차단)
  const { data: sub } = await supabase
    .from('lms_org_lectures').select('id')
    .eq('org_id', org).eq('lecture_id', req.params.id).eq('active', true).maybeSingle();
  if (!sub) return res.status(404).json({ error: '수강 대상 강의가 아닙니다.' });

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
//   title/description = 공유 라이브러리(모든 학교 공통) / section·순서·active = 본 학교 구독(org)별
lecturesRouter.patch('/:id', requireTeacher, async (req, res) => {
  const org = req.user.org;
  if (!org) return res.status(403).json({ error: '학교 정보가 없습니다. 다시 로그인해 주세요.' });

  const libPatch = {};
  if ('title' in req.body) libPatch.title = String(req.body.title).trim();
  if ('description' in req.body) libPatch.description = String(req.body.description);

  const orgPatch = {};
  if ('section' in req.body) orgPatch.section = String(req.body.section).trim();
  if ('section_order' in req.body) orgPatch.section_order = Number(req.body.section_order) || 0;
  if ('order_index' in req.body) orgPatch.order_index = Number(req.body.order_index) || 0;
  if ('active' in req.body) orgPatch.active = !!req.body.active;

  if (!Object.keys(libPatch).length && !Object.keys(orgPatch).length) {
    return res.status(400).json({ error: '수정할 내용이 없습니다.' });
  }

  if (Object.keys(libPatch).length) {
    const { error } = await supabase.from('lms_lectures').update(libPatch).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  if (Object.keys(orgPatch).length) {
    const { error } = await supabase
      .from('lms_org_lectures').update(orgPatch)
      .eq('org_id', org).eq('lecture_id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
  }
  res.json({ ok: true });
});

// ── 강의 내리기 (교사) — 본 학교 강의 목록에서 제외(구독 해제) + 본 학교 학생 진도 삭제.
//   공유 영상 원본/라이브러리는 보존(다른 학교가 쓸 수 있으므로). R2 파일은 지우지 않음.
lecturesRouter.delete('/:id', requireTeacher, async (req, res) => {
  const org = req.user.org;
  if (!org) return res.status(403).json({ error: '학교 정보가 없습니다. 다시 로그인해 주세요.' });

  // 본 학교 학생들의 해당 강의 진도 삭제
  const { data: students } = await supabase.from('lms_students').select('id').eq('org_id', org);
  const sids = (students || []).map((s) => s.id);
  if (sids.length) {
    await supabase.from('lms_progress').delete().eq('lecture_id', req.params.id).in('student_id', sids);
  }
  // 구독 해제
  const { error } = await supabase
    .from('lms_org_lectures').delete().eq('org_id', org).eq('lecture_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
