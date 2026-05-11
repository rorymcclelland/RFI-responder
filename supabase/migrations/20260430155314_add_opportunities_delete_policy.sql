/*
  # Add DELETE policy for opportunities

  Allows anon users to delete opportunities, matching the existing read/insert/update pattern.
*/

CREATE POLICY "Anon can delete opportunities"
  ON opportunities FOR DELETE TO anon
  USING (name IS NOT NULL);
