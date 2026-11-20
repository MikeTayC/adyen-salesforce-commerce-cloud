'use strict';

var constants = require('*/cartridge/adyen/config/constants');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var PLACEHOLDER_VALUES = ['N/A', 'ZZ'];
var REQUIRED_BILLING_FIELDS = ['city', 'country', 'houseNumberOrName', 'postalCode', 'stateOrProvince', 'street'];
function hasValue(value) {
    if (value === null || value === undefined) {
        return false;
    }
    var stringValue = String(value).trim();
    return stringValue.length > 0 && PLACEHOLDER_VALUES.indexOf(stringValue.toUpperCase()) === -1;
}
function isDcapEligible(paymentRequest) {
    return (
        paymentRequest.shopperInteraction === constants.SHOPPER_INTERACTIONS.ECOMMERCE &&
        (paymentRequest.paymentMethod || {}).type === constants.PAYMENTMETHODS.SCHEME &&
        (paymentRequest.billingAddress || {}).country === 'US'
    );
}
function getMissingDcapFields(paymentRequest) {
    if (!isDcapEligible(paymentRequest)) {
        return [];
    }
    var missingFields = [];
    if (!hasValue(paymentRequest.shopperIP)) {
        missingFields.push('shopperIP');
    }
    if (!hasValue(paymentRequest.shopperEmail)) {
        missingFields.push('shopperEmail');
    }
    REQUIRED_BILLING_FIELDS.forEach((fieldName) => {
        if (!hasValue(paymentRequest.billingAddress[fieldName])) {
            missingFields.push(`billingAddress.${fieldName}`);
        }
    });
    if (!hasValue(paymentRequest.deviceFingerprint)) {
        missingFields.push('deviceFingerprint');
    }
    return missingFields;
}
function warnForMissingDcapFields(paymentRequest) {
    var missingFields = getMissingDcapFields(paymentRequest);
    if (missingFields.length) {
        AdyenLogs.warning_log(`DCAP data missing for US card payment: ${missingFields.join(', ')}`);
    }
}
module.exports = {
    getMissingDcapFields,
    warnForMissingDcapFields
};
