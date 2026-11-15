import { useEffect, useState } from 'preact/hooks';

const STEPS = [1, 1.5, 2, 3, 4];

/** The image, fit to the width, with zoom (the box scrolls when it is larger than that). */
export function ImageView({ blob, title }: { blob: Blob; title: string }) {
  const [url, setUrl] = useState<string>();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [blob]);
  return (
    <div class="viewer">
      <div class="viewer-bar">
        <button type="button" class="btn btn-outline" aria-label="Zoom out" disabled={step === 0} onClick={() => setStep(step - 1)}>−</button>
        <button type="button" class="btn btn-outline" aria-label="Zoom in" disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>+</button>
        <button type="button" class="btn btn-outline" disabled={step === 0} onClick={() => setStep(0)}>Fit width</button>
      </div>
      <div class="viewer-box">
        {url && <img class="image-view" src={url} alt={title} style={{ width: `${STEPS[step] * 100}%` }} />}
      </div>
    </div>
  );
}
