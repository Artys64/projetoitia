ALTER TABLE ai_run_attempts DROP CONSTRAINT IF EXISTS ai_run_attempts_publication_mode_check;
ALTER TABLE ai_run_attempts ADD CONSTRAINT ai_run_attempts_publication_mode_check
  CHECK (publication_mode IN ('approved','literal','no_guidance','out_of_scope','clarification','generated'));
