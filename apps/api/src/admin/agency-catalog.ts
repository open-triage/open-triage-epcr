/** Super-admin may reuse a published agency catalog. Orphaned agency releases
 * (for example leftovers from deleted test agencies) are not baseline imports.
 * Keep the picker and command validation on the same eligibility rule. */
export const agencyCatalogEligibility = `release.sealed and (
  exists (select 1 from catalog.authoring_draft draft
    join app_identity.organization agency on agency.id=draft.organization_id
    where draft.published_release_id=release.id)
  or exists (select 1 from app_identity.active_configuration_bundle active
    where active.catalog_release_id=release.id)
  or not (release.provenance ?| array['organizationId','sourceReleaseId','agencyVersion'])
)`;
