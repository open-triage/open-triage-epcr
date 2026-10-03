"use client";

import { AuthoringDraftToolbar } from "./authoring-draft-toolbar";

import { useUnsavedChanges } from "./unsaved-changes";

import { DefinitionFileImport } from "./definition-file-import";
import { importCanonicalDefinitionFile } from "../app/admin-context";

import { AdminText, useAdminError, useAdminText } from "../app/admin-localization";

import type { AuthoringVersionOption, CatalogDefinitionView, CatalogDraft, CatalogDraftCodeList, CatalogDraftCustomElement, CatalogDraftCustomGroup, CatalogDraftCustomTextElement, CatalogDraftCustomCodedElement } from "@open-triage/contracts";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LoadingStatus } from "./loading-status";
import { cloneCatalogDraft, loadActiveCatalogDefinition, loadCatalogDraft, loadCatalogVersion, loadCatalogVersions, publishCatalogDraft, saveCatalogDraft, deleteCatalogDraft, validateCatalogDraft } from "../app/admin-context";
import { AuthoringLifecycleAction, AuthoringVersionWorkspace } from "./authoring-version-workspace";
import { catalogTranslationIssues, updateCatalogChoiceEnglish, type TranslationIssue } from "../app/translation-diagnostics";
import { TranslationIssueSummary } from "./translation-issue-summary";
import { NEMSIS_DATA_MODEL, getNemsisDataElement } from "../app/nemsis-data-model";
import { customCorrelationLabel, customCorrelationOptions, customSpecialOptions, fixedGroupName } from "../app/custom-authoring-options";
import identifyingPolicy from "../../../packages/database/config/identifying-elements.json";

export const CUSTOM_NAMESPACE = "opentriage.org";
export const CATALOG_EDITOR_STORAGE_PREFIX = "open-triage:catalog-editor:";

/** The persisted key is globally unique even when installations use one namespace. */
export function customElementKey(organizationId: string, identifier: string): string {
  return `Org${organizationId.replaceAll("-", "")}_${identifier}`;
}
export function customElementIdentifier(organizationId: string | undefined, slug: string): string {
  const prefix = organizationId ? customElementKey(organizationId, "") : "";
  return prefix && slug.startsWith(prefix) ? slug.slice(prefix.length) : slug;
}
function codedChoiceLines(element: CatalogDraftCustomCodedElement): string {
  return element.choices.map((choice) => [choice.code, choice.label, choice.nemsisCode].filter(Boolean).join(" | ")).join("\n");
}

export function catalogAuthority(capabilities: ReadonlyArray<string>): {
  readonly canRead: boolean; readonly canWrite: boolean; readonly canPublish: boolean;
} {
  const canRead = capabilities.includes("catalog:read");
  const canWrite = canRead && capabilities.includes("catalog:write");
  return { canRead, canWrite, canPublish: canWrite && capabilities.includes("catalog:publish") };
}

