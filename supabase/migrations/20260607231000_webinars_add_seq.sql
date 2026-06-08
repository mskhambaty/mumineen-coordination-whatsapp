ALTER TABLE public.webinars ADD COLUMN seq serial;
ALTER TABLE public.webinars ADD CONSTRAINT webinars_seq_unique UNIQUE (seq);
