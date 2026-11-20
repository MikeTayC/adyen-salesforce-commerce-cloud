'use strict';

var server = require('server');
var Resource = require('dw/web/Resource');
var CustomerMgr = require('dw/customer/CustomerMgr');
var Transaction = require('dw/system/Transaction');
var URLUtils = require('dw/web/URLUtils');
var PaymentMgr = require('dw/order/PaymentMgr');
var adyenZeroAuth = require('*/cartridge/adyen/scripts/payments/adyenZeroAuth');
var constants = require('*/cartridge/adyen/config/constants');
var accountHelpers = require('*/cartridge/scripts/helpers/accountHelpers');
var { updateSavedCards } = require('*/cartridge/adyen/scripts/payments/updateSavedCards');
var { paymentProcessorIDs } = require('*/cartridge/controllers/middlewares/payment_instruments/paymentProcessorIDs');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
function containsValidResultCode(req) {
    return (
        [
            constants.RESULTCODES.AUTHORISED,
            constants.RESULTCODES.IDENTIFYSHOPPER,
            constants.RESULTCODES.CHALLENGESHOPPER,
            constants.RESULTCODES.REDIRECTSHOPPER
        ].indexOf(req.resultCode) !== -1
    );
}
function createPaymentInstrument(customer) {
    var paymentInstrument;
    var paymentForm = server.forms.getForm('creditCard');
    var wallet = customer.getProfile().getWallet();
    Transaction.wrap(() => {
        paymentInstrument = wallet.createPaymentInstrument(constants.METHOD_ADYEN_COMPONENT);
        paymentInstrument.custom.adyenPaymentData = paymentForm.adyenStateData.value;
    });
    return paymentInstrument;
}
function getResponseBody(action) {
    return Object.assign(
        {
            success: true,
            redirectUrl: URLUtils.url('PaymentInstruments-List').toString()
        },
        action && {
            redirectAction: action
        }
    );
}
function isAdyen() {
    var paymentMethod = PaymentMgr.getPaymentMethod('CREDIT_CARD');
    var paymentProcessor = paymentMethod && paymentMethod.getPaymentProcessor();
    var id = paymentProcessor && paymentProcessor.getID();
    return paymentProcessorIDs.indexOf(id) > -1 || PaymentMgr.getPaymentMethod(constants.METHOD_ADYEN_COMPONENT).isActive();
}
function savePayment(req, res, next) {
    try {
        if (!isAdyen()) {
            return next();
        }
        var customer = CustomerMgr.getCustomerByCustomerNumber(req.currentCustomer.profile.customerNo);
        Transaction.begin();
        var zeroAuthResult = adyenZeroAuth.zeroAuthPayment(customer, createPaymentInstrument(customer));
        if (zeroAuthResult.error || !containsValidResultCode(zeroAuthResult)) {
            Transaction.rollback();
            res.json({
                success: false,
                error: [Resource.msg('error.card.information.error', 'creditCard', null)]
            });
            return this.emit('route:Complete', req, res);
        }
        Transaction.commit();
        updateSavedCards({
            CurrentCustomer: req.currentCustomer.raw
        });

        // Send account edited email
        accountHelpers.sendAccountEditedEmail(customer.profile);
        res.json(getResponseBody(zeroAuthResult.action));
        return this.emit('route:Complete', req, res);
    } catch (error) {
        AdyenLogs.error_log('Could not save payments:', error);
        setErrorType(error, res, {
            redirectUrl: URLUtils.url('Error-ErrorCode', 'err', 'general').toString()
        });
        return this.emit('route:Complete', req, res);
    }
}
module.exports = savePayment;
