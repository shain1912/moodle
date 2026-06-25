import { Router } from 'express';
import { supabase } from '../supabase.js';
import { requireAuth } from '../auth.js';

export const missionsRouter = Router();

// ── 미션 공지 목록 (학생/교사 공통). 본 학교(org)의 활성 미션만, 주차 순.
//   학생이면 본인 팀을 함께 반환해 제출 제목("팀명_주차") 조합에 사용.
missionsRouter.get('/', requireAuth, async (req, res) => {
  const org = req.user.org;
  if (!org) return res.status(403).json({ error: '학교 정보가 없습니다. 다시 로그인해 주세요.' });

  const { data: missions, error } = await supabase
    .from('lms_missions')
    .select('id,round,week_label,title,body,due_at,submit_email')
    .eq('org_id', org).eq('active', true)
    .order('round', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  // 학생이면 팀명 보충(교사 미리보기는 null)
  let team = null;
  if (req.user.role === 'student' && req.user.sub) {
    const { data: stu } = await supabase
      .from('lms_students').select('team').eq('id', req.user.sub).maybeSingle();
    team = stu?.team || null;
  }

  res.json({ team, missions: missions || [] });
});
