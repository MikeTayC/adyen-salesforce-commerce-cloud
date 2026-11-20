'use strict';

/* Script Modules */
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var constants = require('*/cartridge/adyen/config/constants');
var { AdyenError } = require('*/cartridge/adyen/logs/adyenError');

// eslint-disable-next-line complexity
function deleteRecurringPayment(args) {
    var customer = args.Customer ? args.Customer : null;
    var profile = customer && customer.registered && customer.getProfile() ? customer.getProfile() : null;
    var customerID = null;
    var recurringDetailReference = args.RecurringDetailReference ? args.RecurringDetailReference : null;
    if (profile && profile.getCustomerNo()) {
        customerID = profile.getCustomerNo();
    }
    if (!(customerID && recurringDetailReference)) {
        throw new AdyenError('No Customer ID or RecurringDetailReference provided');
    }
    var requestObject = {
        merchantAccount: AdyenConfigs.getAdyenMerchantAccount(),
        shopperReference: customerID,
        recurringDetailReference,
        contract: constants.CONTRACT.ONECLICK
    };
    return AdyenHelper.executeCall(constants.SERVICE.RECURRING_DISABLE, requestObject);
}
module.exports = {
    deleteRecurringPayment
};
