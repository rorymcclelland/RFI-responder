-- Sprint 5, story S5-3: a question keeps the customer's own number ("3.2.", "4(a)", "A1"), found
-- in a Word document or typed in the preview, so the export can use the customer's numbering.
-- Set when the question is saved; nobody changes it afterwards.
ALTER TABLE public.rfi_questions ADD COLUMN customer_ref text CHECK (length(customer_ref) <= 20);
GRANT INSERT (customer_ref) ON public.rfi_questions TO authenticated;
