"use strict";

var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var Transaction = require('dw/system/Transaction');
var URLUtils = require('dw/web/URLUtils');
var Resource = require('dw/web/Resource');
var adyenCheckout = require('*/cartridge/adyen/scripts/payments/adyenCheckout');
var AdyenHelper = require('*/cartridge/adyen/utils/adyenHelper');
var AdyenConfigs = require('*/cartridge/adyen/utils/adyenConfigs');
var constants = require('*/cartridge/adyen/config/constants');
var clearForms = require('*/cartridge/adyen/utils/clearForms');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var postAuthorizationHook = require('*/cartridge/adyen/scripts/hooks/payment/postAuthorizationHandling');
var hooksHelper = require('*/cartridge/scripts/helpers/hooks');
function handlePaymentError(order, adyenPaymentInstrument, {
  req,
  res,
  next
}) {
  clearForms.clearAdyenData(adyenPaymentInstrument);
  Transaction.wrap(() => {
    OrderMgr.failOrder(order, true);
  });
  var redirectUrl = (req.form || {}).redirectUrl;
  if (redirectUrl && redirectUrl.startsWith('/') && !redirectUrl.startsWith('//')) {
    res.redirect(redirectUrl);
    return next();
  }
  res.redirect(URLUtils.url('Checkout-Begin', 'stage', 'payment', 'paymentError', Resource.msg('error.payment.not.valid', 'checkout', null)));
  return next();
}
function handlePaymentsDetailsCall(stateData, adyenPaymentInstrument) {
  var {
    details,
    paymentData
  } = stateData;

  // redirect to payment/details
  var requestObject = {
    details,
    paymentData
  };
  var result = adyenCheckout.doPaymentsDetailsCall(requestObject);
  return {
    result,
    adyenPaymentInstrument
  };
}
function handleAuthorisedPayment(order, result, adyenPaymentInstrument, {
  res,
  next
}) {
  Transaction.wrap(() => {
    AdyenHelper.savePaymentDetails(adyenPaymentInstrument, order, result);
  });
  clearForms.clearAdyenData(adyenPaymentInstrument);
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
function handlePaymentResult(result, order, adyenPaymentInstrument, options) {
  // Authorised: The payment authorisation was successfully completed.
  if ([constants.RESULTCODES.AUTHORISED, constants.RESULTCODES.PENDING, constants.RESULTCODES.RECEIVED].indexOf(result.resultCode) > -1) {
    return handleAuthorisedPayment(order, result, adyenPaymentInstrument, options);
  }
  Transaction.wrap(() => {
    order.custom.Adyen_pspReference = result.pspReference;
    order.custom.Adyen_eventCode = result.resultCode;
    order.custom.Adyen_paypalExpressResponse = null;
    adyenPaymentInstrument.custom.adyenPaymentData = null;
    session.privacy.paypalExpressOrderNo = null;
    session.privacy.pspReference = null;
  });
  return handlePaymentError(order, adyenPaymentInstrument, options);
}

// eslint-disable-next-line complexity
function handlePayment(stateData, order, options) {
  // Check if order exists
  if (!order) {
    AdyenLogs.error_log('Order is null in handlePayment - cannot process payment');
    var {
      res,
      next
    } = options;
    res.redirect(URLUtils.url('Checkout-Begin', 'stage', 'payment', 'paymentError', Resource.msg('error.payment.not.valid', 'checkout', null)));
    return next();
  }
  var paymentInstruments = order.getPaymentInstruments(AdyenHelper.getOrderMainPaymentInstrumentType(order));
  var result = JSON.parse((options.req.form || {}).result);
  var adyenPaymentInstrument = paymentInstruments[0];
  var hasStateData = (stateData || {}).paymentData && (stateData || {}).details;
  if ((result || {}).error || order.status.value === Order.ORDER_STATUS_FAILED) {
    AdyenLogs.error_log(`Could not call payment/details for order ${order.orderNo}`);
    return handlePaymentError(order, adyenPaymentInstrument, options);
  }
  var finalResult;
  if (!hasStateData) {
    if (result && (JSON.stringify(result).indexOf('amazonpay') > -1 || JSON.stringify(result).indexOf('applepay') > -1 || JSON.stringify(result).indexOf('googlepay') > -1 || JSON.stringify(result).indexOf('cashapp') > -1)) {
      finalResult = result;
    } else {
      return handlePaymentError(order, adyenPaymentInstrument, options);
    }
  }
  var paymentData = JSON.parse(adyenPaymentInstrument.custom.adyenPaymentData);
  var isPayPalExpress = AdyenHelper.isPayPalExpress(paymentData.paymentMethod);
  var detailsCall = hasStateData && !isPayPalExpress ? handlePaymentsDetailsCall(stateData, adyenPaymentInstrument) : null;
  if (isPayPalExpress) {
    finalResult = JSON.parse(order.custom.Adyen_paypalExpressResponse);
  } else {
    finalResult = finalResult || (detailsCall || {}).result;
  }

  // Post-auth hook
  var postAuthResult = hooksHelper('app.payment.post.auth', 'postAuthorization', {
    order,
    stateData,
    finalResult
  }, postAuthorizationHook.postAuthorization);
  if (postAuthResult && postAuthResult.error) {
    return postAuthResult;
  }
  return handlePaymentResult(finalResult, order, adyenPaymentInstrument, options);
}
module.exports = handlePayment;