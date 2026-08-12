const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * BillManager currently schedules reminders locally on the device. The
 * expo-notifications plugin also adds the APNs entitlement used for remote
 * pushes, which would require a push-enabled App Store profile even though the
 * app does not register for remote notifications. Because Expo applies iOS
 * mods in reverse registration order, keep this plugin before
 * expo-notifications in app.config.ts so this cleanup runs last.
 */
module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (entitlementsConfig) => {
    delete entitlementsConfig.modResults['aps-environment'];
    return entitlementsConfig;
  });
};
