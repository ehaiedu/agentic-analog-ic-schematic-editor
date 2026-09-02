"use client";

import type { SubcircuitPreviewKind } from "../lib/subcircuitTemplates";

function MosPair() {
  return (
    <>
      <path d="M13 7V18M17 7V18M7 12H12M18 8H30M18 17H30" />
      <path d="M13 23V34M17 23V34M7 28H12M18 24H30M18 33H30" />
      <path d="M33 8v25" />
    </>
  );
}

function CapSymbol() {
  return (
    <>
      <path d="M7 20H22M30 20H45" />
      <path d="M22 12V28M30 12V28" />
    </>
  );
}

function PreviewBody({ kind }: { kind: SubcircuitPreviewKind }) {
  if (kind === "sample-hold") {
    return (
      <>
        <MosPair />
        <path d="M33 20H42M42 12V28M48 12V28M48 20H55" />
      </>
    );
  }
  if (kind === "cdac-bit") {
    return (
      <>
        <CapSymbol />
        <path d="M18 31H42" />
        <path d="M43 24V38M47 24V38M50 31H59" />
        <path d="M43 5V19M47 5V19M50 12H59" />
      </>
    );
  }
  if (kind === "strongarm") {
    return (
      <>
        <path d="M12 8H52M18 8V18M46 8V18" />
        <path d="M18 18L31 31M46 18L33 31" />
        <path d="M25 31V43M39 31V43M32 43V52" />
        <path d="M9 30H21M43 30H55" />
      </>
    );
  }
  if (kind === "diff-pair") {
    return (
      <>
        <path d="M18 10V24M14 10V24M8 17H13M19 11H28" />
        <path d="M46 10V24M42 10V24M36 17H41M47 11H56" />
        <path d="M28 24L32 34L36 24M32 34V50" />
      </>
    );
  }
  if (kind === "mirror") {
    return (
      <>
        <path d="M18 8V25M14 8V25M8 16H13M19 9H28M19 24H28" />
        <path d="M45 8V25M41 8V25M35 16H40M46 9H56M46 24H56" />
        <path d="M28 9H35M28 24V16H35" />
      </>
    );
  }
  if (kind === "ota") {
    return (
      <>
        <path d="M16 7V20M48 7V20M16 20H48" />
        <path d="M20 27V39M44 27V39M13 33H19M37 33H43" />
        <path d="M20 39L32 48L44 39M32 48V55" />
      </>
    );
  }
  return <MosPair />;
}

export function SubcircuitTemplatePreview({ kind }: { kind: SubcircuitPreviewKind }) {
  return (
    <span className={`device-symbol-preview template-preview template-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 64 58">
        <PreviewBody kind={kind} />
      </svg>
    </span>
  );
}
