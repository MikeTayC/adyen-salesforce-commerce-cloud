"use strict";

var Transaction = require('dw/system/Transaction');
var HookMgr = require('dw/system/HookMgr');
var PaymentMgr = require('dw/order/PaymentMgr');
var OrderMgr = require('dw/order/OrderMgr');
var getAuthorizationResult = (pProcessor, order, pInstrument) => {
  var hookName = `app.payment.processor.${pProcessor.ID.toLowerCase()}`;
  var customAuthorizeHook = () => HookMgr.callHook(hookName, 'Authorize', order, pInstrument, pProcessor);
  return HookMgr.hasHook(hookName) ? customAuthorizeHook() : HookMgr.callHook('app.payment.processor.default', 'Authorize');
};
var getPayments = order => order.paymentInstruments.toArray().reduce((acc, paymentInstrument) => {
  if (!acc.error) {
    var {
      paymentProcessor
    } = PaymentMgr.getPaymentMethod(paymentInstrument.paymentMethod);
    if (paymentProcessor) {
      var authorizationResult = getAuthorizationResult(paymentProcessor, order, paymentInstrument);
      if (authorizationResult.error) {
        Transaction.wrap(() => {
          OrderMgr.failOrder(order, true);
        });
      }
      return authorizationResult;
    }
    Transaction.begin();
    paymentInstrument.paymentTransaction.setTransactionID(order.orderNo);
    Transaction.commit();
  }
  return acc;
}, {});
module.exports = getPayments;