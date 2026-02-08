import { ReactNode, FormEvent, RefObject } from 'react';
import Button from '@src/components/ui/Button.js';

interface NameFormProps {
  studentName: string;
  setStudentName: (name: string) => void;
  nameRef: RefObject<HTMLInputElement | null>;
  submitName: (e: FormEvent<HTMLFormElement>) => void;
  error: string | null;
}

export default function NameForm({ studentName, setStudentName, nameRef, submitName, error }: NameFormProps): ReactNode {
  return (
    <div className="python-list-bg flex items-center justify-center px-4">
      <div className="python-list-join">
        <h1 className="text-2xl font-bold mb-4 text-center text-emerald-900">Join Python List Practice</h1>
        <p className="text-sm text-emerald-800 text-center mb-4">
          Practice indexing, loops, len, append/remove/insert/pop, and range.
        </p>
        <form onSubmit={submitName} className="space-y-3">
          <label className="python-list-label">
            Your Name
            <input
              ref={nameRef}
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              className="python-list-input mt-1"
              placeholder="Enter your name"
              required
            />
          </label>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
            Start Practicing
          </Button>
        </form>
      </div>
    </div>
  );
}
