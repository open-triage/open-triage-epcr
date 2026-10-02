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
import { currentCatalogLanguage, resolveCatalogGroupText } from "../app/catalog-localization";
import type { FormLanguage } from "../app/form-localization";
import { resolveMessage } from "../app/localization";
import { CustomTextFields } from "./custom-text-fields";
import { CustomCodedFields } from "./custom-coded-fields";
import { RepeatedCustomFields } from "./repeated-custom-fields";
import { CustomGroupFields } from "./custom-group-fields";

function statusText(language: FormLanguage, errors: number, warnings: number): string {
  return `${resolveMessage(language, "mobile.errorCount", { count: errors }, errors)}, ${resolveMessage(language, "mobile.warningCount", { count: warnings }, warnings)}`;
}

/** Complete, sectioned stationary projection of the compiled NEMSIS record. */
export function StationaryRecord({ document, findings = [], sectionFindings = findings,
  formDefinition, catalogFields = {}, customFields, customGroups, catalogGroups, validation, readOnly = false, language = currentCatalogLanguage(), onDocumentChange }: {
  readonly readOnly?: boolean;
  readonly document: EncounterDocument;
  readonly findings?: ReadonlyArray<StationarySectionFinding>;
  /** Includes encounter-review findings for section counts without duplicating inline field messages. */
  readonly sectionFindings?: ReadonlyArray<StationarySectionFinding>;
  readonly formDefinition?: FormDraftDefinition;
  readonly catalogFields?: ClinicalFormConfiguration["catalogFields"];
  readonly customFields?: ClinicalFormConfiguration["customFields"];
  readonly customGroups?: ClinicalFormConfiguration["customGroups"];
  readonly catalogGroups?: ClinicalFormConfiguration["catalogGroups"];
  readonly validation?: ClinicalFormConfiguration["validation"];
  readonly language?: FormLanguage;
  readonly onDocumentChange: (document: EncounterDocument) => void;
}) {
  const defaultSections = useMemo(() => configuredStationarySections(), []);
  const previewSections = useMemo(() => {
    if (!formDefinition) return undefined;
    return configuredStationaryPreviewSections(formDefinition, language);
  }, [formDefinition, language]);
  const sections = previewSections ?? defaultSections;
  const sectionLabel = (section: (typeof sections)[number]) => "blocks" in section
    ? section.visualName ?? stationaryDisplayLabel(resolveCatalogGroupText(catalogGroups, section.catalogGroupId, language, section.label))
    : resolveMessage(language, "stationary.section." + section.id);
  const inlineGroups = useMemo(() => new Map(STATIONARY_NON_REPEATING_GROUPS.map((group) => [group.id, group])), []);
  const statuses = useMemo(() => {
    if (!previewSections) return stationarySectionStatuses(sectionFindings, defaultSections);
    return new Map(previewSections.map((section) => {
      const elementIds = new Set(section.fields.flatMap((field) => field.source.kind === "nemsis" ? [field.source.elementId] : []));
      const matchingFindings = sectionFindings.filter((finding) => {
        const elementId = finding.target.fieldId ?? finding.target.elementId;
        return elementId && getNemsisDataElement(elementId)
          ? elementIds.has(elementId) : section.groupIds.has(finding.target.groupId);
      });
      return [section.id, {
        errors: matchingFindings.filter(({ severity }) => severity === "error").length,
        warnings: matchingFindings.filter(({ severity }) => severity === "warning").length,
      }];
    }));
  }, [defaultSections, previewSections, sectionFindings]);
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

  return <div className={`stationary-record-layout${readOnly ? " stationary-read-only" : ""}`}>
    <nav className="stationary-section-rail" aria-label={resolveMessage(language, "stationary.sections")}>
      <ul>{sections.map((section) => {
        const status = statuses.get(section.id)!;
        const summary = statusText(language, status.errors, status.warnings);
        const label = sectionLabel(section);
        return <li key={section.id}>
          <button type="button"
            aria-current={activeId === section.id ? "location" : undefined}
            aria-label={`${label}: ${summary}`}
            className={activeId === section.id ? "active" : undefined}
            onClick={() => moveToSection(section.id, true, true)}
          >
            <span>{label}</span>
            <span className="stationary-section-counts" aria-hidden="true">
              <span className={`error-count${status.errors ? "" : " zero-count"}`} title={resolveMessage(language, "stationary.blockingErrors")}>{status.errors}</span>
              <span className={`warning-count${status.warnings ? "" : " zero-count"}`} title={resolveMessage(language, "stationary.warnings")}>{status.warnings}</span>
            </span>
          </button>
        </li>;
      })}</ul>
      <span className="visually-hidden" aria-live="polite">{resolveMessage(language, "stationary.currentSection", { section: sections.find(({ id }) => id === activeId) ? sectionLabel(sections.find(({ id }) => id === activeId)!) : "" })}</span>
    </nav>

    <div className="stationary-record-page" aria-label={resolveMessage(language, "stationary.completeRecord")}>
      {sections.map((section) => {
        const status = statuses.get(section.id)!;
        const label = sectionLabel(section);
        return <section
          className="stationary-record-section"
          data-stationary-section={section.id}
          data-section-status={status.errors ? "error" : status.warnings ? "warning" : "complete"}
          id={section.hash}
          key={section.id}
          aria-labelledby={`${section.hash}-heading`}
        >
          <header className="stationary-record-section-heading">
            <h1 id={`${section.hash}-heading`} data-stationary-section-heading tabIndex={-1}>{label}</h1>
            <p>
              <span className="visually-hidden">{statusText(language, status.errors, status.warnings)}</span>
              <span className={`error-count${status.errors ? "" : " zero-count"}`}>{resolveMessage(language, "mobile.errorCount", { count: status.errors }, status.errors)}</span>
              <span className={`warning-count${status.warnings ? "" : " zero-count"}`}>{resolveMessage(language, "mobile.warningCount", { count: status.warnings }, status.warnings)}</span>
            </p>
          </header>
          {("blocks" in section ? section.blocks : stationarySectionBlocks(section)).map((block, blockIndex) => block.kind === "inline"
            ? <fieldset key={`${block.group.id}:${blockIndex}`} disabled={readOnly} className="stationary-record-fields"><StationaryNonRepeatingRecord document={document} groups={[
              { ...inlineGroups.get(block.group.id)!, fields: block.elementIds
                ? block.elementIds.flatMap((id) => inlineGroups.get(block.group.id)!.fields.find((field) => field.id === id) ?? [])
                : inlineGroups.get(block.group.id)!.fields }
            ]} findings={findings} catalogFields={catalogFields} catalogGroups={catalogGroups} language={language} onDocumentChange={onDocumentChange} /></fieldset>
            : <StationaryRepeatingGroups key={`${block.group.id}:${blockIndex}`} document={document} groups={[readOnly ? { ...block.group, mode: "read-only" } : block.group]} findings={findings}
              clinicalForm={formDefinition ? { definition: formDefinition, catalogFields, catalogGroups, ...(validation ? { validation } : {}) } : undefined} language={language} onDocumentChange={onDocumentChange} />)}
          <fieldset disabled={readOnly} className="stationary-record-fields">
          {"fields" in section && <CustomTextFields document={document} fields={section.fields} definitions={customFields}
            language={language} onDocumentChange={onDocumentChange} />}
          {"fields" in section && <CustomCodedFields document={document} fields={section.fields} definitions={customFields}
            language={language} onDocumentChange={onDocumentChange} />}
          {"fields" in section && <RepeatedCustomFields document={document} fields={section.fields} definitions={customFields}
            language={language} onDocumentChange={onDocumentChange} />}
          {"fields" in section && <CustomGroupFields document={document} fields={section.fields} definitions={customFields}
            groups={customGroups} language={language} onDocumentChange={onDocumentChange} />}
          </fieldset>
        </section>;
      })}
    </div>
  </div>;
}
