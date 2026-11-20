"use strict";

var OrderMgr = require('dw/order/OrderMgr');
var URLUtils = require('dw/web/URLUtils');
var handlePayment = require('*/cartridge/adyen/scripts/showConfirmation/handlePaymentFromComponent');
var AdyenLogs = require('*/cartridge/adyen/logs/adyenCustomLogs');
var setErrorType = require('*/cartridge/adyen/logs/setErrorType');

/*
 * Show confirmation for payments completed from component directly e.g. paypal, QRcode, ..
 */
function showConfirmationPaymentFromComponent(req, res, next) {
  var options = {
    req,
    res,
    next
  };
  try {
    var stateData = JSON.parse(req.form.additionalDetailsHidden);
    var order = OrderMgr.getOrder(req.form.merchantReference, req.form.orderToken);
    return handlePayment(stateData, order, options);
  } catch (error) {
    AdyenLogs.error_log('Could not verify /payment/details', error);
    setErrorType(error, res, {
      redirectUrl: URLUtils.url('Error-ErrorCode', 'err', 'general').toString()
    });
    return next();
  }
}
module.exports = showConfirmationPaymentFromComponent;