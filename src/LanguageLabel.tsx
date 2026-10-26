/** Sprint 12 (S12-1): marks an entry written in Japanese. English, the default, is not labelled. */
export default function LanguageLabel({ language }: { language?: 'en' | 'ja' | null }) {
  if (language !== 'ja') return null;
  return (
    <span title="Written in Japanese" className="text-2xs font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full">
      Japanese
    </span>
  );
}
