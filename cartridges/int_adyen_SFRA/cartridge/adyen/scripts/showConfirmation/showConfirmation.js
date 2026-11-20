'use strict';

var URLUtils = require('dw/web/URLUtils');
var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var Transaction = require('dw/system/Transaction');
var adyenCheckout = require('*/cartridge/adyen/scripts/payments/adyenCheckout');
var constants = require('*/cartridge/adyen/config/constants');
var payment = require('*/cartridge/adyen/scripts/showConfirmation/handlePayment');
var clearForms = require('*/cartridge/adyen/utils/clearForms');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
var { AdyenError } = require('*/cartridge/adyen/logs/adyenError');
function getPaymentDetailsPayload(querystring) {
    var details = querystring.redirectResult
        ? {
              redirectResult: querystring.redirectResult
          }
        : {
              payload: querystring.payload
          };
    return {
        details
    };
}
function getPaymentsDetailsResult(adyenPaymentInstrument, redirectResult, payload, req) {
    var hasQuerystringDetails = !!(redirectResult || payload);
    // Saved response from Adyen-PaymentsDetails
    var result = JSON.parse(adyenPaymentInstrument.paymentTransaction.custom.Adyen_authResult);
    if (hasQuerystringDetails) {
        var requestObject = getPaymentDetailsPayload(req.querystring);
        result = adyenCheckout.doPaymentsDetailsCall(requestObject);
    }
    clearForms.clearPaymentTransactionData(adyenPaymentInstrument);
    return result;
}
function handleOrderConfirm(adyenPaymentInstrument, result, order, { res, next }) {
    Transaction.wrap(() => {
        AdyenHelper.savePaymentDetails(adyenPaymentInstrument, order, result);
    });
    clearForms.clearForms();
    // determines SFRA version for backwards compatibility
    if (AdyenConfigs.getAdyenSFRA6Compatibility() === true) {
        res.render('orderConfirmForm', {
            orderID: order.orderNo,
            orderToken: order.orderToken
        });
    } else {
        res.redirect(URLUtils.url('Order-Confirm', 'ID', order.orderNo, 'token', order.orderToken).toString());
    }
    return next();
}
function handlePaymentsDetailsResult(adyenPaymentInstrument, detailsResult, order, options) {
    if ([constants.RESULTCODES.AUTHORISED, constants.RESULTCODES.PENDING, constants.RESULTCODES.RECEIVED].indexOf(detailsResult.resultCode) > -1) {
        return handleOrderConfirm(adyenPaymentInstrument, detailsResult, order, options);
    }
    Transaction.wrap(() => {
        order.custom.Adyen_pspReference = detailsResult.pspReference;
        order.custom.Adyen_eventCode = detailsResult.resultCode;
    });
    return payment.handlePaymentError(order, 'placeOrder', options);
}
function isOrderAlreadyProcessed(order) {
    return order.status.value !== Order.ORDER_STATUS_CREATED && order.status.value !== Order.ORDER_STATUS_FAILED;
}

/*
 * Makes a payment details call to Adyen and calls for the order confirmation to be shown
 * if the payment was accepted.
 */
function showConfirmation(req, res, next) {
    try {
        var options = {
            req,
            res,
            next
        };
        var { redirectResult, payload, signature, merchantReference, orderToken } = req.querystring;
        var order = OrderMgr.getOrder(merchantReference, orderToken);
        var adyenPaymentInstrument = order.getPaymentInstruments(AdyenHelper.getOrderMainPaymentInstrumentType(order))[0];
        if (isOrderAlreadyProcessed(order)) {
            AdyenLogs.info_log(
                'ShowConfirmation called for an order which has already been processed. This is likely to be caused by shoppers using the back button after order confirmation'
            );
            res.render('orderConfirmForm', {
                orderID: order.orderNo,
                orderToken: order.orderToken
            });
            return next();
        }
        if (adyenPaymentInstrument.paymentTransaction.custom.Adyen_merchantSig === signature) {
            if (order.status.value === Order.ORDER_STATUS_FAILED) {
                AdyenLogs.error_log(`Could not call payment/details for failed order ${order.orderNo}`);
                return payment.handlePaymentError(order, 'placeOrder', options);
            }
            clearForms.clearAdyenData(adyenPaymentInstrument);
            var detailsResult = getPaymentsDetailsResult(adyenPaymentInstrument, redirectResult, payload, req);
            return handlePaymentsDetailsResult(adyenPaymentInstrument, detailsResult, order, options);
        }
        throw new AdyenError(`Incorrect signature for order ${merchantReference}`);
    } catch (error) {
        AdyenLogs.error_log('Could not verify /payment/details', error);
        setErrorType(error, res, {
            redirectUrl: URLUtils.url('Error-ErrorCode', 'err', 'general').toString()
        });
        return next();
    }
}
module.exports = showConfirmation;
