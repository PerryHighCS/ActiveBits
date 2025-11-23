/**
 * Activity Registry
 * 
 * Centralized list of valid activity types.
 * This is used for server-side validation.
 * 
 * To add a new activity:
 * 1. Add the activity ID to the ALLOWED_ACTIVITIES array
 * 2. Implement the activity routes in ./activities/<activity-name>/routes.js
 * 3. Register the activity in server.js
 */

export const ALLOWED_ACTIVITIES = [
  'raffle',
  'www-sim',
  'java-string-practice',
];

/**
 * Check if an activity name is valid
 * @param {string} activityName - The activity name to validate
 * @returns {boolean} - True if the activity is allowed
 */
export function isValidActivity(activityName) {
  return ALLOWED_ACTIVITIES.includes(activityName);
}
