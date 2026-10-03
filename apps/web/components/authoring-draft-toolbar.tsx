"use client";

import type { ReactNode } from "react";
import { useAdminText } from "../app/admin-localization";

export function AuthoringDraftToolbar({ label, busy, dirty, children }: {
  readonly label: string;
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly children: ReactNode;
}) {
  const t = useAdminText();
  return <div className="form-actions form-editor-toolbar" role="group" aria-label={label}>
    <span role="status">{busy ? t("admin.working") : dirty ? t("admin.unsavedChanges") : t("admin.allChangesSaved")}</span>
    {children}
  </div>;
}
