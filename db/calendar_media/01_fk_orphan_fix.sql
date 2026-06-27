-- =====================================================================
-- 01_fk_orphan_fix.sql — calendar_media_comment 참조무결성 보강
-- 대상: public.calendar_media_comment.media_id → public.calendar_media.id
--
-- ▸ 문제(🔴 orphan): media_id 에 FK·ON DELETE 가 없음.
--   미디어 삭제(deleteCalendarMedia 는 calendar_media 만 DELETE)는 댓글을 안 지움
--   → 부모 없는 '고아 댓글'이 조용히 잔존(화면엔 안 뜨고 DB에만 쌓임).
--
-- ▸ 해결(기능+의도):
--   ① 기존 고아 댓글 1회 정리
--   ② FK + ON DELETE CASCADE 추가
--      → 이후 미디어 삭제 시 댓글 자동 정리(CASCADE) + 없는 media_id 댓글 INSERT 차단.
--
-- ▸ 멱등: FK(fk_cmc_media) 미존재 시에만 1회 실행. 재실행/ensureSchema 포함해도 no-op 안전.
-- ▸ 적용 순서: 로컬 → (스테이징) → campus. campus 는 운영이라 팀/배포 파이프라인으로 적용.
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_cmc_media'
       AND conrelid = 'public.calendar_media_comment'::regclass
  ) THEN
    -- ① 고아 댓글 정리 (부모 calendar_media 없는 행)
    DELETE FROM public.calendar_media_comment c
     WHERE NOT EXISTS (
       SELECT 1 FROM public.calendar_media m WHERE m.id = c.media_id
     );
    -- ② FK + ON DELETE CASCADE
    ALTER TABLE public.calendar_media_comment
      ADD CONSTRAINT fk_cmc_media
      FOREIGN KEY (media_id) REFERENCES public.calendar_media(id) ON DELETE CASCADE;
    RAISE NOTICE 'fk_cmc_media: 고아 정리 + FK(CASCADE) 추가 완료';
  ELSE
    RAISE NOTICE 'fk_cmc_media: 이미 존재 — no-op';
  END IF;
END $$;

-- 롤백(필요 시): ALTER TABLE public.calendar_media_comment DROP CONSTRAINT fk_cmc_media;
