import type { Analysis, PasteAction } from "./types";

export interface Catalogue {
  categories: {
    id: string;
    name: string;
    description: string;
    sort_order: number;
  }[];
  subcategories: {
    id: string;
    category_id: string;
    name: string;
    description: string;
    sort_order: number;
  }[];
  actions: {
    id: string;
    label: string;
    processor: string;
    output_format: string;
    instruction: string;
    execution_rules: string;
    version: number;
  }[];
  mappings: {
    subcategory_id: string;
    position: number;
    action_id: string;
    menu_label: string;
    context_instruction: string;
  }[];
}

export function validateCatalogue(input: unknown): Catalogue {
  const c = input as Catalogue;
  if (
    !c ||
    !["categories", "subcategories", "actions", "mappings"].every((k) =>
      Array.isArray(c[k as keyof Catalogue]),
    )
  )
    throw new Error("Incomplete menu definitions.");
  for (const key of ["categories", "subcategories", "actions"] as const) {
    if (
      !c[key].length ||
      new Set(c[key].map((r) => r.id)).size !== c[key].length ||
      c[key].some(
        (r) => typeof r.id !== "string" || !/^[a-z0-9._-]{1,200}$/.test(r.id),
      )
    )
      throw new Error("Invalid or duplicate definition IDs.");
  }
  if (c.subcategories.length > 255)
    throw new Error(
      "The current classifier supports at most 255 subcategories.",
    );
  if (
    c.categories.some((r) => typeof r.name !== "string" || !r.name.trim()) ||
    c.subcategories.some(
      (r) =>
        typeof r.name !== "string" ||
        !r.name.trim() ||
        !c.categories.some((parent) => parent.id === r.category_id),
    )
  )
    throw new Error("Invalid category definitions.");
  const formats = ["text", "markdown", "tsv", "csv", "json", "image"];
  if (
    c.actions.some(
      (a) =>
        !["local_ocr", "ai", "app_control"].includes(a.processor) ||
        !formats.includes(a.output_format) ||
        typeof a.label !== "string" ||
        typeof a.instruction !== "string" ||
        typeof a.execution_rules !== "string" ||
        !Number.isInteger(a.version) ||
        a.version < 1,
    )
  )
    throw new Error("Invalid action definitions.");
  const text = c.actions.find((a) => a.id === "text");
  if (text?.processor !== "local_ocr")
    throw new Error("The text action must stay local.");
  if (c.mappings.length !== c.subcategories.length * 4)
    throw new Error("Each subcategory needs exactly four options.");
  for (const sub of c.subcategories) {
    const menu = c.mappings
      .filter((m) => m.subcategory_id === sub.id)
      .sort((a, b) => a.position - b.position);
    if (
      menu.length !== 4 ||
      menu.some(
        (m, i) =>
          m.position !== i + 1 ||
          typeof m.menu_label !== "string" ||
          typeof m.context_instruction !== "string" ||
          !c.actions.some((a) => a.id === m.action_id),
      ) ||
      menu[0].action_id !== "text" ||
      new Set(menu.map((m) => m.action_id)).size !== 4
    )
      throw new Error(`Invalid menu for ${sub.id}.`);
  }
  return c;
}

export const localCandidates = new Set([
  "links",
  "values",
  "address",
  "cells",
  "table",
  "csv",
  "json",
  "text",
  "fragments",
  "uncertain",
]);

export function catalogueAnalysis(
  c: Catalogue,
  subcategory: string,
  version: string,
  source: Analysis["source"] = "jev",
): Analysis {
  const sub = c.subcategories.find((s) => s.id === subcategory);
  if (!sub) throw new Error("Unknown screenshot subcategory.");
  const category = c.categories.find((cat) => cat.id === sub.category_id)!;
  const actions = c.mappings
    .filter((m) => m.subcategory_id === sub.id)
    .sort((a, b) => a.position - b.position)
    .map((m) => {
      const a = c.actions.find((action) => action.id === m.action_id)!;
      const localFirst = a.processor === "ai" && localCandidates.has(a.id);
      return {
        id: a.id,
        title: m.menu_label || a.label,
        description:
          a.processor === "local_ocr"
            ? "Extract text on your Mac"
            : a.processor === "app_control"
              ? "Continue on your Mac"
              : localFirst
                ? "On-device when supported · AI fallback"
                : "Ready-to-paste content from your screenshot",
        icon: ["cells", "table", "csv", "items"].includes(a.id)
          ? "table"
          : ["code", "trace", "json", "response"].includes(a.id)
            ? "code"
            : a.id === "text"
              ? "text"
              : "sparkles",
        prompt: a.instruction,
        processor: a.processor,
        outputFormat: a.output_format,
        executionRules: a.execution_rules,
        contextInstruction: m.context_instruction,
        cloud: a.processor === "ai",
        localFirst,
        badge:
          a.processor !== "ai"
            ? "ON DEVICE"
            : localFirst
              ? "LOCAL FIRST"
              : "AI",
      } as PasteAction;
    });
  return {
    category: category.id,
    categoryTitle: category.name,
    subcategory: sub.id,
    subcategoryTitle: sub.name,
    catalogueVersion: version,
    source,
    actions,
    stage: source === "jev" ? "complete" : "fallback",
    rankedActions: [],
  };
}

export function classificationCriteria(c: Catalogue) {
  return Object.fromEntries(
    c.subcategories.map((s) => [
      s.id,
      `${c.categories.find((cat) => cat.id === s.category_id)!.name} / ${s.name}. ${s.description || ""}`,
    ]),
  );
}
