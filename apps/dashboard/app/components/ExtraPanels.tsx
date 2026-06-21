'use client';

// Showcase panels under the main demo: why edge AI beats cloud, and a clearly
// labelled synthetic SmolVLA robot-policy demo ("from advice to action").

import { Fragment } from 'react';

const ROWS: [string, string, string][] = [
  ['Privacy', 'Health data never leaves the device', 'Symptoms sent to someone else’s servers'],
  ['Cost', '$0 per query — runs locally', 'Metered per token, forever'],
  ['Offline', 'Answers with no connection', 'Needs the cloud to respond'],
  ['Trust', 'Every job is a signed receipt, anchored on-chain', 'Opaque, unauditable'],
];

function EdgeVsCloud() {
  return (
    <div className="panel p-4">
      <div className="text-sm text-[var(--muted)] mb-3">Why edge AI — CareSwarm vs cloud medical AI</div>
      <div className="grid grid-cols-[5rem_1fr_1fr] gap-x-3 gap-y-2 text-xs items-start">
        <div />
        <div className="text-[var(--accent)] font-medium">CareSwarm · on-device</div>
        <div className="text-[var(--muted)]">Typical cloud AI</div>
        {ROWS.map(([k, a, b]) => (
          <Fragment key={k}>
            <div className="text-[var(--muted)] pt-0.5">{k}</div>
            <div className="text-[var(--text)]"><span className="text-[var(--accent)]">✓</span> {a}</div>
            <div className="text-[var(--muted)]"><span className="text-[var(--danger)]">✗</span> {b}</div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// A reach → grasp → lift end-effector path (cumulative xy of the action chunks).
const PATH = '22,150 58,130 96,106 132,88 160,78 160,46 160,20';
const DOTS = [
  [22, 150], [58, 130], [96, 106], [132, 88], [160, 46], [160, 20],
];

function RobotDemo() {
  return (
    <div className="panel p-4">
      <div className="text-sm mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[var(--accent2)]">🤖 Robot pilot — from advice to action</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--warn)]/15 text-[var(--warn)]">synthetic policy demo</span>
      </div>
      <div className="text-xs text-[var(--muted)] mb-2 leading-relaxed">
        Same swarm, one more agent: “fetch the medicine box.” SmolVLA-LIBERO runs on-device and emits 7-DoF
        action chunks. The trajectory below is a labelled synthetic policy-eval — no real arm.
      </div>
      <svg viewBox="0 0 320 170" className="w-full bg-[var(--bg)] rounded">
        <polyline
          points={PATH}
          fill="none"
          stroke="#34d399"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="rb-draw"
        />
        {DOTS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.5" fill="#60a5fa" />
        ))}
        {/* grasp point (gripper closes) */}
        <circle cx="160" cy="78" r="4.5" fill="#f87171" />
        <text x="168" y="82" fill="#6b7c93" fontSize="9">grasp</text>
        <text x="22" y="165" fill="#6b7c93" fontSize="9">start</text>
        <style>{`.rb-draw{stroke-dasharray:520;stroke-dashoffset:520;animation:rbdraw 2.4s ease-out forwards}@keyframes rbdraw{to{stroke-dashoffset:0}}`}</style>
      </svg>
      <div className="flex flex-wrap gap-3 mt-1.5 text-[10px] text-[var(--muted)]">
        <span>chunk 0: 42ms</span>
        <span>chunk 1: 38ms (vision 11ms)</span>
        <span>chunk 2: 40ms</span>
        <span className="text-[var(--accent2)]">on-device · CPU backend</span>
      </div>
    </div>
  );
}

export default function ExtraPanels() {
  return (
    <div className="grid lg:grid-cols-2 gap-6 mt-6">
      <EdgeVsCloud />
      <RobotDemo />
    </div>
  );
}
