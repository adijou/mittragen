ALTER TABLE sponsors
  ADD COLUMN contact_name TEXT,
  ADD COLUMN contact_email TEXT,
  ADD COLUMN phone TEXT,
  ADD COLUMN street TEXT,
  ADD COLUMN postal_code TEXT,
  ADD COLUMN city TEXT,
  ADD COLUMN website TEXT,
  ADD COLUMN notes TEXT;

ALTER TABLE sponsors
  ADD CONSTRAINT sponsors_contact_email_length CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  ADD CONSTRAINT sponsors_website_length CHECK (website IS NULL OR char_length(website) <= 500),
  ADD CONSTRAINT sponsors_notes_length CHECK (notes IS NULL OR char_length(notes) <= 5000);

