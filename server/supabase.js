import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

// 서버 전용 클라이언트 — service_role 키 사용(RLS 우회). 절대 브라우저로 보내지 말 것.
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
