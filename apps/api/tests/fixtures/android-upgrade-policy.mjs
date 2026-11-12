import {AndroidUpgradePolicyService} from '../../dist/admin/android-upgrade-policy.service.js';
import {AndroidReleaseService} from '../../dist/admin/android-release.service.js';
import {InstallationEnrollmentService} from '../../dist/admin/installation-enrollment.service.js';
import {AgencyDirectoryService} from '../../dist/sessions/agency-directory.service.js';

/** Direct PostgreSQL service fixtures use the same real policy provider as Nest.
 * No compatibility override or authentication bypass is introduced for old tests. */
export function androidUpgradePolicyFixture(database,sessions) {
 return new AndroidUpgradePolicyService(database,sessions,new AndroidReleaseService(sessions),
  new InstallationEnrollmentService(database,sessions,new AgencyDirectoryService(database)));
}
