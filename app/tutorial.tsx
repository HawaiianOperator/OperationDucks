"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CloudSun, MapPin, MessageCircle, SquareDashed } from "lucide-react";

const steps = [
  { title: "Find a growing area", icon: MapPin,
    body: "Search for a town, region, or latitude and longitude. You can also choose an example growing region on the globe. Switch to Satellite to see the terrain around the farm." },
  { title: "Outline a field", icon: SquareDashed,
    body: "Pan and zoom to your plot. Choose Draw radius and click the center and edge, or choose Draw triangle and click three corners. Name each plot in Overview and keep drawing to compare plots in Duck." },
  { title: "Inspect farm risks", icon: CloudSun,
    body: "Open Farm risks to review the seven-day forecast, compare recent rainfall with past years, and see nearby disaster reports. Open the source links to inspect the data behind each result." },
  { title: "Compare planting dates", icon: MessageCircle,
    body: "Ask Duck to compare candidate locations and planting windows using the temperature and rainfall requirements for your seed variety. Check how often each window met those requirements in past years." },
];

export function Tutorial({ ready, replay }: { ready: boolean; replay: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const autoOpened = useRef(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!ready || autoOpened.current) return;
    autoOpened.current = true;
    try { if (localStorage.getItem("operation-ducks-tutorial-v1")) return; } catch {}
    dialog.current?.showModal();
  }, [ready]);

  useEffect(() => {
    if (!replay || !dialog.current || dialog.current.open) return;
    setStep(0);
    dialog.current.showModal();
  }, [replay]);

  function dismiss() {
    try { localStorage.setItem("operation-ducks-tutorial-v1", "seen"); } catch {}
    dialog.current?.close();
  }

  const { title, body, icon: Icon } = steps[step];
  return <dialog ref={dialog} className="tutorial-dialog" aria-labelledby="tutorial-title"
    onCancel={event => { event.preventDefault(); dismiss(); }}>
    <div className="tutorial-header">
      <span>Operation Ducks tutorial</span>
      <button className="outline" onClick={dismiss}>Skip tutorial</button>
    </div>
    <div className="tutorial-track" role="progressbar" aria-label="Tutorial progress"
      aria-valuenow={step + 1} aria-valuemin={0} aria-valuemax={steps.length}>
      {steps.map((item, index) => <i key={item.title} className={index <= step ? "done" : ""} />)}
    </div>
    <div className="tutorial-copy" aria-live="polite">
      <Icon size={28} aria-hidden="true" />
      <h2 id="tutorial-title">{title}</h2>
      <p>{body}</p>
    </div>
    <div className="tutorial-actions">
      <button className="outline" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> Back</button>
      <button className="primary" onClick={() => step < steps.length - 1 ? setStep(step + 1) : dismiss()}>
        {step < steps.length - 1 ? "Next" : "Open dashboard"} <ArrowRight size={16} />
      </button>
    </div>
  </dialog>;
}
