import { Router } from 'express';
import { randomUUID } from 'crypto';
import { supabase } from '../supabase.js';
import { requireAuth, requireTeacher } from '../auth.js';
import { createUploadUrl, createDownloadUrl, deleteObject } from '../storage.js';

export const materialsRouter = Router();

function orgOf(req, res) {
  const org = req.user?.org;
  if (!org) { res.status(403).json({ error: '학교 정보가 없습니다. 다시 로그인해 주세요.' }); return null; }
  return org;
}

// ── 자료 목록 (학생/교사 공통). 본 학교(org)의 활성 자료만, sort 순.
materialsRouter.get('/', requireAuth, async (req, res) => {
  const org = orgOf(req, res); if (!org) return;
  const { data, error } = await supabase
    .from('lms_materials').select('id,title,filename,size_bytes,mime_type,created_at')
    .eq('org_id', org).eq('active', true)
    .order('sort', { ascending: true }).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ materials: data || [] });
});

// ── 관리자: 전체 목록(비활성 포함)
materialsRouter.get('/all', requireTeacher, async (req, res) => {
  const org = orgOf(req, res); if (!org) return;
  const { data, error } = await supabase
    .from('lms_materials').select('*').eq('org_id', org)
    .order('sort', { ascending: true }).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ materials: data || [] });
});

// ── 업로드용 서명 URL 발급 (교사). 브라우저가 이 URL로 R2에 직접 PUT
materialsRouter.post('/upload-url', requireTeacher, async (req, res) => {
  const filename = String(req.body.filename || 'file.pdf');
  const safe = filename
    .replace(/[^\w.\-가-힣]+/g, '_').replace(/_+/g, '_').slice(0, 120) || 'file.pdf';
  const key = `materials/${randomUUID()}/${safe}`;
  try {
    const url = await createUploadUrl(key);
    res.json({ key, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 자료 등록 (업로드 완료 후 메타 저장) (교사)
materialsRouter.post('/', requireTeacher, async (req, res) => {
  const org = orgOf(req, res); if (!org) return;
  const title = String(req.body.title || '').trim();
  const key = String(req.body.key || '').trim();
  if (!title) return res.status(400).json({ error: '자료 제목을 입력하세요.' });
  if (!key) return res.status(400).json({ error: '업로드된 파일 정보가 없습니다.' });

  // 맨 뒤 순서로 추가
  const { data: maxRow } = await supabase
    .from('lms_materials').select('sort').eq('org_id', org)
    .order('sort', { ascending: false }).limit(1).maybeSingle();
  const sort = (maxRow?.sort ?? -1) + 1;

  const { data, error } = await supabase.from('lms_materials').insert({
    org_id: org, title, r2_key: key,
    filename: String(req.body.filename || '').trim(),
    size_bytes: Number(req.body.sizeBytes) || 0,
    mime_type: String(req.body.mimeType || 'application/pdf'),
    sort, active: true,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ material: data });
});

// ── 다운로드 URL 발급 (학생/교사). 본 학교 자료만. presigned GET(attachment)
materialsRouter.get('/:id/download', requireAuth, async (req, res) => {
  const org = orgOf(req, res); if (!org) return;
  const { data: m, error } = await supabase
    .from('lms_materials').select('r2_key,filename,active')
    .eq('id', req.params.id).eq('org_id', org).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!m || !m.active) return res.status(404).json({ error: '자료를 찾을 수 없습니다.' });
  try {
    const url = await createDownloadUrl(m.r2_key, m.filename || 'file');
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: '다운로드 URL 발급 실패: ' + e.message });
  }
});

// ── 자료 수정 (제목/활성) (교사)
materialsRouter.patch('/:id', requireTeacher, async (req, res) => {
  const org = orgOf(req, res); if (!org) return;
  const patch = {};
  if ('title' in req.body) patch.title = String(req.body.title).trim();
  if ('active' in req.body) patch.active = !!req.body.active;
  if ('sort' in req.body) patch.sort = Number(req.body.sort) || 0;
  if (!Object.keys(patch).length) return res.status(400).json({ error: '수정할 내용이 없습니다.' });
  const { data, error } = await supabase
    .from('lms_materials').update(patch).eq('id', req.params.id).eq('org_id', org).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: '자료를 찾을 수 없습니다.' });
  res.json({ material: data });
});

// ── 자료 삭제 (교사). R2 객체도 함께 삭제(베스트에포트).
materialsRouter.delete('/:id', requireTeacher, async (req, res) => {
  const org = orgOf(req, res); if (!org) return;
  const { data: m } = await supabase
    .from('lms_materials').select('r2_key').eq('id', req.params.id).eq('org_id', org).maybeSingle();
  const { error } = await supabase
    .from('lms_materials').delete().eq('id', req.params.id).eq('org_id', org);
  if (error) return res.status(500).json({ error: error.message });
  if (m?.r2_key) { try { await deleteObject(m.r2_key); } catch { /* R2 삭제 실패는 무시(메타는 이미 삭제됨) */ } }
  res.json({ ok: true });
});
