import { ReactNode, RefObject, MouseEvent } from 'react'
import QuestionHintSection from './QuestionHintSection.js'
import InteractiveListSection from './InteractiveListSection.js'
import HintDisplay from './HintDisplay.js'
import AnswerPanel from './AnswerPanel.js'

interface Feedback {
  isCorrect: boolean
  message: string | ReactNode
}

interface Challenge {
  prompt: string
  question?: string
  type?: string
  op?: string
  variant?: string
  expected?: unknown
  [key: string]: unknown
}

interface QuestionPanelProps {
  challenge: Challenge | null;
  hintStage: 'none' | 'definition' | 'answer';
  feedback: Feedback | null;
  hintDefinition: string | ReactNode;
  answerDetails?: string[] | ReactNode[];
  interactiveList: (string | number)[];
  isListBuildVariant: boolean;
  supportsSequenceSelection: boolean;
  selectedRange: [number, number] | null;
  selectedSequence: number[];
  selectedIndex: number | null;
  selectedValueIndex: number | null;
  onIndexClick: (index: number, event: MouseEvent) => void;
  onValueClick: (index: number, event: MouseEvent) => void;
  allowDuplicateValues: boolean;
  answer: string;
  onAnswerChange: (value: string) => void;
  answerRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  loading: boolean;
  onSubmit: () => void;
  onClear: () => void;
  onShowHint: () => void;
  onShowAnswer: () => void;
  onNext: () => void;
}

export default function QuestionPanel({
  challenge,
  hintStage,
  feedback,
  hintDefinition,
  answerDetails,
  interactiveList,
  isListBuildVariant,
  supportsSequenceSelection,
  selectedRange,
  selectedSequence,
  selectedIndex,
  selectedValueIndex,
  onIndexClick,
  onValueClick,
  allowDuplicateValues,
  answer,
  onAnswerChange,
  answerRef,
  disabled,
  loading,
  onSubmit,
  onClear,
  onShowHint,
  onShowAnswer,
  onNext,
}: QuestionPanelProps): ReactNode {
  return (
    <div className="python-list-card">
      <QuestionHintSection
        challenge={(challenge || {}) as Challenge}
        hintStage={hintStage}
        showHintButtons={!feedback}
        onShowHint={onShowHint}
        onShowAnswer={onShowAnswer}
        hintDefinition={hintDefinition}
        answerDetails={answerDetails}
        showHintBody={false}
      />
      <InteractiveListSection
        challenge={(challenge || {}) as Challenge}
        interactiveList={interactiveList}
        isListBuildVariant={isListBuildVariant}
        supportsSequenceSelection={supportsSequenceSelection}
        selectedRange={selectedRange}
        selectedSequence={selectedSequence}
        selectedIndex={selectedIndex}
        selectedValueIndex={selectedValueIndex}
        onIndexClick={onIndexClick}
        onValueClick={onValueClick}
        allowDuplicateValues={allowDuplicateValues}
      />
      <HintDisplay
        hintStage={hintStage}
        hintDefinition={hintDefinition}
        answerDetails={answerDetails}
        expected={(challenge || {}).expected}
      />
      <AnswerPanel
        answer={answer}
        onAnswerChange={onAnswerChange}
        challenge={(challenge || {}) as Challenge}
        answerRef={answerRef}
        disabled={disabled}
        loading={loading}
        onSubmit={onSubmit}
        onClear={onClear}
        feedback={feedback}
        onNext={onNext}
      />
    </div>
  );
}
