/** Step 3: progress while the server matches, checks and drafts. */
import { Loader2 } from 'lucide-react';

export default function ProcessingStep({ message, progress }: { message: string; progress: number }) {
  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-24 flex flex-col items-center gap-8">
      <div className="w-20 h-20 rounded-3xl bg-ink-900 flex items-center justify-center">
        <Loader2 size={36} className="text-white animate-spin" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-xl font-black text-ink-900">Matching and drafting</p>
        <p className="text-sm text-ink-500 font-medium" role="status">{message}</p>
      </div>
      <div className="w-full space-y-2">
        <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
          <div className="h-full bg-ink-900 rounded-full transition-all duration-100" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-ink-400 text-center font-bold">{progress}%</p>
      </div>
    </div>
  );
}