export function CatalogAuthoring({ csrfToken, capabilities, ownerId, organizationId, onPublished, active = true, language = "sv" }: {
  readonly ownerId?: string;
  readonly organizationId?: string;
  readonly language?: string;
  readonly csrfToken: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly onPublished?: (catalogReleaseId: string) => void;
  readonly active?: boolean;
}) {
  const t = useAdminText();
  const storageKey = ownerId && organizationId ? `${CATALOG_EDITOR_STORAGE_PREFIX}${organizationId}:${ownerId}` : null;
  const adminError = useAdminError();
  const { canWrite, canPublish } = catalogAuthority(capabilities);
  const publicationAllowed = canPublish;
  const [draft, setDraft] = useState<CatalogDraft | CatalogDefinitionView | null>(null);
  const [versions, setVersions] = useState<AuthoringVersionOption[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editor, setEditor] = useState<"group" | "element" | "code-list">("element");
  const [codedDetails, setCodedDetails] = useState({ codeSystem: "", choices: "", nemsisElement: "", notValues: [] as string[], negatives: [] as string[] });
  const [query, setQuery] = useState("");
  const [editingLanguage, setEditingLanguage] = useState<"en" | "sv">("en");
  const [showMissing, setShowMissing] = useState(false);
  const [issueFilter, setIssueFilter] = useState("all");
  const [elementPage, setElementPage] = useState(0);
  const [elementFilter, setElementFilter] = useState<"all" | "fixed" | "custom">("all");
  const [elementEditorKey, setElementEditorKey] = useState<string | null>(null);
  const [groupEditorKey, setGroupEditorKey] = useState<string | null>(null);
  const [listEditorOpen, setListEditorOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedListKey, setSelectedListKey] = useState("");
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const [newGroup, setNewGroup] = useState({ namespace: CUSTOM_NAMESPACE, slug: "", title: "", swedishTitle: "", recurrence: "multiple" as CatalogDraftCustomGroup["recurrence"], correlatesTo: "" });
  const [customText, setCustomText] = useState({ namespace: CUSTOM_NAMESPACE, slug: "", title: "", definition: "",
    swedishTitle: "", swedishDefinition: "", usage: "Optional" as CatalogDraftCustomTextElement["usage"],
    identifying: "", datatype: "string" as CatalogDraftCustomElement["datatype"],
    recurrence: "single" as CatalogDraftCustomTextElement["recurrence"], correlatesTo: "", groupDefinitionId: "",
    minLength: "", maxLength: "", pattern: "", minimum: "", maximum: "" });
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [copySourceId, setCopySourceId] = useState<string | null>(null);
  const hasAuthoringDraft = Boolean(draft && "revision" in draft);
  const showError = useCallback((reason: unknown) => { setError(adminError(reason, "admin.catalogOperationFailed")); }, [adminError]);
  useEffect(() => {
    const load = async () => canWrite
      ? await loadCatalogDraft() ?? await loadActiveCatalogDefinition()
      : loadActiveCatalogDefinition();
    load().then((loadedDraft) => {
      if (storageKey && loadedDraft && "revision" in loadedDraft) {
        try {
          const saved = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null") as {
            draft?: CatalogDraft; dirty?: boolean; editor?: "group" | "element" | "code-list";
            customText?: typeof customText; codedDetails?: typeof codedDetails; newGroup?: typeof newGroup;
            editingCustomId?: string | null; query?: string; editingLanguage?: "en" | "sv"; selectedListKey?: string;
          } | null;
          if (saved?.draft?.id === loadedDraft.id && saved.draft.revision === loadedDraft.revision) {
            setDraft(saved.draft); setDirty(Boolean(saved.dirty));
            if (saved.editor) setEditor(saved.editor);
            if (saved.customText) setCustomText(saved.customText);
            if (saved.codedDetails) setCodedDetails(saved.codedDetails);
            if (saved.newGroup) setNewGroup({ ...saved.newGroup, swedishTitle: saved.newGroup.swedishTitle ?? "" });
            if (saved.editingCustomId) setEditingCustomId(saved.editingCustomId);
            if (saved.query) setQuery(saved.query);
            if (saved.editingLanguage) setEditingLanguage(saved.editingLanguage);
            if (saved.selectedListKey) setSelectedListKey(saved.selectedListKey);
            return;
          }
        } catch { /* A stale browser snapshot must never replace the server draft. */ }
      }
      setDraft(loadedDraft);
    }).catch(showError).finally(() => setLoaded(true));
  }, [canWrite, showError, storageKey]);
  useEffect(() => {
    if (!loaded || !storageKey) return;
    if (draft && "revision" in draft) {
      try { window.sessionStorage.setItem(storageKey, JSON.stringify({ draft, dirty, editor, customText, codedDetails,
        newGroup, editingCustomId, query, editingLanguage, selectedListKey })); }
      catch { window.queueMicrotask(() => setError(t("admin.catalogStorageFull"))); }
    } else window.sessionStorage.removeItem(storageKey);
  }, [loaded, storageKey, draft, dirty, editor, customText, codedDetails, newGroup, editingCustomId, query, editingLanguage, selectedListKey, t]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    loadCatalogVersions().then((items) => { if (current) {
      setVersions(items);
      setSelectedVersionId((selected) => items.some(({ id }) => id === selected) ? selected
        : items.find(({ status }) => status === "active")?.id ?? items[0]?.id ?? "");
    } }).catch((reason: unknown) => { if (current) showError(reason); });
    return () => { current = false; };
  }, [active, showError]);
  useEffect(() => {
    if (!loaded || !selectedVersionId || hasAuthoringDraft || draft?.id === selectedVersionId) return;
    let current = true;
    loadCatalogVersion(selectedVersionId).then((value) => { if (current) setDraft(value); })
      .catch((reason: unknown) => { if (current) showError(reason); });
    return () => { current = false; };
  }, [loaded, selectedVersionId, hasAuthoringDraft, draft?.id, showError]);
  const issues = useMemo(() => draft ? catalogTranslationIssues(draft.definition, editingLanguage) : [], [draft, editingLanguage]);
  const visible = useMemo(() => elementFilter === "custom" ? [] : draft?.definition.elements.filter((element) =>
    !draft.definition.hiddenElementIds?.includes(element.elementId) &&
    (!showMissing || !(editingLanguage === "en" ? element.label : element.localization?.sv?.label)?.trim()) &&
    `${element.elementId} ${element.label} ${element.localization?.sv?.label ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [draft, query, editingLanguage, showMissing, elementFilter]);
  const visibleCustom = elementFilter === "fixed" ? [] : draft?.definition.customElements?.filter((item) =>
    (!showMissing || !(editingLanguage === "en" ? item.title : item.localization?.sv?.label)?.trim()) &&
    `${item.namespace}.${item.slug} ${item.title} ${item.localization?.sv?.label ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const visibleGroups = NEMSIS_DATA_MODEL.groups.filter((group) => draft?.definition.elements.some((element) =>
    !draft.definition.hiddenElementIds?.includes(element.elementId) && element.storageSemantics.groupPath.includes(group.id)));
  const listOptions = useMemo(() => {
    if (!draft) return [];
    const options: { key: string; elementId: string; list?: CatalogDraftCodeList; custom?: CatalogDraftCustomCodedElement }[] = draft.definition.codeLists.flatMap((list) =>
      (list.elementIds.length ? list.elementIds : [list.name])
        .filter((elementId) => !draft.definition.hiddenElementIds?.includes(elementId))
        .map((elementId) => ({ key: `${list.listId}\u0000${elementId}`, elementId, list })));
    for (const element of draft.definition.elements) {
      if (!draft.definition.hiddenElementIds?.includes(element.elementId) &&
        element.specialChoices?.length &&
        !options.some((option) => option.elementId === element.elementId)) {
        options.push({ key: `special\u0000${element.elementId}`, elementId: element.elementId });
      }
    }
    for (const custom of draft.definition.customElements ?? []) if (custom.datatype === "coded") {
      options.push({ key: `custom:${custom.id}`, elementId: customElementIdentifier(organizationId, custom.slug), custom });
    }
    return options;
  }, [draft, organizationId]);
  const selectedOption = listOptions.find(({ key }) => key === selectedListKey) ?? listOptions[0];
  const correlationOptions = draft ? customCorrelationOptions(draft.definition) : [];
  const correlationLabel = (groupId?: string) => customCorrelationLabel(groupId, editingLanguage);
  const selectedList = selectedOption?.list;
  const selectedElement = draft?.definition.elements.find((element) => element.elementId === selectedOption?.elementId);
  const editingFixedElement = elementEditorKey?.startsWith("fixed:")
    ? draft?.definition.elements.find((element) => element.elementId === elementEditorKey.slice(6)) : undefined;
  const editingFixedSource = editingFixedElement ? getNemsisDataElement(editingFixedElement.elementId) : undefined;
  const editingFixedLists = editingFixedElement ? draft?.definition.codeLists.filter((list) => list.elementIds.includes(editingFixedElement.elementId)) ?? [] : [];
  const editingFixedCodeLabels = new Map(editingFixedLists.flatMap((list) => list.values.map((value) => [value.code, value.localization?.sv?.label] as const)));
  const copyFixedSource = copySourceId?.startsWith("fixed:") ? getNemsisDataElement(copySourceId.slice(6)) : undefined;
  const copyFixedElementDefinition = copySourceId?.startsWith("fixed:")
    ? draft?.definition.elements.find((element) => element.elementId === copySourceId.slice(6)) : undefined;
  const copiedFixedCodeLabels = new Map((copyFixedSource ? draft?.definition.codeLists.filter((list) => list.elementIds.includes(copyFixedSource.id)) ?? [] : [])
    .flatMap((list) => list.values.map((value) => [value.code, value.localization?.sv?.label] as const)));
  const editingCustomElement = elementEditorKey?.startsWith("custom:")
    ? draft?.definition.customElements?.find((element) => element.id === elementEditorKey.slice(7)) : undefined;
  const copiedCustomElement = draft?.definition.customElements?.find((element) => element.id === copySourceId);
  const displayedCodedElement = editingCustomElement?.datatype === "coded" ? editingCustomElement
    : copiedCustomElement?.datatype === "coded" ? copiedCustomElement : undefined;
  const editingGroup = draft?.definition.customGroups?.find((group) => group.id === groupEditorKey);

  function loadCustomElement(item: CatalogDraftCustomElement, copy = false) {
    setElementEditorKey(copy ? "new" : `custom:${item.id}`);
    setEditingCustomId(copy ? null : item.id);
    setCopySourceId(copy ? item.id : null);
    setError("");
    setCustomText({ namespace: item.namespace, slug: customElementIdentifier(organizationId, item.slug), title: item.title,
      definition: item.definition, swedishTitle: item.localization?.sv?.label ?? "", swedishDefinition: item.localization?.sv?.description ?? "",
      usage: item.usage, identifying: item.identifying ? "yes" : "no", datatype: item.datatype,
      recurrence: item.recurrence, correlatesTo: item.correlatesTo ?? "", groupDefinitionId: item.groupDefinitionId ?? "",
      minLength: item.datatype === "coded" ? "" : String(item.constraints.minLength ?? ""),
      maxLength: item.datatype === "coded" ? "" : String(item.constraints.maxLength ?? ""),
      pattern: item.datatype === "coded" ? "" : item.constraints.pattern ?? "",
      minimum: item.datatype === "coded" ? "" : String(item.constraints.minimum ?? ""),
      maximum: item.datatype === "coded" ? "" : String(item.constraints.maximum ?? "") });
    setCodedDetails(item.datatype === "coded" ? { codeSystem: item.codeSystem,
      choices: codedChoiceLines(item),
      nemsisElement: item.nemsisElement ?? "", notValues: [...item.permittedNotValues], negatives: [...item.permittedPertinentNegatives] }
      : { codeSystem: "", choices: "", nemsisElement: "", notValues: [], negatives: [] });
  }

  function copyFixedElement(element: NonNullable<typeof editingFixedElement>) {
    const source = getNemsisDataElement(element.elementId);
    const sourceConstraints = source?.datatype.constraints;
    const inlineChoices = source?.valueSource.kind === "inline-enumerated" ? source.valueSource.values : [];
    const base = source?.datatype.base ?? element.baseDatatype;
    const datatype: CatalogDraftCustomElement["datatype"] = inlineChoices.length ? "coded"
      : base === "integer" || base === "decimal" ? "number"
        : base === "date" || base === "dateTime" ? "dateTime" : base === "binary" ? "binary" : "string";
    const targetGroup = [...(source?.groupPath ?? element.storageSemantics.groupPath)].reverse()
      .find((id) => correlationOptions.some((group) => group.id === id)) ?? "";
    setElementEditorKey("new"); setEditingCustomId(null); setCopySourceId(`fixed:${element.elementId}`);
    setError("");
    if (!hasAuthoringDraft) {
      setStatus(language === "sv" ? "Skapa ett katalogutkast ovan för att spara kopian." : "Create a catalog draft above to save the copy.");
      requestAnimationFrame(() => document.getElementById("catalog-draft-name")?.focus());
    }
    setCustomText({ namespace: CUSTOM_NAMESPACE, slug: element.elementId, title: element.label.slice(0, 100),
      definition: (element.description || source?.definition || element.label).slice(0, 255),
      swedishTitle: element.localization?.sv?.label ?? "", swedishDefinition: element.localization?.sv?.description ?? "",
      usage: source?.usage ?? "Optional", identifying: identifyingPolicy.elements.includes(element.elementId) ? "yes" : "no",
      datatype, recurrence: source?.occurrence.max === "unbounded" || typeof source?.occurrence.max === "number" && source.occurrence.max > 1 ? "multiple" : "single",
      correlatesTo: targetGroup, groupDefinitionId: "",
      minLength: typeof sourceConstraints?.minLength === "number" ? String(sourceConstraints.minLength) : "",
      maxLength: typeof sourceConstraints?.maxLength === "number" ? String(Math.min(sourceConstraints.maxLength, 100000)) : "",
      pattern: typeof sourceConstraints?.pattern === "string" && sourceConstraints.pattern.length <= 255 ? sourceConstraints.pattern : "",
      minimum: typeof sourceConstraints?.minInclusive === "number" ? String(sourceConstraints.minInclusive) : "",
      maximum: typeof sourceConstraints?.maxInclusive === "number" ? String(sourceConstraints.maxInclusive) : "" });
    setCodedDetails({ codeSystem: inlineChoices.length ? `https://opentriage.org/organizations/${organizationId ?? "local"}/codes/${element.elementId}` : "",
      choices: inlineChoices.map((choice) => `${choice.code} | ${choice.label} | ${choice.code}`).join("\n"),
      nemsisElement: inlineChoices.length ? element.elementId : "",
      notValues: source?.permittedNotValues.map((choice) => choice.code) ?? [],
      negatives: source?.permittedPertinentNegatives.map((choice) => choice.code) ?? [] });
  }

  function editCodeList(next: CatalogDraftCodeList, announcement: string) {
    if (draft?.definition.codeLists.find((list) => list.listId === next.listId) === next) {
      setStatus(announcement); setError(""); return;
    }
    setDraft((current) => current ? { ...current, definition: { ...current.definition,
      codeLists: current.definition.codeLists.map((list) => list.listId === next.listId ? next : list) } } : current);
    setDirty(true); setStatus(`Unsaved changes. ${announcement}`); setError("");
  }
  function updateCustom(id: string, update: (item: CatalogDraftCustomElement) => CatalogDraftCustomElement) {
    setDraft((current) => current ? { ...current, definition: { ...current.definition,
      customElements: current.definition.customElements?.map((item) => item.id === id ? update(item) : item) } } : current);
    setDirty(true); setStatus(t("admin.unsavedChanges")); setError("");
  }
  async function addCustomText() {
    if (!draft || !canWrite || !("revision" in draft)) return;
    const wordingError = customText.title.trim().length < 2
      ? t("admin.customEnglishTitleTooShort")
      : customText.definition.trim().length < 2
        ? t("admin.customEnglishDefinitionTooShort")
        : customText.swedishDefinition.trim() && !customText.swedishTitle.trim()
          ? t("admin.customSwedishTitleRequired")
          : null;
    if (editingCustomId) {
      const existing = draft.definition.customElements?.find((item) => item.id === editingCustomId);
      if (!existing || existing.retired) { setError(t("admin.customElementUnavailable")); return; }
      if (wordingError) { setError(wordingError); return; }
      const nextDraft = { ...draft, definition: { ...draft.definition,
        customElements: draft.definition.customElements?.map((item) => {
          if (item.id !== editingCustomId) return item;
          const nextTitle = customText.title.trim(); const nextDefinition = customText.definition.trim();
          const nextSwedishTitle = customText.swedishTitle.trim(); const nextSwedishDefinition = customText.swedishDefinition.trim();
          const swedishChanged = nextSwedishTitle !== (item.localization?.sv?.label ?? "") ||
            nextSwedishDefinition !== (item.localization?.sv?.description ?? "");
          return { ...item, title: nextTitle, definition: nextDefinition,
            ...(nextSwedishTitle || nextSwedishDefinition || item.localization?.sv ? {
              localization: { schemaVersion: 1 as const, sv: {
                label: nextSwedishTitle, description: nextSwedishDefinition,
                reviewedSource: swedishChanged ? { label: nextTitle, description: nextDefinition }
                  : item.localization?.sv?.reviewedSource ?? { label: item.title, description: item.definition } } } } : {}) };
        }) } };
      const saved = await saveCatalogDraft(csrfToken, nextDraft);
      setDraft(saved); setDirty(false); setError(""); setStatus(`${t("admin.customRevisionSaved")} Saved revision ${saved.revision}.`); setEditingCustomId(null); setElementEditorKey(null);
      setCustomText({ namespace: CUSTOM_NAMESPACE, slug: "", title: "", definition: "", swedishTitle: "", swedishDefinition: "",
        usage: "Optional", identifying: "", datatype: "string", recurrence: "single", correlatesTo: "", groupDefinitionId: "",
        minLength: "", maxLength: "", pattern: "", minimum: "", maximum: "" });
      return;
    }
    const copySource = draft.definition.customElements?.find((item) => item.id === copySourceId);
    if (copySourceId?.startsWith("fixed:") && !customText.slug.trim()) {
      setError(t("admin.customCopyIdRequired")); return;
    }
    const sourceIdentifier = copySourceId?.startsWith("fixed:") ? copySourceId.slice(6)
      : copySource ? customElementIdentifier(organizationId, copySource.slug) : null;
    if (sourceIdentifier && customText.slug.trim() === sourceIdentifier) {
      setError(t("admin.customCopyIdUnchanged")); return;
    }
    if (!customText.slug.trim()) { setError(t("admin.customElementIdRequired")); return; }
    if (customText.slug.trim() && !/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(customText.slug.trim())) {
      setError(t("admin.customElementIdInvalid")); return;
    }
    const selectedGroup = draft.definition.customGroups?.find((group) => group.id === customText.groupDefinitionId);
    const namespace = selectedGroup?.namespace ?? copySource?.namespace ?? CUSTOM_NAMESPACE;
    const slug = customElementKey(organizationId ?? "", customText.slug.trim());
    if (!namespace) { setError(t("admin.customNamespaceRequired")); return; }
    if (wordingError) { setError(wordingError); return; }
    if (!customText.identifying) { setError(t("admin.customIdentifyingRequired")); return; }
    if (draft.definition.customElements?.some((item) => (item.namespace === namespace && item.slug === slug) ||
      customElementIdentifier(organizationId, item.slug) === customText.slug.trim())) {
      setError(t("admin.customElementIdDuplicate", { id: customText.slug.trim() })); return;
    }
    if (customText.datatype === "string" || customText.datatype === "other") {
      const minimumLength = customText.minLength ? Number(customText.minLength) : undefined;
      const maximumLength = customText.maxLength ? Number(customText.maxLength) : undefined;
      if ([minimumLength, maximumLength].some((value) => value !== undefined &&
        (!Number.isInteger(value) || value < 0 || value > 100000))) {
        setError(t("admin.customLengthInvalid")); return;
      }
      if (minimumLength !== undefined && maximumLength !== undefined && minimumLength > maximumLength) {
        setError(t("admin.customLengthOrderInvalid")); return;
      }
      if (customText.pattern) {
        if (customText.pattern.length > 255) { setError(t("admin.customPatternTooLong")); return; }
        try { new RegExp(customText.pattern); } catch {
          setError(t("admin.customPatternInvalid")); return;
        }
      }
    }
    if (customText.datatype === "number" && customText.minimum && customText.maximum &&
      Number(customText.minimum) > Number(customText.maximum)) {
      setError(t("admin.customNumberOrderInvalid")); return;
    }
    const base: CatalogDraftCustomTextElement = { id: crypto.randomUUID(), namespace, slug,
      title: customText.title.trim(), definition: customText.definition.trim(), datatype: customText.datatype as CatalogDraftCustomTextElement["datatype"],
      recurrence: customText.recurrence,
      ...(customText.correlatesTo ? { correlatesTo: customText.correlatesTo as NonNullable<CatalogDraftCustomTextElement["correlatesTo"]> } : {}),
      ...(customText.groupDefinitionId ? { groupDefinitionId: customText.groupDefinitionId } : {}),
      usage: customText.usage, identifying: customText.identifying === "yes",
      constraints: customText.datatype === "string" || customText.datatype === "other" ? { ...(customText.minLength ? { minLength: Number(customText.minLength) } : {}),
        ...(customText.maxLength ? { maxLength: Number(customText.maxLength) } : {}),
        ...(customText.pattern ? { pattern: customText.pattern } : {}) } : customText.datatype === "number"
        ? { ...(customText.minimum ? { minimum: Number(customText.minimum) } : {}),
          ...(customText.maximum ? { maximum: Number(customText.maximum) } : {}) } : {},
      };
    let element: CatalogDraftCustomElement = { ...base,
      ...(copySource?.localization ? { localization: copySource.localization } : {}),
      ...(customText.swedishTitle.trim() || customText.swedishDefinition.trim() ? { localization: { schemaVersion: 1 as const, sv: {
        label: customText.swedishTitle.trim(), description: customText.swedishDefinition.trim(),
        reviewedSource: { label: base.title, description: base.definition } } } } : {}) };
    if (customText.datatype === "coded") {
      const unchangedCopiedChoices = copySource?.datatype === "coded" && codedDetails.choices === codedChoiceLines(copySource)
        ? copySource.choices.map((choice) => ({ ...choice })) : null;
      const parsed = codedDetails.choices.split(/\r?\n/).map((line, index) => ({ line: index + 1,
        parts: line.split("|").map((part) => part.trim()) })).filter(({ parts }) => parts.some(Boolean));
      const mappedCodes = draft.definition.codeLists.flatMap((list) => list.elementIds.includes(codedDetails.nemsisElement) ? list.values : []);
      const mappedSource = getNemsisDataElement(codedDetails.nemsisElement);
      if (mappedSource?.valueSource.kind === "inline-enumerated") mappedCodes.push(...mappedSource.valueSource.values.map((choice) =>
        ({ ...choice, codeSystem: "", sourceLabel: choice.label, category: null, enabled: true })));
      if (!codedDetails.codeSystem.trim()) { setError(t("admin.customCodeSystemRequired")); return; }
      if (!/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(codedDetails.codeSystem.trim()) || codedDetails.codeSystem.trim().length > 255) {
        setError(t("admin.customCodeSystemInvalid")); return;
      }
      if (/^urn:nemsis(?::|$)/i.test(codedDetails.codeSystem.trim())) { setError(t("admin.customCodeSystemNemsisReserved")); return; }
      if (!unchangedCopiedChoices) {
        if (!parsed.length) { setError(t("admin.customChoiceRequired")); return; }
        for (const { line, parts } of parsed) {
          if (parts.length > 3 || !parts[0] || !parts[1]) { setError(t("admin.customChoiceFormatInvalid", { line })); return; }
          if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(parts[0])) { setError(t("admin.customChoiceCodeInvalid", { line })); return; }
          if (parts[1].length > 255) { setError(t("admin.customChoiceLabelTooLong", { line })); return; }
          if (parts[2] && !mappedCodes.some((value) => value.code === parts[2])) { setError(t("admin.customChoiceNemsisUnavailable", { line, code: parts[2] })); return; }
        }
        const seen = new Set<string>();
        for (const { parts } of parsed) {
          if (seen.has(parts[0]!)) { setError(t("admin.customChoiceCodeDuplicate", { code: parts[0]! })); return; }
          seen.add(parts[0]!);
        }
      }
      const { constraints: _constraints, ...common } = base;
      element = { ...common, ...(element.localization ? { localization: element.localization } : {}), datatype: "coded", codeSystem: codedDetails.codeSystem.trim(),
        choices: unchangedCopiedChoices ?? parsed.map(({ parts: [code, label, nemsisCode] }) => ({ code: code!, label: label!, ...(nemsisCode ? { nemsisCode } : {}),
          ...(copySource?.datatype === "coded" && copySource.choices.find((choice) => choice.code === code)?.localization
            ? { localization: copySource.choices.find((choice) => choice.code === code)!.localization } : {}) })),
        ...(codedDetails.nemsisElement ? { nemsisElement: codedDetails.nemsisElement } : {}),
        permittedNotValues: codedDetails.notValues, permittedPertinentNegatives: codedDetails.negatives };
    }
    const saved = await saveCatalogDraft(csrfToken, { ...draft, definition: { ...draft.definition,
      customElements: [...(draft.definition.customElements ?? []), element] } });
    setDraft(saved);
    setCodedDetails({ codeSystem: "", choices: "", nemsisElement: "", notValues: [], negatives: [] });
    setDirty(false); setError(""); setStatus(t("admin.customAdded", { identity: customText.slug.trim() })); setElementEditorKey(null); setCopySourceId(null);
    setCustomText({ namespace: CUSTOM_NAMESPACE, slug: "", title: "", definition: "", swedishTitle: "", swedishDefinition: "",
      usage: "Optional", identifying: "", datatype: "string", recurrence: "single", correlatesTo: "", groupDefinitionId: "",
      minLength: "", maxLength: "", pattern: "", minimum: "", maximum: "" });
  }
  async function action(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { showError(reason); } finally { setBusy(false); }
  }

  const versionWorkspace = <AuthoringVersionWorkspace title="Catalog" versions={versions} selectedId={selectedVersionId}
    onSelect={setSelectedVersionId} draftName={newDisplayName} onDraftNameChange={setNewDisplayName}
    canWrite={canWrite} busy={busy} hasDraft={Boolean(draft && "revision" in draft)}
    onCreateDraft={() => action(async () => {
      const cloned = await cloneCatalogDraft(csrfToken, newDisplayName, selectedVersionId);
      setDraft(cloned); setNewDisplayName(""); setDirty(false); setStatus(t("admin.catalogDraftCreated"));
    })}>
    {canPublish && <DefinitionFileImport kind="catalog" busy={busy} hasDraft={hasAuthoringDraft}
      onImport={(file) => action(async () => {
        const imported = await importCanonicalDefinitionFile(csrfToken, "catalog", file, selectedVersionId || undefined);
        setStatus(t("admin.definitionImported"));
        try {
          setVersions(await loadCatalogVersions()); setSelectedVersionId(imported.id);
        } catch { setError(t("admin.definitionImportedRefreshFailed")); }
      })} />}
      <p role="note"><AdminText messageKey="admin.publishedCatalogActivatedWithForm" /></p>
    </AuthoringVersionWorkspace>;

  if (!loaded) return <LoadingStatus><AdminText messageKey="admin.loadingCatalogDraft" /></LoadingStatus>;
  if (!draft) return <div className="catalog-empty">
    {versionWorkspace}
    {error && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;

  const authoringDraft = "revision" in draft ? draft : null;
  const canEdit = canWrite && authoringDraft !== null && !busy;
  const elementCount = visible.length + visibleCustom.length;
  const currentPage = Math.min(elementPage, Math.max(0, Math.ceil(elementCount / 25) - 1));

  return <div className="catalog-editor">
    {versionWorkspace}
    {authoringDraft && <AuthoringDraftToolbar label={t("admin.catalogDraftActions")} busy={busy} dirty={dirty}>
      {canWrite && <button className="button-primary" type="button" disabled={busy} onClick={() => action(async () => {
        const saved = await saveCatalogDraft(csrfToken, authoringDraft); setDraft(saved); setDirty(false); setStatus(`Saved revision ${saved.revision}.`);
      })}><AdminText messageKey="admin.saveDraft" /></button>}
      {canWrite && <button className="button-danger" type="button" disabled={busy} onClick={() => {
        if (!window.confirm(t("admin.deleteCatalogDraftConfirm"))) return;
        void action(async () => {
          await deleteCatalogDraft(csrfToken, authoringDraft);
          const [activeCatalog, items] = await Promise.all([loadActiveCatalogDefinition(), loadCatalogVersions()]);
          setDraft(activeCatalog); setVersions(items); setDirty(false); setNote("");
          setSelectedVersionId(items.find(({ status }) => status === "active")?.id ?? items[0]?.id ?? "");
          setStatus(t("admin.catalogDraftDeleted"));
        });
      }}><AdminText messageKey="admin.deleteCatalogDraft" /></button>}
      {authoringDraft && <button type="button" disabled={busy || dirty} onClick={() => action(async () => {
        const result = await validateCatalogDraft(csrfToken, authoringDraft.id);
        setStatus(result.valid && result.projectionsVerified ? `Catalog is valid. ${result.warnings?.length ?? 0} localization warnings.` : result.findings.join("; "));
      })}><AdminText messageKey="admin.validate" /></button>}
    </AuthoringDraftToolbar>}
    {copySourceId?.startsWith("fixed:") && !authoringDraft && <p role="note">{language === "sv" ? "Skapa ett katalogutkast för att slutföra kopian." : "Create a catalog draft to finish copying this NEMSIS element."}</p>}
    <p>{"revision" in draft ? `Draft revision ${draft.revision}. Stable identity, datatype, and storage semantics are read-only.`
      : canWrite ? `${draft.status === "active" ? t("admin.active") : t("admin.published")} Catalog ${draft.displayName}, version ${draft.version}. Create a draft to edit it.`
        : `${draft.status === "active" ? t("admin.active") : t("admin.published")} Catalog ${draft.displayName}, version ${draft.version}. You have read-only access to this definition.`}</p>
    <nav className="form-actions" aria-label={language === "sv" ? "Katalogredigerare" : "Catalog editors"}>
      {([['group', 'Group', 'Grupp'], ['element', 'Element', 'Element'], ['code-list', 'Code List', 'Kodlista']] as const).map(([value, en, sv]) =>
        <button type="button" key={value} aria-pressed={editor === value} onClick={() => setEditor(value)}>{language === "sv" ? sv : en}</button>)}
    </nav>
    <label htmlFor="catalog-edit-language"><AdminText messageKey="admin.editingLanguage" /></label>
    <select id="catalog-edit-language" value={editingLanguage} onChange={(event) => { setEditingLanguage(event.target.value as "en" | "sv"); setElementPage(0); }}>
      <option value="en"><AdminText messageKey="admin.englishSource" /></option><option value="sv"><AdminText messageKey="admin.swedishTranslation" /></option>
    </select>
    <TranslationIssueSummary issues={issues} filter={issueFilter} onFilter={setIssueFilter} onNavigate={(issue) => {
      setEditor(issue.field === "name" || issue.field.includes(" ") ? "code-list" : "element");
      setEditingLanguage(issue.kind === "english" ? "en" : "sv"); setShowMissing(false); setQuery(issue.id); setElementPage(0);
      if (issue.field === "name" || issue.field.includes(" ")) { setSelectedListKey(listOptions.find(({ list, elementId }) => issue.field.startsWith("pertinent-negative ") || issue.field.startsWith("not-value ") ? elementId === issue.id : list?.listId === issue.id)?.key ?? ""); setListEditorOpen(true); }
      else setElementEditorKey(`fixed:${issue.id}`);
      requestAnimationFrame(() => document.getElementById("catalog-search")?.focus());
    }} />
    {editor === "element" && <section className="catalog-element-editor" aria-labelledby="element-catalog-heading">
    <h3 id="element-catalog-heading">Element</h3>
    <p role="note">{language === "sv" ? "NEMSIS-element är skrivskyddade." : "NEMSIS elements are read-only."}</p>
    <div className="catalog-list-toolbar">
      <button type="button" className="catalog-primary-action" disabled={!canEdit} onClick={() => {
        setElementEditorKey("new"); setEditingCustomId(null); setCopySourceId(null); setError("");
        setCustomText({ namespace: CUSTOM_NAMESPACE, slug: "", title: "", definition: "", swedishTitle: "", swedishDefinition: "", usage: "Optional", identifying: "",
          datatype: "string", recurrence: "single", correlatesTo: "", groupDefinitionId: "", minLength: "", maxLength: "", pattern: "", minimum: "", maximum: "" });
        setCodedDetails({ codeSystem: "", choices: "", nemsisElement: "", notValues: [], negatives: [] });
      }}>
        {language === "sv" ? "Nytt element" : "New element"}</button>
      <label>{language === "sv" ? "Visa element" : "Show elements"} <select aria-label={language === "sv" ? "Filtrera element" : "Filter elements"} value={elementFilter}
        onChange={(event) => { setElementFilter(event.target.value as typeof elementFilter); setElementPage(0); }}>
        <option value="all">{language === "sv" ? "Alla" : "All"}</option><option value="fixed">{language === "sv" ? "Fasta" : "Fixed"}</option>
        <option value="custom">{language === "sv" ? "Anpassade" : "Custom"}</option>
      </select></label>
    </div>
    <label><input type="checkbox" checked={showMissing} onChange={(event) => { setShowMissing(event.target.checked); setElementPage(0); }} /> {t("admin.showFieldsMissing", { language: t(editingLanguage === "en" ? "English" : "Swedish") })}</label>
    <label htmlFor="catalog-search"><AdminText messageKey="admin.findByIdentifierOr" /></label>
    <input id="catalog-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setElementPage(0); }} />
    <div className="catalog-elements" aria-label="Catalog elements">
      <table>
        <thead><tr><th><AdminText messageKey="admin.element" /></th><th><AdminText messageKey="admin.labelAndDescription" /></th><th><AdminText messageKey="admin.typeAndStorage" /></th><th>{language === "sv" ? "Åtgärd" : "Action"}</th></tr></thead>
        <tbody>
          {visible.slice(currentPage * 25, (currentPage + 1) * 25).map((element) => <tr key={element.elementId}>
            <th scope="row">{element.elementId}</th>
            <td><strong>{editingLanguage === "sv" ? element.localization?.sv?.label || "—" : element.label}</strong><small>{editingLanguage === "sv" ? element.localization?.sv?.description || "—" : element.description}</small></td>
            <td>{element.baseDatatype} · {element.storageSemantics.analyticalLocation}</td>
            <td><button type="button" onClick={() => setElementEditorKey(`fixed:${element.elementId}`)}>{language === "sv" ? "Visa" : "View"}</button>
              {canWrite && <button type="button" onClick={() => copyFixedElement(element)}>{language === "sv" ? "Kopiera element" : "Copy element"}</button>}</td>
          </tr>)}
          {visibleCustom.slice(Math.max(0, currentPage * 25 - visible.length), Math.max(0, (currentPage + 1) * 25 - visible.length)).map((item) => <tr key={item.id}>
            <th scope="row">{customElementIdentifier(organizationId, item.slug)}{item.retired && <small>{t("admin.customRetired")}</small>}</th>
            <td><strong>{editingLanguage === "sv" ? item.localization?.sv?.label || "—" : item.title}</strong><small>{editingLanguage === "sv" ? item.localization?.sv?.description || "—" : item.definition}</small></td>
            <td>{item.datatype} · {item.recurrence} · {correlationLabel(item.correlatesTo)}</td>
            <td><button type="button" onClick={() => loadCustomElement(item)}>{canEdit && !item.retired ? (language === "sv" ? "Redigera" : "Edit") : (language === "sv" ? "Visa" : "View")}</button></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {elementCount > 25 && <nav className="form-actions" aria-label={t("admin.catalogElementPages")}>
      <button type="button" disabled={currentPage === 0} onClick={() => setElementPage(currentPage - 1)}><AdminText messageKey="admin.previousElements" /></button>
      <span>{t("admin.pagePageOf", { page: currentPage + 1, pages: Math.ceil(elementCount / 25), count: elementCount })}</span>
      <button type="button" disabled={(currentPage + 1) * 25 >= elementCount}
        onClick={() => setElementPage(currentPage + 1)}><AdminText messageKey="admin.nextElements" /></button>
    </nav>}
      {editingFixedElement && <section className="catalog-item-editor" aria-label={`${editingFixedElement.elementId} element editor`}>
        <div className="catalog-item-heading"><h4>{editingFixedElement.elementId} — {editingLanguage === "sv" ? editingFixedElement.localization?.sv?.label || "—" : editingFixedElement.label}</h4>
          <button type="button" onClick={() => setElementEditorKey(null)}>Close</button></div>
        <p role="note">{language === "sv" ? "Fast NEMSIS-element. Skrivskyddat." : "Fixed NEMSIS element. Read-only."}</p>
        <fieldset className="custom-element-form catalog-metadata-fields" disabled>
          <legend>{language === "sv" ? "Elementmetadata" : "Element metadata"}</legend>
          <label>{language === "sv" ? "Namnrymd" : "Namespace"} <input value="NEMSIS" readOnly /></label>
          <label>{language === "sv" ? "Datatyp" : "Data type"} <input value={editingFixedSource?.datatype.base ?? editingFixedElement.baseDatatype} readOnly /></label>
          <label>Source datatype <input value={editingFixedSource?.sourceDatatype ?? editingFixedElement.storageSemantics.sourceDatatype} readOnly /></label>
          <label>XSD base <input value={editingFixedSource?.datatype.xsdBase ?? ""} readOnly /></label>
          <label>{t("admin.customIdentifier")} <input value={editingFixedElement.elementId} readOnly /></label>
          <label>Identity <input value={editingFixedElement.identityId} readOnly /></label>
          {editingLanguage === "en" ? <>
            <label>{t("admin.customEnglishTitle")} <input value={editingFixedElement.label} readOnly /></label>
            <label>{t("admin.customEnglishDefinition")} <textarea value={editingFixedElement.description || editingFixedSource?.definition || ""} readOnly /></label>
          </> : <>
            <label>{t("admin.customSwedishTitle")} <input value={editingFixedElement.localization?.sv?.label ?? ""} readOnly /></label>
            <label>{t("admin.customSwedishDefinition")} <textarea value={editingFixedElement.localization?.sv?.description ?? ""} readOnly /></label>
          </>}
          <label>{t("admin.customUsage")} <input value={editingFixedSource?.usage ?? ""} readOnly /></label>
          <label>National <input value={editingFixedSource?.national ? "Yes" : "No"} readOnly /></label>
          <label>State <input value={editingFixedSource?.state ? "Yes" : "No"} readOnly /></label>
          <label>{language === "sv" ? "Upprepning" : "Recurrence"} <input value={editingFixedSource?.occurrence.max === "unbounded" || typeof editingFixedSource?.occurrence.max === "number" && editingFixedSource.occurrence.max > 1 ? "multiple" : "single"} readOnly /></label>
          <label>{language === "sv" ? "Koppla till" : "Correlate with"} <input value={[...(editingFixedSource?.groupPath ?? editingFixedElement.storageSemantics.groupPath)].reverse()
            .find((id) => correlationOptions.some((group) => group.id === id)) ?? ""} readOnly /></label>
          <label>{language === "sv" ? "Gruppväg" : "Group path"} <input value={(editingFixedSource?.groupPath ?? editingFixedElement.storageSemantics.groupPath).join(" / ")} readOnly /></label>
          <label>{t("admin.customIdentifying")} <input value={identifyingPolicy.elements.includes(editingFixedElement.elementId) ? "Yes" : "No"} readOnly /></label>
          <label>{language === "sv" ? "Lagring" : "Storage"} <input value={`${editingFixedElement.storageSemantics.analyticalLocation} · ${editingFixedElement.storageSemantics.sqlType}`} readOnly /></label>
          <label>Minimum occurrences <input value={editingFixedElement.constraints.minOccurs} readOnly /></label>
          <label>Maximum occurrences <input value={editingFixedElement.constraints.maxOccurs ?? "unbounded"} readOnly /></label>
          <label>Nillable <input value={editingFixedElement.constraints.nillable ? "Yes" : "No"} readOnly /></label>
          <label>Supports NOT values <input value={editingFixedElement.constraints.supportsNotValues ? "Yes" : "No"} readOnly /></label>
          <label>Supports pertinent negatives <input value={editingFixedElement.constraints.supportsPertinentNegatives ? "Yes" : "No"} readOnly /></label>
          {Object.entries(editingFixedSource?.datatype.constraints ?? {}).map(([key, value]) => <label key={key}>{key} <input value={String(value)} readOnly /></label>)}
        </fieldset>
        {editingFixedSource && <>
          <details><summary>{language === "sv" ? "Kodkällor och val" : "Code sources and choices"}</summary>
            <p>{editingFixedSource.valueSource.kind}</p>
            {editingFixedSource.valueSource.kind === "inline-enumerated" && <ol>{editingFixedSource.valueSource.values.map((choice) =>
              <li key={choice.code}>{choice.code} — {editingLanguage === "sv" ? editingFixedCodeLabels.get(choice.code) || "—" : choice.label}</li>)}</ol>}
            {editingFixedSource.valueSource.kind === "external-code-system" && <ul>{editingFixedSource.valueSource.systems.map((system) =>
              <li key={system.id}>{editingLanguage === "sv" ? system.id : system.label} — {system.url}</li>)}</ul>}
            {"bundledListIds" in editingFixedSource.valueSource && <p>Bundled lists: {editingFixedSource.valueSource.bundledListIds.join(", ") || "—"}</p>}
            {editingFixedLists.map((list) =>
              <div key={list.listId}><h5>{editingLanguage === "sv" ? list.localization?.sv?.name || list.name : list.name}</h5>
                <button type="button" onClick={() => {
                  setSelectedListKey(`${list.listId}\u0000${editingFixedElement.elementId}`); setListEditorOpen(true); setEditor("code-list");
                }}>{language === "sv" ? "Redigera värden" : "Edit values"}</button>
                <ol>{list.values.map((value) =>
                <li key={`${value.codeSystem}:${value.code}`}>{value.code} — {editingLanguage === "sv" ? value.localization?.sv?.label || "—" : value.label}</li>)}</ol></div>)}
          </details>
          <details><summary>{language === "sv" ? "Tillåtna specialvärden" : "Permitted special values"}</summary>
            <p>NOT: {editingFixedSource.permittedNotValues.map((choice) => `${choice.code} — ${editingLanguage === "sv" ?
              editingFixedElement.specialChoices?.find((item) => item.kind === "not-value" && item.code === choice.code)?.localization?.sv?.label || "—" : choice.label}`).join(", ") || "—"}</p>
            <p>PN: {editingFixedSource.permittedPertinentNegatives.map((choice) => `${choice.code} — ${editingLanguage === "sv" ?
              editingFixedElement.specialChoices?.find((item) => item.kind === "pertinent-negative" && item.code === choice.code)?.localization?.sv?.label || "—" : choice.label}`).join(", ") || "—"}</p>
          </details>
        </>}
        {canWrite && <button type="button" onClick={() => copyFixedElement(editingFixedElement)}>{language === "sv" ? "Kopiera element" : "Copy element"}</button>}
      </section>}
      {editingCustomElement && (!canEdit || editingCustomElement.retired) && <button type="button" onClick={() => setElementEditorKey(null)}>Close</button>}
      {((elementEditorKey === "new" && canEdit) || editingCustomElement) && <fieldset className="custom-element-form catalog-item-editor" disabled={busy || !canEdit || Boolean(editingCustomElement?.retired)}>
        <legend>{copySourceId ? (language === "sv" ? "Kopiera element" : "Copy element") : editingCustomId ? t("admin.customRevise") : (language === "sv" ? "Skapa element" : "Create element")}</legend>
        {editingCustomId && <p>{t("admin.customRevisionHint")}</p>}
        {copySourceId && <p role="note">{copySourceId.startsWith("fixed:")
          ? t("admin.customCopyFixedHint", { id: copySourceId.slice(6) })
          : t("admin.customCopyCustomHint")}</p>}
        {copyFixedSource && copyFixedSource.valueSource.kind !== "scalar" && copyFixedSource.valueSource.kind !== "inline-enumerated" &&
          <p role="note">{language === "sv" ? "Externa och paketerade NEMSIS-kodmängder kopieras inte till anpassade val." :
            "External and bundled NEMSIS code sets are not copied into custom choices."}</p>}
        {copyFixedElementDefinition && ((copyFixedElementDefinition.description || copyFixedSource?.definition || "").length > 255 || copyFixedElementDefinition.label.length > 100) &&
          <p role="note">{language === "sv" ? "Titel eller definition har kortats till gränsen för anpassade element." :
            "The title or definition was shortened to fit custom element limits."}</p>}
        <label>{language === "sv" ? "Namnrymd" : "Namespace"} <input readOnly value={customText.namespace} /></label>
        <label>{language === "sv" ? "Datatyp" : "Data type"} <select disabled={Boolean(editingCustomId)} value={customText.datatype} onChange={(event) => setCustomText({ ...customText,
          datatype: event.target.value as CatalogDraftCustomElement["datatype"] })}>
          <option value="string">{language === "sv" ? "Text" : "Text"}</option>
          <option value="number">{language === "sv" ? "Tal" : "Number"}</option>
          <option value="dateTime">{language === "sv" ? "Datum och tid" : "Date and time"}</option>
          <option value="boolean">{language === "sv" ? "Ja eller nej" : "Yes or no"}</option>
          <option value="binary">{language === "sv" ? "Binär (fil, högst 75 000 byte)" : "Binary (file, at most 75,000 bytes)"}</option>
          <option value="other">{language === "sv" ? "Annat (text)" : "Other (text)"}</option>
          <option value="coded">{language === "sv" ? "Kodad" : "Coded"}</option>
        </select></label>
        <label>{t("admin.customIdentifier")} <input aria-label={t("admin.customIdentifier")} maxLength={100} required disabled={Boolean(editingCustomId)} value={customText.slug} placeholder="LocalNote"
          onChange={(event) => setCustomText({ ...customText, slug: event.target.value })} />
          <small>{t("admin.customIdentifierHelp")}</small></label>
        {editingLanguage === "en" ? <>
          <label>{t("admin.customEnglishTitle")} <input required maxLength={100} value={customText.title}
            onChange={(event) => setCustomText({ ...customText, title: event.target.value })} /></label>
          <label>{t("admin.customEnglishDefinition")} <textarea required maxLength={255} value={customText.definition}
            onChange={(event) => setCustomText({ ...customText, definition: event.target.value })} /></label>
        </> : <>
          <label>{t("admin.customSwedishTitle")} <input maxLength={100} value={customText.swedishTitle}
            onChange={(event) => setCustomText({ ...customText, swedishTitle: event.target.value })} /></label>
          <label>{t("admin.customSwedishDefinition")} <textarea maxLength={255} value={customText.swedishDefinition}
            onChange={(event) => setCustomText({ ...customText, swedishDefinition: event.target.value })} /></label>
          {(!customText.title.trim() || !customText.definition.trim()) && <p role="note">{language === "sv" ? "Ange engelsk titel och definition innan elementet sparas." : "Enter an English title and definition before saving the element."}</p>}
        </>}
        <label>{t("admin.customUsage")} <select disabled={Boolean(editingCustomId)} value={customText.usage} onChange={(event) => setCustomText({ ...customText,
          usage: event.target.value as CatalogDraftCustomTextElement["usage"] })}>
          {["Optional", "Recommended", "Required", "Mandatory"].map((usage) => <option key={usage}>{usage}</option>)}
        </select></label>
        <label>{language === "sv" ? "Upprepning" : "Recurrence"} <select disabled={Boolean(editingCustomId)} value={customText.recurrence}
          onChange={(event) => setCustomText({ ...customText, recurrence: event.target.value as CatalogDraftCustomTextElement["recurrence"] })}>
          <option value="single">{language === "sv" ? "Ett värde per mål" : "One value per target"}</option>
          <option value="multiple">{language === "sv" ? "Flera värden per mål" : "Multiple values per target"}</option>
        </select></label>
        <label>{language === "sv" ? "Koppla till" : "Correlate with"} <select disabled={Boolean(editingCustomId)} value={customText.correlatesTo}
          onChange={(event) => setCustomText({ ...customText, correlatesTo: event.target.value })}>
          <option value="">{correlationLabel()}</option>{correlationOptions.map((group) => <option key={group.id} value={group.id}>{fixedGroupName(group.id, editingLanguage)}</option>)}
        </select></label>
        <label>{language === "sv" ? "Gruppering" : "Grouping"} <select disabled={Boolean(editingCustomId)} value={customText.groupDefinitionId}
          onChange={(event) => {
            const group = draft.definition.customGroups?.find((candidate) => candidate.id === event.target.value);
            setCustomText({ ...customText, groupDefinitionId: event.target.value,
              ...(group ? { namespace: group.namespace, correlatesTo: group.correlatesTo ?? "" } : {}) });
          }}>
          <option value="">{language === "sv" ? "Ingen" : "None"}</option>
          {(draft.definition.customGroups ?? []).map((group) => <option key={group.id} value={group.id}>{editingLanguage === "sv" ? group.localization?.sv?.label || group.title : group.title}</option>)}
        </select></label>
        <label>{t("admin.customIdentifying")} <select required disabled={Boolean(editingCustomId)} value={customText.identifying}
          onChange={(event) => setCustomText({ ...customText, identifying: event.target.value })}>
          <option value="">{t("admin.customChooseClassification")}</option><option value="yes">{t("admin.customYes")}</option><option value="no">{t("admin.customNo")}</option>
        </select></label>
        {(customText.datatype === "string" || customText.datatype === "other") && <><label>{t("admin.customMinimumLength")} <input type="number" min="0" max="100000" disabled={Boolean(editingCustomId)} value={customText.minLength}
          onChange={(event) => setCustomText({ ...customText, minLength: event.target.value })} /></label>
        <label>{t("admin.customMaximumLength")} <input type="number" min="0" disabled={Boolean(editingCustomId)} value={customText.maxLength}
          onChange={(event) => setCustomText({ ...customText, maxLength: event.target.value })} /></label>
        <label>{t("admin.customPattern")} <input disabled={Boolean(editingCustomId)} value={customText.pattern}
          onChange={(event) => setCustomText({ ...customText, pattern: event.target.value })} /></label></>}
        {customText.datatype === "number" && <><label>{language === "sv" ? "Minsta värde" : "Minimum"} <input type="number" disabled={Boolean(editingCustomId)} value={customText.minimum}
          onChange={(event) => setCustomText({ ...customText, minimum: event.target.value })} /></label>
          <label>{language === "sv" ? "Högsta värde" : "Maximum"} <input type="number" disabled={Boolean(editingCustomId)} value={customText.maximum}
          onChange={(event) => setCustomText({ ...customText, maximum: event.target.value })} /></label></>}
        {customText.datatype === "coded" && <fieldset disabled={Boolean(editingCustomId)}><legend>{language === "sv" ? "Kodlista" : "Code list"}</legend>
          {editingCustomId && <p role="note">{language === "sv" ? "Redigera val i kodlisteredigeraren." : "Edit choices in the code list editor."}</p>}
          <label>Code system URI <input required value={codedDetails.codeSystem} onChange={(event) => setCodedDetails({ ...codedDetails, codeSystem: event.target.value })} /></label>
          {editingLanguage === "en" ? <label>{editingCustomId ? "Choices" : "Initial choices"}, one per line (code | English label | optional NEMSIS code)
            <textarea required rows={5} value={codedDetails.choices} onChange={(event) => setCodedDetails({ ...codedDetails, choices: event.target.value })} /></label>
            : <label>{language === "sv" ? "Svenska val" : "Swedish choices"} <textarea readOnly rows={5}
              value={displayedCodedElement?.choices.map((choice) => `${choice.code} | ${choice.localization?.sv?.label ?? ""}`).join("\n") ??
                (copyFixedSource?.valueSource.kind === "inline-enumerated" ? copyFixedSource.valueSource.values
                  .map((choice) => `${choice.code} | ${copiedFixedCodeLabels.get(choice.code) ?? ""}`).join("\n") : "")} /></label>}
          {editingLanguage === "sv" && <p role="note">{language === "sv" ? "Redigera svenska val i kodlisteredigeraren." : "Edit Swedish choice labels in the code list editor."}</p>}
          <p>{language === "sv" ? "Tillåtna NOT-värden" : "Permitted NOT values"}: {codedDetails.notValues.join(", ") || "—"}</p>
          <p>{language === "sv" ? "Tillåtna relevanta negationer" : "Permitted pertinent negatives"}: {codedDetails.negatives.join(", ") || "—"}</p>
          <label>Optional NEMSIS element mapping <select value={codedDetails.nemsisElement} onChange={(event) => setCodedDetails({ ...codedDetails, nemsisElement: event.target.value })}>
            <option value="">None</option>{draft.definition.elements.filter((item) => !draft.definition.hiddenElementIds?.includes(item.elementId) && item.elementId.startsWith("e"))
              .map((item) => <option key={item.elementId} value={item.elementId}>{item.label}</option>)}
          </select></label>
          {([['eCustomConfiguration.07', 'notValues', 'Permitted NOT values'], ['eCustomConfiguration.08', 'negatives', 'Permitted pertinent negatives']] as const).map(([id, property, title]) =>
            <details key={id}><summary>{title}</summary>{customSpecialOptions(draft.definition, id).map((choice) => <label key={choice.code}>
              <input type="checkbox" checked={codedDetails[property].includes(choice.code)} onChange={(event) => setCodedDetails({ ...codedDetails,
                [property]: event.target.checked ? [...codedDetails[property], choice.code] : codedDetails[property].filter((code) => code !== choice.code) })} />
              {editingLanguage === "sv" ? choice.localization?.sv?.label || "—" : choice.label}
            </label>)}</details>)}
        </fieldset>}
        {canEdit && <button type="button" onClick={() => { setElementEditorKey(null); setEditingCustomId(null); setCopySourceId(null); setCustomText({ namespace: CUSTOM_NAMESPACE, slug: "", title: "", definition: "", swedishTitle: "", swedishDefinition: "", usage: "Optional", identifying: "", datatype: "string", recurrence: "single", correlatesTo: "", groupDefinitionId: "", minLength: "", maxLength: "", pattern: "", minimum: "", maximum: "" }); }}>Cancel</button>}
        {canEdit && <button type="button" onClick={() => void action(addCustomText)}>{editingCustomId ? t("admin.customSaveRevision") : language === "sv" ? "Lägg till element" : "Add element"}</button>}
        {error && <p role="alert">{error}</p>}
        {editingCustomElement && canEdit && !editingCustomElement.retired && <button type="button" onClick={() => loadCustomElement(editingCustomElement, true)}>{language === "sv" ? "Kopiera element" : "Copy element"}</button>}
        {editingCustomElement && canEdit && !editingCustomElement.retired && <button type="button" onClick={() => { updateCustom(editingCustomElement.id, (value) => ({ ...value, retired: true })); setElementEditorKey(null); }}>{t("admin.customRetire")}</button>}
      </fieldset>}
    </section>}
    {editor === "code-list" && listOptions.length > 0 && <section className="code-list-editor" aria-labelledby="code-list-heading">
      <h3 id="code-list-heading">{language === "sv" ? "Kodlista" : "Code List"}</h3>
      <p>{language === "sv" ? "Redigera kodlistans innehåll här. Aktivera och sortera val i formulärredigeraren." : "Edit code-list content here. Enable and reorder choices in the form editor."}</p>
      <div className="catalog-elements"><table><thead><tr><th><AdminText messageKey="admin.codeList" /></th><th>{language === "sv" ? "Typ" : "Type"}</th><th>{language === "sv" ? "Åtgärd" : "Action"}</th></tr></thead><tbody>
        {listOptions.map(({ key, elementId, list, custom }) => <tr key={key}><th scope="row">{elementId} — {editingLanguage === "sv"
          ? list?.localization?.sv?.name || custom?.localization?.sv?.label || "—" : list?.name ?? custom?.title ?? t("admin.specialValues")}</th>
          <td>{custom ? (language === "sv" ? "Anpassad" : "Custom") : (language === "sv" ? "Fast" : "Fixed")}</td>
          <td><button type="button" onClick={() => { setSelectedListKey(key); setListEditorOpen(true); }}>{canEdit ? (language === "sv" ? "Redigera" : "Edit") : (language === "sv" ? "Visa" : "View")}</button></td></tr>)}
      </tbody></table></div>
      {listEditorOpen && selectedOption && <div className="catalog-item-editor" aria-label={`${selectedOption.elementId} code list editor`}>
      <div className="catalog-item-heading"><h4>{selectedOption.elementId} — {editingLanguage === "sv"
        ? selectedList?.localization?.sv?.name || selectedOption.custom?.localization?.sv?.label || "—"
        : selectedList?.name ?? selectedOption.custom?.title ?? t("admin.specialValues")}</h4>
        <button type="button" onClick={() => setListEditorOpen(false)}>Close</button></div>
      {selectedElement?.specialChoices?.length && <fieldset>
        <legend><AdminText messageKey="admin.specialValues" /></legend>
        {selectedElement.specialChoices.map((choice) => <label key={`${choice.kind}:${choice.code}`}>
          <span>{choice.kind === "pertinent-negative" ? "PN" : "NV"} {choice.code}</span>
          <input disabled
            aria-label={`${t(editingLanguage === "sv" ? "admin.swedish" : "admin.english")} ${choice.kind === "pertinent-negative" ? "PN" : "NV"} ${selectedElement.elementId} ${choice.code}`}
            value={editingLanguage === "sv" ? choice.localization?.sv?.label ?? "" : choice.label}
            readOnly />
          {issues.filter((issue) => issue.id === selectedElement.elementId && issue.field === `${choice.kind} ${choice.code}`).map((issue) =>
            <small role="note" key={issue.kind}>{issue.message}</small>)}
        </label>)}
      </fieldset>}
      {selectedOption?.custom && <CustomCodeListEditor key={selectedOption.custom.id} element={selectedOption.custom} language={editingLanguage}
        readOnly={!canEdit || Boolean(selectedOption.custom.retired)} onChange={(next) => updateCustom(next.id, () => next)} />}
      {selectedList && <CatalogCodeListEditor key={selectedList.listId} list={selectedList} issues={issues.filter((issue) => issue.id === selectedList.listId)} language={editingLanguage} readOnly={!canEdit} onChange={editCodeList} />}
      </div>}
    </section>}
    {editor === "group" && <section className="catalog-element-editor" aria-label="Group editor">
      <h3>{language === "sv" ? "Grupp" : "Group"}</h3>
      <div className="catalog-list-toolbar"><button type="button" className="catalog-primary-action" disabled={!canEdit} onClick={() => { setGroupEditorKey("new"); setError(""); }}>
        {language === "sv" ? "Ny grupp" : "New group"}</button></div>
      <div className="catalog-elements"><table><thead><tr><th>{language === "sv" ? "Grupp" : "Group"}</th><th>{language === "sv" ? "Typ" : "Type"}</th><th>{language === "sv" ? "Åtgärd" : "Action"}</th></tr></thead><tbody>
        {visibleGroups.map((group) => <tr key={group.id}><th scope="row">{group.id} — {fixedGroupName(group.id, editingLanguage)}</th><td>{language === "sv" ? "Fast" : "Fixed"}</td>
          <td><button type="button" onClick={() => setGroupEditorKey(`fixed:${group.id}`)}>{language === "sv" ? "Visa" : "View"}</button></td></tr>)}
        {(draft.definition.customGroups ?? []).map((group) => <tr key={group.id}><th scope="row">{group.slug} — {editingLanguage === "sv" ? group.localization?.sv?.label || "—" : group.title}</th>
          <td>{language === "sv" ? "Anpassad" : "Custom"} · {group.recurrence}</td><td><button type="button" onClick={() => setGroupEditorKey(group.id)}>
            {canEdit ? (language === "sv" ? "Redigera" : "Edit") : (language === "sv" ? "Visa" : "View")}</button></td></tr>)}
      </tbody></table></div>
      {groupEditorKey?.startsWith("fixed:") && <section className="catalog-item-editor" aria-label="Fixed group editor">
        <div className="catalog-item-heading"><h4>{fixedGroupName(groupEditorKey.slice(6), editingLanguage)}</h4>
          <button type="button" onClick={() => setGroupEditorKey(null)}>Close</button></div>
        <p role="note">{language === "sv" ? "Fast NEMSIS-grupp. Skrivskyddad." : "Fixed NEMSIS group. Read-only."}</p></section>}
      {editingGroup && <section className="catalog-item-editor" aria-label={`${editingGroup.title} group editor`}>
        <div className="catalog-item-heading"><h4>{editingGroup.slug}</h4><button type="button" onClick={() => setGroupEditorKey(null)}>Close</button></div>
        <label>{editingLanguage === "sv" ? "Svensk titel" : "English title"} <input disabled={!canEdit} aria-label={`${editingGroup.title} ${editingLanguage === "sv" ? "Swedish" : "English"} title`}
          value={editingLanguage === "sv" ? editingGroup.localization?.sv?.label ?? "" : editingGroup.title}
          onChange={(event) => { setDraft({ ...draft, definition: { ...draft.definition,
            customGroups: draft.definition.customGroups?.map((item) => item.id === editingGroup.id ? editingLanguage === "en" ? { ...item, title: event.target.value } : { ...item,
              localization: { schemaVersion: 1, sv: { label: event.target.value, reviewedSource: { label: item.title } } } } : item) } }); setDirty(true); }} /></label>
        <p>{editingGroup.recurrence} · {correlationLabel(editingGroup.correlatesTo)}</p>
      </section>}
      {canEdit && groupEditorKey === "new" && <fieldset className="custom-element-form catalog-item-editor" disabled={busy}><legend>{language === "sv" ? "Skapa grupp" : "Create group"}</legend>
        <label>{t("admin.customGroupIdentifier")} <input aria-label={t("admin.customGroupIdentifier")} maxLength={100} value={newGroup.slug} onChange={(event) => setNewGroup({ ...newGroup, slug: event.target.value })} />
          <small>{t("admin.customIdentifierHelp")}</small></label>
        {editingLanguage === "en" ? <label>English title <input value={newGroup.title} onChange={(event) => setNewGroup({ ...newGroup, title: event.target.value })} /></label>
          : <label>Swedish title <input value={newGroup.swedishTitle} onChange={(event) => setNewGroup({ ...newGroup, swedishTitle: event.target.value })} /></label>}
        {editingLanguage === "sv" && !newGroup.title.trim() && <p role="note">{language === "sv" ? "Ange en engelsk titel innan gruppen läggs till." : "Enter an English title before adding the group."}</p>}
        <label>Recurrence <select value={newGroup.recurrence} onChange={(event) => setNewGroup({ ...newGroup, recurrence: event.target.value as CatalogDraftCustomGroup["recurrence"] })}>
          <option value="single">Single</option><option value="multiple">Multiple</option></select></label>
        <label>Correlate with <select value={newGroup.correlatesTo} onChange={(event) => setNewGroup({ ...newGroup, correlatesTo: event.target.value })}>
          <option value="">{correlationLabel()}</option>{correlationOptions.map((group) => <option key={group.id} value={group.id}>{fixedGroupName(group.id, editingLanguage)}</option>)}</select></label>
        <button type="button" onClick={() => setGroupEditorKey(null)}>Cancel</button>
        <button type="button" onClick={() => {
          if (!newGroup.slug.trim()) { setError(t("admin.customGroupIdRequired")); return; }
          if (!/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*$/.test(newGroup.slug.trim())) {
            setError(t("admin.customGroupIdInvalid")); return; }
          if (newGroup.title.trim().length < 2) { setError(t("admin.customGroupEnglishTitleTooShort")); return; }
          if (draft.definition.customGroups?.some((group) => group.namespace === CUSTOM_NAMESPACE && group.slug === newGroup.slug.trim())) {
            setError(t("admin.customGroupIdDuplicate", { id: newGroup.slug.trim() })); return;
          }
          const group: CatalogDraftCustomGroup = { id: crypto.randomUUID(), namespace: CUSTOM_NAMESPACE, slug: newGroup.slug.trim(),
            title: newGroup.title.trim(), recurrence: newGroup.recurrence,
            ...(newGroup.swedishTitle.trim() ? { localization: { schemaVersion: 1 as const, sv: {
              label: newGroup.swedishTitle.trim(), reviewedSource: { label: newGroup.title.trim() } } } } : {}),
            ...(newGroup.correlatesTo ? { correlatesTo: newGroup.correlatesTo as NonNullable<CatalogDraftCustomGroup["correlatesTo"]> } : {}) };
          setDraft({ ...draft, definition: { ...draft.definition, customGroups: [...(draft.definition.customGroups ?? []), group] } });
          setDirty(true); setError(""); setGroupEditorKey(group.id); setNewGroup({ namespace: CUSTOM_NAMESPACE, slug: "", title: "", swedishTitle: "", recurrence: "multiple", correlatesTo: "" });
        }}>Add group</button>
        {error && <p role="alert">{error}</p>}
      </fieldset>}
    </section>}
    <div className="catalog-actions">
      <label htmlFor="catalog-display-name"><AdminText messageKey="admin.catalogVersionDisplay" /></label>
      <input id="catalog-display-name" disabled={!canEdit} maxLength={120} required value={draft.displayName ?? ""}
        onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }); setDirty(true); setStatus(t("admin.unsavedChanges")); }} />
      {publicationAllowed && authoringDraft ? <>
        <AuthoringLifecycleAction title="Catalog" kind="publish" note={note} onNoteChange={setNote}
          disabled={busy || dirty || !draft.displayName?.trim()}
          buttonLabel="Publish immutable catalog" onSubmit={() => action(async () => {
            const published = await publishCatalogDraft(csrfToken, authoringDraft, authoringDraft.displayName!, note);
            onPublished?.(published.id);
            setDraft(null); setDirty(false); setNote(""); setStatus(`Published ${published.displayName}.`);
            const items = await loadCatalogVersions(); setVersions(items); setSelectedVersionId(published.id);
          })} />
      </> : canEdit && <p role="note">{canPublish
        ? t("admin.publishingIsDisabledForThisInstallationCatalog")
        : t("admin.catalogDraftOnlyAccess")}</p>}
      {authoringDraft && dirty && <p role="status"><AdminText messageKey="admin.saveTheCurrent" /></p>}
    </div>
    {error && elementEditorKey !== "new" && !editingCustomElement && groupEditorKey !== "new" && <p role="alert">{error}</p>}
    <p role="status" aria-live="polite">{status}</p>
  </div>;
}

