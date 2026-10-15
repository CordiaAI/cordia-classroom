// Show, then tell: each step is a picture of the real screen with the exact thing to click
// circled, one short sentence naming the button, and an optional action.
export default function StepGuide({ steps, label = 'Steps' }) {
  return (
    <ol className="step-guide" aria-label={label}>
      {steps.map((step, index) => (
        <li key={index} className="c-card step-guide-item">
          {step.visual && <div className="step-guide-visual" aria-hidden="true">{step.visual}</div>}
          <div className="step-guide-text">
            <span className="step-guide-num" aria-hidden="true">{index + 1}</span>
            <p>{step.text}</p>
          </div>
          {step.action && <div className="step-guide-action">{step.action}</div>}
        </li>
      ))}
      <style jsx global>{`
        .step-guide { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
        .step-guide-item { display: grid; align-content: start; gap: 12px; padding: 16px; }
        .step-guide-visual { border-radius: 14px; overflow: hidden; }
        .step-guide-visual .illus { display: block; width: 100%; height: auto; }
        .step-guide-text { display: flex; align-items: flex-start; gap: 10px; }
        .step-guide-text p { margin: 4px 0 0; font: 600 15px/1.4 var(--font-sans); color: var(--ink); }
        .step-guide-num { display: grid; place-items: center; flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%; background: var(--olive); color: var(--on-olive); font: 600 13px/1 var(--font-sans); font-variant-numeric: tabular-nums; }
        .step-guide-action { display: flex; flex-wrap: wrap; gap: 8px; }
        .illus-pulse { animation: illus-pulse 1.6s ease-out infinite; transform-box: fill-box; transform-origin: center; }
        @keyframes illus-pulse { 0% { opacity: .5; transform: scale(.92); } 100% { opacity: 0; transform: scale(1.12); } }
        @media (prefers-reduced-motion: reduce) { .illus-pulse { animation: none; } }
      `}</style>
    </ol>
  );
}
