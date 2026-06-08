CREATE TABLE IF NOT EXISTS public.webinars (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  youtube_url text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webinars ENABLE ROW LEVEL SECURITY;

-- Public can read active webinars
CREATE POLICY "webinars_public_read" ON public.webinars
  FOR SELECT USING (active = true);
