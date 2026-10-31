// Stub replacing the Steamworks binding so the game runs without Steam.
// initAPI() returns false, which makes Archeia_Steamworks skip every Steam call.
// The remaining functions only return harmless defaults in case they are reached anyway.
function noop() {}
function callError(cb) { if (typeof cb === 'function') cb(new Error('Steam stubbed')); }

var greenworks = {
  initAPI: function() { return false; },
  init: function() { return false; },
  getAppId: function() { return 1150690; },
  getSteamId: function() {
    return { steamId: '0', accountId: 0, staticAccountId: '0', screenName: 'Player',
             level: 0, isValid: function() { return false; } };
  },
  getCurrentGameLanguage: function() { return 'english'; },
  getCurrentUILanguage: function() { return 'english'; },
  getNumberOfPlayers: function(ok, err) { callError(err); },
  getNumberOfAchievements: function() { return 0; },
  getAchievementNames: function() { return []; },
  getAchievement: function(name, ok, err) { callError(err); },
  activateAchievement: function(name, ok, err) { callError(err); },
  clearAchievement: function(name, ok, err) { callError(err); },
  getStatInt: function() { return 0; },
  getStatFloat: function() { return 0; },
  setStat: function() { return false; },
  storeStats: function(ok, err) { callError(err); },
  isCloudEnabled: function() { return false; },
  isCloudEnabledForUser: function() { return false; },
  enableCloud: noop,
  getCloudQuota: function(ok, err) { callError(err); },
  saveTextToFile: function(file, contents, ok, err) { callError(err); },
  readTextFromFile: function(file, ok, err) { callError(err); },
  isGameOverlayEnabled: function() { return false; },
  activateGameOverlay: noop,
  activateGameOverlayToWebPage: noop,
  on: noop,
  once: noop,
  removeListener: noop,
};

module.exports = greenworks;
