"use strict";

var analyticsConstants = require('*/cartridge/adyen/analytics/constants');
var {
  processEvents,
  clearEvents
} = require('*/cartridge/adyen/analytics/analyticsUtils');
function processAnalytics() {
  processEvents(analyticsConstants.analyticsEventObjectId);
}
function clearAnalytics() {
  clearEvents(analyticsConstants.analyticsEventObjectId);
}
module.exports = {
  processAnalytics,
  clearAnalytics
};