export function CatalogCodeListEditor({ list, issues = [], language = "en", readOnly = false, fixedCodeSystem, requireNemsisMapping = true, onChange }: {
  readonly issues?: ReadonlyArray<TranslationIssue>;
  readonly list: CatalogDraftCodeList;
  readonly fixedCodeSystem?: string;
  readonly requireNemsisMapping?: boolean;
  readonly readOnly?: boolean;
  readonly language?: "en" | "sv";
  readonly onChange: (next: CatalogDraftCodeList, announcement: string) => void;
}) {
  const t = useAdminText();
  const [code, setCode] = useState("");
  const [codeSystem, setCodeSystem] = useState("");
  const [label, setLabel] = useState("");
  const [nemsisCode, setNemsisCode] = useState("");
  const sourceValues = list.values.filter((value) => !value.nemsisCode);
  const valueKey = (value: { code: string; codeSystem: string }) => `${value.codeSystem}\u0000${value.code}`;

  function updateValue(index: number, update: (value: CatalogDraftCodeList["values"][number]) => CatalogDraftCodeList["values"][number], announcement: string) {
    const values = list.values.map((value, valueIndex) => valueIndex === index ? update(value) : value);
    onChange({ ...list, values }, announcement);
  }

  function addValue() {
    if (readOnly) return;
    const nextCode = code.trim(); const nextSystem = fixedCodeSystem ?? codeSystem.trim(); const nextLabel = label.trim();
    if (!nextCode || !nextSystem || !nextLabel || requireNemsisMapping && !nemsisCode)
      return onChange(list, "A code, code system, label, and NEMSIS mapping are required.");
    if (list.values.some((value) => value.code === nextCode && value.codeSystem === nextSystem))
      return onChange(list, `Duplicate code ${nextCode} was not added.`);
    onChange({ ...list, values: [...list.values, { code: nextCode, codeSystem: nextSystem, label: nextLabel,
      sourceLabel: nextLabel, category: null, enabled: true, ...(requireNemsisMapping ? { nemsisCode } : {}) }] },
    `Added ${nextLabel}. Save, validate, and publish the catalog before creating the form.`);
    setCode(""); setCodeSystem(""); setLabel(""); setNemsisCode("");
  }

  return <div className="code-list-values">
    <label>{t("admin.listName")} {t(language === "sv" ? "(Swedish)" : "(English source)")}<input disabled={readOnly || language === "en"}
      value={language === "sv" ? list.localization?.sv?.name ?? "" : list.name}
      onChange={(event) => onChange({ ...list, localization: { schemaVersion: 1, sv: {
        name: event.target.value, reviewedSource: { name: list.name } } } }, `Changed Swedish name for ${list.listId}.`)} /></label>
    {issues.filter((issue) => issue.field === "name").map((issue) => <small role="note" key={issue.kind}>{issue.message}</small>)}
    {language === "en" && <fieldset className="code-list-add">
      <legend><AdminText messageKey="admin.addValue" /></legend>
      <label><AdminText messageKey="admin.code" /> <input disabled={readOnly} value={code} onChange={(event) => setCode(event.target.value)} /></label>
      <label><AdminText messageKey="admin.codeSystem" /> <input disabled={readOnly || fixedCodeSystem !== undefined} value={fixedCodeSystem ?? codeSystem} onChange={(event) => setCodeSystem(event.target.value)} /></label>
      <label><AdminText messageKey="admin.label" /> <input disabled={readOnly} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      {requireNemsisMapping && <label>{"Map to NEMSIS code"} <select disabled={readOnly} value={nemsisCode} onChange={(event) => setNemsisCode(event.target.value)}>
        <option value="">Choose a source value</option>{sourceValues.map((value) => <option key={`${value.codeSystem}:${value.code}`} value={value.code}>{value.code} — {value.label}</option>)}
      </select></label>}
      <button type="button" disabled={readOnly} onClick={addValue}><AdminText messageKey="admin.addValue" /></button>
    </fieldset>}
    {language === "sv" && <p role="note">{t("admin.addCodesInEnglishSource")}</p>}
    <ol aria-label={`${language === "sv" ? list.localization?.sv?.name || list.listId : list.name} values`}>
      {list.values.map((value, index) => {
        const key = valueKey(value);
        return <li key={key}>
          <div><strong>{value.code}</strong>{value.codeSystem && <small>{value.codeSystem}</small>}</div>
          <label><AdminText messageKey="admin.label" /> <input disabled={readOnly} aria-label={`${language === "sv" ? t("admin.swedish") : t("admin.english")} label for ${list.listId} ${value.codeSystem} ${value.code}`}
            value={language === "sv" ? value.localization?.sv?.label ?? "" : value.label} onChange={(event) => updateValue(index,
            (current) => language === "sv" ? { ...current, localization: { schemaVersion: 1,
              sv: { label: event.target.value, reviewedSource: { label: current.label } } } } :
              updateCatalogChoiceEnglish(current, event.target.value), `Changed the ${language === "sv" ? t("admin.swedish") : t("admin.english")} label for ${value.code}.`)} /></label>
          {issues.filter((issue) => issue.field === `${value.codeSystem} ${value.code}`).map((issue) =>
            <small role="note" key={issue.kind}>{issue.message}</small>)}
          {language === "sv" && !value.localization?.sv?.label?.trim() && <small role="note"><AdminText messageKey="admin.missingSwedishChoice" /></small>}

        </li>;
      })}
    </ol>
  </div>;
}

