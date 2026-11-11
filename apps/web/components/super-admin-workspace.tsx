"use client";
import { useState, type ComponentProps } from "react";
import { OrganizationManagement } from "./organization-management";
import { AndroidUpgradePolicyPanel } from "./android-upgrade-policy";
import { ReviewTabs } from "./review-tabs";
import { resolveMessage } from "../app/localization";
export function SuperAdminWorkspace(props: ComponentProps<typeof OrganizationManagement>) {
  const [tab, setTab] = useState<"agencies" | "android">("agencies"), [visited, setVisited] = useState(false);
  const t = (key: string) => resolveMessage(props.language, key);
  return <section className="super-admin-workspace">
    <ReviewTabs id="super-admin" label={t("navigation.superAdmin")} value={tab}
      options={[{ value: "agencies", label: t("androidUpgrade.agencies") }, { value: "android", label: t("androidUpgrade.tab") }]}
      onChange={value => { setTab(value); if (value === "android") setVisited(true); }} />
    <div id="super-admin-panel-agencies" role="tabpanel" aria-labelledby="super-admin-tab-agencies" hidden={tab !== "agencies"}>
      <OrganizationManagement {...props} active={props.active !== false && tab === "agencies"} />
    </div>
    {visited && <div id="super-admin-panel-android" role="tabpanel" aria-labelledby="super-admin-tab-android" hidden={tab !== "android"}>
      <AndroidUpgradePolicyPanel key={props.session.user.id} session={props.session} language={props.language} />
    </div>}
  </section>;
}
