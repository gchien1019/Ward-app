import { createClient } from '@supabase/supabase-js'

// ⚠️ 請把下面兩個值換成你自己 Supabase 專案的設定
// 在 Supabase 後台：左側選單 Project Settings → API
// SUPABASE_URL 對應 "Project URL"
// SUPABASE_ANON_KEY 對應 "anon public" key
const SUPABASE_URL = 'https://jdlxbldyjkexpjtjfccy.supabase.co/rest/v1/'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkbHhibGR5amtleHBqdGpmY2N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyNzk4OTYsImV4cCI6MjA5Nzg1NTg5Nn0.h7VbiaEc8QnBR4HkSXc1g_sqQ3Dr6Ao2IaZqAZNejGU'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