export function CustomCodeListEditor({ element, language, readOnly, onChange }: {
  readonly element: CatalogDraftCustomCodedElement;
  readonly language: "en" | "sv";
  readonly readOnly: boolean;
  readonly onChange: (element: CatalogDraftCustomCodedElement) => void;
}) {
  const [status, setStatus] = useState("");
  const list: CatalogDraftCodeList = { listId: element.id, name: element.title, classification: "agency", elementIds: [],
    localization: element.localization?.sv ? { schemaVersion: 1, sv: { name: element.localization.sv.label,
      reviewedSource: { name: element.title } } } : undefined,
    values: element.choices.map((choice) => ({ ...choice, codeSystem: element.codeSystem, sourceLabel: choice.label, category: null, enabled: true })) };
  return <><CatalogCodeListEditor list={list} language={language} readOnly={readOnly} fixedCodeSystem={element.codeSystem} requireNemsisMapping={false} onChange={(next, announcement) => {
    setStatus(announcement);
    if (next === list) return;
    onChange({ ...element,
    choices: next.values.map((value) => ({ ...element.choices.find((choice) => choice.code === value.code),
      code: value.code, label: value.label, ...(value.localization ? { localization: value.localization } : {}) })),
    ...(language === "sv" && next.localization?.sv?.name !== list.localization?.sv?.name ? {
      localization: { schemaVersion: 1, sv: { ...element.localization?.sv, label: next.localization?.sv?.name,
        reviewedSource: { ...element.localization?.sv?.reviewedSource, label: element.title } } } } : {}),
  }); }} /><p role="status">{status}</p></>;
}
