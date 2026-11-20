"use strict";

var analyticsConstants = require('*/cartridge/adyen/analytics/constants');
var {
  clearEvents,
  processEvents
} = require('*/cartridge/adyen/analytics/analyticsUtils');
function processConfigurationTime() {
  processEvents(analyticsConstants.configurationTimeEventObjectId);
}
function clearConfigurationTime() {
  clearEvents(analyticsConstants.configurationTimeEventObjectId);
}
module.exports = {
  processConfigurationTime,
  clearConfigurationTime
};