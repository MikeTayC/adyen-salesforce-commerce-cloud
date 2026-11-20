"use strict";

var URLUtils = require('dw/web/URLUtils');
var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var adyenCheckout = require('*/cartridge/adyen/scripts/payments/adyenCheckout');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');
function getRedirectUrl(paymentInstruments, orderNo, orderToken) {
  var redirectUrl = AdyenHelper.createRedirectUrl(paymentInstruments[0], orderNo, orderToken);
  return redirectUrl;
}
function updatePaymentInstrument(paymentInstrument, paymentsDetailsResponse) {
  Transaction.wrap(() => {
    paymentInstrument.paymentTransaction.custom.Adyen_authResult = JSON.stringify(paymentsDetailsResponse);
  });
}
function getOrder(orderNo, orderToken) {
  return orderNo ? OrderMgr.getOrder(orderNo, orderToken) : undefined;
}

/*
 * Makes a payment details call to Adyen to confirm the current status of a payment
 */
function paymentsDetails(req, res, next) {
  try {
    var request = JSON.parse(req.form.data);
    var {
      orderNo
    } = session.privacy;
    var {
      orderToken
    } = request;
    var order = getOrder(orderNo, orderToken);
    var isAmazonpay = ((request || {}).data || {}).paymentMethod === 'amazonpay';
    if (request.data) {
      request.data.paymentMethod = undefined;
    }
    var paymentsDetailsResponse = adyenCheckout.doPaymentsDetailsCall(request.data);
    var response = AdyenHelper.createAdyenCheckoutResponse(paymentsDetailsResponse);
    if (order) {
      var paymentInstruments = order.getPaymentInstruments(AdyenHelper.getOrderMainPaymentInstrumentType(order));
      updatePaymentInstrument(paymentInstruments[0], paymentsDetailsResponse);
      // Create signature to verify returnUrl
      response.redirectUrl = getRedirectUrl(paymentInstruments, orderNo, orderToken);
    }
    if (isAmazonpay) {
      response.fullResponse = {
        pspReference: paymentsDetailsResponse.pspReference,
        paymentMethod: paymentsDetailsResponse.additionalData.paymentMethod,
        resultCode: paymentsDetailsResponse.resultCode
      };
    }
    res.json(response);
  } catch (error) {
    AdyenLogs.error_log('Could not verify /payment/details:', error);
    setErrorType(error, res, {
      redirectUrl: URLUtils.url('Error-ErrorCode', 'err', 'general').toString()
    });
  }
  return next();
}
module.exports = paymentsDetails;