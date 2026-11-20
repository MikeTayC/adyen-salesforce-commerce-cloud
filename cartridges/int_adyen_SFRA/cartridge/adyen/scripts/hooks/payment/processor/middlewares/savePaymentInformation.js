'use strict';

var CustomerMgr = require('dw/customer/CustomerMgr');
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
function hasValidBillingData({ storedPaymentUUID, saveCard, paymentMethod }) {
    var isCreditCard = paymentMethod.value === 'CREDIT_CARD';
    return !storedPaymentUUID && saveCard && isCreditCard;
}
function isValidCustomer({ authenticated, registered }) {
    return authenticated && registered;
}
function isValid(raw, billingData) {
    return isValidCustomer(raw) && hasValidBillingData(billingData);
}

/**
 * Save the credit card information to login account if save card option is selected
 * @param {Object} req - The request object
 * @param {dw.order.Basket} basket - The current basket
 * @param {Object} billingData - payment information
 */
function savePaymentInformation(req, basket, billingData) {
    var { raw, profile, wallet } = req.currentCustomer;
    if (isValid(raw, billingData)) {
        var customer = CustomerMgr.getCustomerByCustomerNumber(profile.customerNo);
        var saveCardResult = COHelpers.savePaymentInstrumentToWallet(billingData, basket, customer);
        wallet.paymentInstruments.push(
            Object.assign(
                {
                    creditCardHolder: saveCardResult.creditCardHolder,
                    maskedCreditCardNumber: saveCardResult.maskedCreditCardNumber,
                    creditCardType: saveCardResult.creditCardType,
                    creditCardExpirationMonth: saveCardResult.creditCardExpirationMonth,
                    creditCardExpirationYear: saveCardResult.creditCardExpirationYear,
                    UUID: saveCardResult.UUID
                },
                'creditCardNumber' in saveCardResult && {
                    creditCardNumber: saveCardResult.creditCardNumber
                },
                {
                    raw: saveCardResult
                }
            )
        );
    }
}
module.exports = savePaymentInformation;
