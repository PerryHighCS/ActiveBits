import React from 'react';
import Button from '@src/components/ui/Button';

export default function StageControls({ stage, onChange }) {
  const isGallery = stage === 'gallery';
  const nextStage = isGallery ? 'review' : 'gallery';
  const description = isGallery ? (
    <>
      <strong className="font-semibold text-gray-900">Gallery Walk.</strong>
      {' '}
      Students provide peer feedback on each other&apos;s work. Feedback is not visible until review mode.
    </>
  ) : (
    <>
      <strong className="font-semibold text-gray-900">Feedback Review.</strong>
      {' '}
      Students can see feedback left by their peers.
    </>
  );
  const buttonLabel = isGallery ? 'Switch to Feedback review mode' : 'Switch to Gallery Walk mode';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-sm font-semibold text-gray-700">Session mode</label>
      <p className="text-sm text-gray-600 flex-1 min-w-[12rem]">{description}</p>
      <Button type="button" variant="outline" onClick={() => onChange(nextStage)}>
        {buttonLabel}
      </Button>
    </div>
  );
}
