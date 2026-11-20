import type { KeyboardEvent } from "react";
import { resolveMessage } from "../app/localization";

export function provisionalVitalProps(value: string | undefined, language: string, accept: (value: string) => void) {
  if (!value) return {};
  const description = resolveMessage(language, "mobile.provisionalVital");
  return {
    "data-provisional-vital": true,
    title: description,
    "aria-description": description,
    onClick: () => accept(value),
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        accept(value);
      }
    },
  };
}
