'use strict';

var UUIDUtils = require('dw/util/UUIDUtils');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var constants = require('*/cartridge/adyen/config/constants');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var analyticsConstants = require('*/cartridge/adyen/analytics/constants');
function execute(serviceType, requestObject, checkoutAttemptID) {
    if (checkoutAttemptID === undefined) {
        checkoutAttemptID = '';
    }
    var service = AdyenHelper.getService(serviceType);
    if (service === null) {
        throw new Error(`Could not create ${serviceType} service object`);
    }
    var clientKey = AdyenConfigs.getAdyenClientKey();
    var serviceUrl = service.getURL();
    serviceUrl += `/${checkoutAttemptID}?clientKey=${clientKey}`;
    service.setURL(serviceUrl);
    var apiKey = AdyenConfigs.getAdyenApiKey();
    var uuid = UUIDUtils.createUUID();
    service.addHeader('Content-type', 'application/json');
    service.addHeader('charset', 'UTF-8');
    service.addHeader('X-API-KEY', apiKey);
    service.addHeader('Idempotency-Key', uuid);
    var callResult = service.call(JSON.stringify(requestObject));
    if (!callResult.isOk()) {
        throw new Error(
            `${serviceType} service call error code ${callResult.getError().toString()} Error => ResponseStatus: ${callResult.getStatus()} | ResponseErrorText: ${callResult.getErrorMessage()} | ResponseText: ${callResult.getMsg()}`
        );
    }
    var text = callResult.object && callResult.object.getText();
    var parsedResponse = JSON.parse(text);
    return parsedResponse || callResult.status;
}
function createCheckoutAttemptId(pluginVersion) {
    if (pluginVersion === undefined) {
        pluginVersion = constants.VERSION;
    }
    try {
        var requestObject = {
            applicationInfo: AdyenHelper.getApplicationInfo(),
            channel: 'Web',
            platform: 'Web',
            plugin: analyticsConstants.pluginType,
            pluginVersion
        };
        var response = execute(constants.SERVICE.ADYEN_ANALYTICS, requestObject);
        return {
            data: response.checkoutAttemptId
        };
    } catch (error) {
        AdyenLogs.error_log('createCheckoutAttemptId for /analytics call failed:', error);
        return {
            error: true
        };
    }
}
function submitData(requestObject, attemptIdParam) {
    if (attemptIdParam === undefined) {
        attemptIdParam = null;
    }
    try {
        var attemptId = attemptIdParam;
        if (!attemptId) {
            var initialAnalyticsCall = createCheckoutAttemptId();
            attemptId = initialAnalyticsCall.data;
        }
        var response = execute(constants.SERVICE.ADYEN_ANALYTICS, requestObject, attemptId);
        return {
            data: response
        };
    } catch (error) {
        AdyenLogs.error_log('submitData for /analytics call failed:', error);
        return {
            error: true
        };
    }
}
module.exports = {
    createCheckoutAttemptId,
    submitData,
    execute
};
