"use client";

import type { ClinicalFormConfiguration, EncounterDocument, FormDraftDefinition } from "@open-triage/contracts";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  activeStationarySection,
  configuredStationaryPreviewSections,
  configuredStationarySections,
  stationarySectionBlocks,
  stationarySectionStatuses,
  type StationarySectionFinding,
} from "../app/stationary-record";
import { STATIONARY_NON_REPEATING_GROUPS } from "../app/stationary-non-repeating";
import { StationaryNonRepeatingRecord } from "./stationary-non-repeating-record";
import { StationaryRepeatingGroups } from "./stationary-repeating-groups";
import { stationaryDisplayLabel } from "../app/stationary-label";
import { getNemsisDataElement } from "../app/nemsis-data-model";

function statusText(errors: number, warnings: number, incomplete: number): string {
  return `${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}, ${incomplete} required ${incomplete === 1 ? "field" : "fields"} incomplete`;
}

/** Complete, sectioned stationary projection of the compiled NEMSIS record. */
export function StationaryRecord({ document, findings = [], formDefinition, catalogFields = {}, onDocumentChange }: {
  readonly document: EncounterDocument;
  readonly findings?: ReadonlyArray<StationarySectionFinding>;
  readonly formDefinition?: FormDraftDefinition;
  readonly catalogFields?: ClinicalFormConfiguration["catalogFields"];
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const defaultSections = useMemo(() => configuredStationarySections(), []);
  const previewSections = useMemo(() => {
    if (!formDefinition) return undefined;
    const configured = configuredStationaryPreviewSections(formDefinition);
    return configured.some((section) => section.blocks.length > 0) ? configured : undefined;
  }, [formDefinition]);
  const sections = previewSections ?? defaultSections;
  const inlineGroups = useMemo(() => new Map(STATIONARY_NON_REPEATING_GROUPS.map((group) => [group.id, group])), []);
  const statuses = useMemo(() => {
    if (!previewSections) return stationarySectionStatuses(document, findings, defaultSections);
    return new Map(previewSections.map((section) => {
      const elementIds = new Set(section.fields.flatMap((field) => field.source.kind === "nemsis" ? [field.source.elementId] : []));
      const sectionFindings = findings.filter((finding) => {
        const elementId = finding.target.fieldId ?? finding.target.elementId;
        return elementId ? elementIds.has(elementId) : section.groupIds.has(finding.target.groupId);
      });
      const incomplete = section.fields.filter((field) => {
        if (field.source.kind !== "nemsis") return false;
        const elementId = field.source.elementId;
        const catalogRequired = catalogFields[elementId]?.agencyRequired ||
          (catalogFields[elementId]?.minOccurs ?? getNemsisDataElement(elementId)?.occurrence.min ?? 0) > 0;
        if (!(field.required === true || catalogRequired)) return false;
        return !document.groups.some((group) => group.instances.some((instance) => instance.elements.some((element) =>
          element.id === elementId && element.values.length > 0)));
      }).length;
      return [section.id, {
        errors: sectionFindings.filter(({ severity }) => severity === "error").length,
        warnings: sectionFindings.filter(({ severity }) => severity === "warning").length,
        incomplete,
      }];
    }));
  }, [catalogFields, defaultSections, document, findings, previewSections]);
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  const moveToSection = useCallback((sectionId: string, focus: boolean, smooth = false) => {
    const section = sections.find(({ id }) => id === sectionId);
    const target = section ? window.document.getElementById(section.hash) : null;
    if (!section || !target) return;
    setActiveId(section.id);
    target.scrollIntoView({ behavior: smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto", block: "start" });
    if (focus) target.querySelector<HTMLElement>("[data-stationary-section-heading]")?.focus({ preventScroll: true });
  }, [sections]);

  useEffect(() => {
    let frame = 0;
    const updateFromScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const positions = sections.map((section) => ({ id: section.id, top: window.document.getElementById(section.hash)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY }));
        const headerBottom = window.document.querySelector<HTMLElement>(".encounter-header")?.getBoundingClientRect().bottom ?? 136;
        const active = activeStationarySection(positions, headerBottom + 24);
        if (active) setActiveId(active);
      });
    };
    const updateFromHash = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const section = sections.find((candidate) => candidate.hash === hash);
      if (section) window.requestAnimationFrame(() => moveToSection(section.id, true));
      else updateFromScroll();
    };
    window.addEventListener("scroll", updateFromScroll, { passive: true });
    window.addEventListener("resize", updateFromScroll);
    window.addEventListener("hashchange", updateFromHash);
    updateFromHash();
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateFromScroll);
      window.removeEventListener("resize", updateFromScroll);
      window.removeEventListener("hashchange", updateFromHash);
    };
  }, [moveToSection, sections]);

  return <div className="stationary-record-layout">
    <nav className="stationary-section-rail" aria-label="Stationary record sections">
      <ul>{sections.map((section) => {
        const status = statuses.get(section.id)!;
        const summary = statusText(status.errors, status.warnings, status.incomplete);
        const label = stationaryDisplayLabel(section.label);
        return <li key={section.id}>
          <a
            aria-current={activeId === section.id ? "location" : undefined}
            aria-label={`${label}: ${summary}`}
            className={activeId === section.id ? "active" : undefined}
            href={`#${section.hash}`}
            onClick={(event) => {
              event.preventDefault();
              window.history.pushState(null, "", `#${section.hash}`);
              moveToSection(section.id, true, true);
            }}
          >
            <span>{label}</span>
            <span className="stationary-section-counts" aria-hidden="true">
              <span className={`error-count${status.errors ? "" : " zero-count"}`} title="Blocking errors">{status.errors}</span>
              <span className={`warning-count${status.warnings ? "" : " zero-count"}`} title="Warnings">{status.warnings}</span>
              <span className={`incomplete-count${status.incomplete ? "" : " zero-count"}`} title="Incomplete required fields">{status.incomplete}</span>
            </span>
          </a>
        </li>;
      })}</ul>
      <span className="visually-hidden" aria-live="polite">Current section: {stationaryDisplayLabel(sections.find(({ id }) => id === activeId)?.label ?? "")}</span>
    </nav>

    <div className="stationary-record-page" aria-label="Complete stationary NEMSIS record">
      {sections.map((section) => {
        const status = statuses.get(section.id)!;
        const label = stationaryDisplayLabel(section.label);
        return <section
          className="stationary-record-section"
          data-stationary-section={section.id}
          data-section-status={status.errors ? "error" : status.warnings ? "warning" : status.incomplete ? "incomplete" : "complete"}
          id={section.hash}
          key={section.id}
          aria-labelledby={`${section.hash}-heading`}
        >
          <header className="stationary-record-section-heading">
            <h1 id={`${section.hash}-heading`} data-stationary-section-heading tabIndex={-1}>{label}</h1>
            <p>
              <span className="visually-hidden">{statusText(status.errors, status.warnings, status.incomplete)}</span>
              <span className={`error-count${status.errors ? "" : " zero-count"}`}>{status.errors} errors</span>
              <span className={`warning-count${status.warnings ? "" : " zero-count"}`}>{status.warnings} warnings</span>
              <span className={`incomplete-count${status.incomplete ? "" : " zero-count"}`}>{status.incomplete} incomplete</span>
            </p>
          </header>
          {("blocks" in section ? section.blocks : stationarySectionBlocks(section)).map((block, blockIndex) => block.kind === "inline"
            ? <StationaryNonRepeatingRecord key={`${block.group.id}:${blockIndex}`} document={document} groups={[
              { ...inlineGroups.get(block.group.id)!, fields: block.elementIds
                ? block.elementIds.flatMap((id) => inlineGroups.get(block.group.id)!.fields.find((field) => field.id === id) ?? [])
                : inlineGroups.get(block.group.id)!.fields }
            ]} findings={findings} catalogFields={catalogFields} onDocumentChange={onDocumentChange} />
            : <StationaryRepeatingGroups key={`${block.group.id}:${blockIndex}`} document={document} groups={[block.group]} findings={findings}
              clinicalForm={formDefinition ? { definition: formDefinition, catalogFields } : undefined} onDocumentChange={onDocumentChange} />)}
        </section>;
      })}
    </div>
  </div>;
}
