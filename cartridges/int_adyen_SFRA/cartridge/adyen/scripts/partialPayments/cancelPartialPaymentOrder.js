'use strict';

var BasketMgr = require('dw/order/BasketMgr');
var Transaction = require('dw/system/Transaction');
var Resource = require('dw/web/Resource');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var adyenCheckout = require('*/cartridge/adyen/scripts/payments/adyenCheckout');
var collections = require('*/cartridge/scripts/util/collections');
var constants = require('*/cartridge/adyen/config/constants');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var clearForms = require('*/cartridge/adyen/utils/clearForms');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var { AdyenError } = require('*/cartridge/adyen/logs/adyenError');

/**
 * Helper function to cancel partial payment order and refund gift cards
 * @param {dw.order.Basket} basket - The current basket
 * @returns {Object} Response from Adyen API
 * @throws {AdyenError} If cancellation fails
 */
function cancelPartialPaymentOrderHelper(basket) {
    if (!basket || !basket.custom.partialPaymentOrderData) {
        return null;
    }
    var { order } = JSON.parse(basket.custom.partialPaymentOrderData);
    var cancelOrderRequest = {
        merchantAccount: AdyenConfigs.getAdyenMerchantAccount(),
        order
    };
    var response = adyenCheckout.doCancelPartialPaymentOrderCall(cancelOrderRequest);
    if (response.resultCode === constants.RESULTCODES.RECEIVED) {
        Transaction.wrap(() => {
            collections.forEach(basket.getPaymentInstruments(), (item) => {
                if (item.custom.adyenPartialPaymentsOrder) {
                    basket.removePaymentInstrument(item);
                }
            });
            clearForms.clearAdyenBasketData(basket);
        });
    } else {
        throw new AdyenError(`received resultCode ${response.resultCode}`);
    }
    return response;
}
function cancelPartialPaymentOrder(req, res, next) {
    try {
        var currentBasket = BasketMgr.getCurrentBasket();
        var response = cancelPartialPaymentOrderHelper(currentBasket);
        if (!response) {
            throw new AdyenError('No partial payment order data found');
        }
        var amount = {
            currency: currentBasket.currencyCode,
            value: AdyenHelper.getCurrencyValueForApi(currentBasket.getTotalGrossPrice()).value
        };
        res.json({
            resultCode: response.resultCode,
            amount
        });
    } catch (error) {
        AdyenLogs.error_log('Could not cancel partial payments order:', error);
        setErrorType(error, res, {
            errorMessage: Resource.msg('error.technical', 'checkout', null)
        });
    }
    return next();
}
module.exports = cancelPartialPaymentOrder;
module.exports.cancelPartialPaymentOrderHelper = cancelPartialPaymentOrderHelper;
