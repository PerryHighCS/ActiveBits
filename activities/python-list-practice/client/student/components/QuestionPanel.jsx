import React from 'react';
import QuestionHintSection from './QuestionHintSection';
import InteractiveListSection from './InteractiveListSection';
import HintDisplay from './HintDisplay';
import AnswerPanel from './AnswerPanel';

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
}) {
  return (
    <div className="python-list-card">
      <QuestionHintSection
        challenge={challenge}
        hintStage={hintStage}
        showHintButtons={!feedback}
        onShowHint={onShowHint}
        onShowAnswer={onShowAnswer}
        hintDefinition={hintDefinition}
        answerDetails={answerDetails}
        showHintBody={false}
      />
      <InteractiveListSection
        challenge={challenge}
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
        expected={challenge?.expected}
      />
      <AnswerPanel
        answer={answer}
        onAnswerChange={onAnswerChange}
        challenge={challenge}
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
