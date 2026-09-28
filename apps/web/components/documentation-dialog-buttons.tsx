import React, { type ComponentProps } from "react";
import { resolveMessage } from "../app/localization";

type DialogButtonProps = Omit<ComponentProps<"button">, "children"> & { readonly language: string };

export function DialogCancelButton({ language, className = "", ...props }: DialogButtonProps) {
  return <button {...props} type="button" className={`dialog-cancel-button ${className}`.trim()}>
    {resolveMessage(language, "mobile.dialog.cancel")}
  </button>;
}

export function DialogRemoveButton({ language, className = "", ...props }: DialogButtonProps) {
  return <button {...props} type="button" className={`remove-entry-button ${className}`.trim()}>
    {resolveMessage(language, "mobile.dialog.remove")}
  </button>;
}
