'use strict';

var Calendar = require('dw/util/Calendar');
var StringUtils = require('dw/util/StringUtils');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var { createOrUpdateCustomObject, setCustomObjectStatus, createLogMessage } = require('*/cartridge/utils/customObjectHelper');
function notify(notificationData) {
    // Check the input parameters
    if (notificationData === null) {
        AdyenLogs.fatal_log('Handling of Adyen notification has failed. No input parameters were provided.');
        return PIPELET_NEXT;
    }
    try {
        var msg = createLogMessage(notificationData);
        AdyenLogs.debug_log(msg);
        var calObj = new Calendar();
        var keyValue = `${notificationData.merchantReference}-${StringUtils.formatCalendar(calObj, 'yyyyMMddhhmmssSSS')}`;
        var customObj = createOrUpdateCustomObject('adyenNotification', keyValue, notificationData);
        setCustomObjectStatus(customObj, notificationData.eventCode, notificationData.merchantReference, notificationData);
        return {
            success: true
        };
    } catch (error) {
        AdyenLogs.error_log('Notification failed', error);
        return {
            success: false,
            errorMessage: error.message
        };
    }
}
function notifyHttpParameterMap(hpm) {
    if (hpm === null) {
        AdyenLogs.fatal_log('Handling of Adyen notification has failed. No input parameters were provided.');
        return PIPELET_NEXT;
    }
    var notificationData = {};
    var _parameterNameIterator = hpm.getParameterNames().iterator();
    while (_parameterNameIterator.hasNext()) {
        var parameterName = _parameterNameIterator.next();
        notificationData[parameterName] = hpm[parameterName].stringValue;
    }
    return notify(notificationData);
}
function execute(args) {
    return notifyHttpParameterMap(args.CurrentHttpParameterMap);
}
module.exports = {
    execute,
    notify,
    notifyHttpParameterMap
};
